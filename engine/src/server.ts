import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { isAddress } from "viem";
import type { ClientMessage, ServerMessage } from "@clutch/shared";
import { config, isLocalChain } from "./config";
import { log } from "./log";
import type { Hub } from "./stream/hub";
import { VideoRunner } from "./stream/video";
import { ZeroG } from "./ai/zeroG";

const callLimit = new Map<string, number>();
import * as chain from "./chain";
import { kvGet, kvSet, one, run } from "./db";
import { readEvidence } from "./evidence";
import { AuthError, newNonce, signIn, signInMessage, verifyToken } from "./auth";
import { agentPass, agentPassConfigured, agentPassDev, devDecide, listAgents, pollAuthorization, revokeAgent, startAuthorization } from "./agents";
import { PassRefused, starterIssue, devIssue, limits, nullifierOf, rpContext, verifyAndIssue, worldConfigured } from "./pass";
import { leaderboard, listMarkets, marketDetail, platformStats, portfolio, receipt, recentReceipts, recentRefusals, recentTrades } from "./queries";
import { lichessProfile } from "./sources/lichess";

type Ctx = { body: any; req: IncomingMessage; params: string[]; query: URLSearchParams; user?: `0x${string}`; ip: string };
type Handler = (c: Ctx) => Promise<unknown> | unknown;
type Route = { method: string; re: RegExp; auth?: boolean; h: Handler };

const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });

/** Operator actions: from this machine (the socket, never X-Forwarded-For), or with ADMIN_TOKEN when it is set. */
function operator(req: IncomingMessage) {
  const token = process.env.ADMIN_TOKEN;
  if (token) return req.headers["x-admin-token"] === token;
  const peer = req.socket.remoteAddress ?? "";
  return peer === "127.0.0.1" || peer === "::1" || peer === "::ffff:127.0.0.1";
}

export function serve(hub: Hub) {
  const d = config.deployment;
  const routes: Route[] = [
    // ── Operator: AI on/off. From this machine only, or with ADMIN_TOKEN when set. ──
    { method: "GET", re: /^\/admin\/ai$/, h: () => hub.agentState() },
    {
      method: "POST",
      re: /^\/admin\/ai$/,
      h: ({ body, req }) => {
        if (!operator(req)) throw httpError(403, "Not allowed.");
        return hub.setAi(Boolean(body.enabled));
      },
    },
    { method: "GET", re: /^\/health$/, h: () => ({ ok: true, chainId: config.chainId }) },
    {
      method: "GET",
      re: /^\/config$/,
      h: () => ({
        chainId: config.chainId,
        rpcUrl: config.local ? config.rpcUrl : config.rpcUrl,
        explorer: config.explorer,
        local: isLocalChain,
        deployment: {
          usdc: d.usdc,
          router: d.router,
          clutchHook: d.clutchHook,
          blackoutGuardHook: d.blackoutGuardHook,
          humanPassGate: d.humanPassGate,
          lpVault: d.lpVault,
          sequencerGuard: d.sequencerGuard,
          ethPool: d.ethPool,
        },
        world: { configured: worldConfigured, appId: config.worldAppId, action: config.worldAction, environment: config.worldEnvironment, agentPass: agentPassConfigured, agentPassDev },
        zeroG: { provider: hub.zg.provider, model: config.zgModel, storage: config.zgStorageKey ? "0g" : "local" },
        lichessClientId: config.lichessClientId,
        // public by design (it identifies the app, it doesn't authenticate it); lets viewers connect Twitch chat
        twitchClientId: process.env.TWITCH_CLIENT_ID,
        passDailyCap: config.passDailyCapUsdc,
        faucet: { starter: config.faucetStarterUsdc, humanDaily: config.faucetHumanDailyUsdc },
        starterDailyCap: config.starterDailyCapUsdc,
      }),
    },

    // ── Read models ──
    { method: "GET", re: /^\/streams$/, h: () => hub.summaries() },
    {
      method: "GET",
      re: /^\/streams\/([\w-]+)$/,
      h: async ({ params: [slug] }) => {
        const r = hub.runners.get(slug);
        if (!r) throw httpError(404, "No such channel");
        const row = await one<any>(`SELECT pool_id, currency0, currency1 FROM streams WHERE slug = ?`, [slug]);
        return {
          stream: r.state,
          market: r.active?.view ?? null,
          history: await listMarkets({ slug, open: false, limit: 20 }),
          refusals: await recentRefusals(8, slug),
          pool: { poolId: row.pool_id, key: { currency0: row.currency0, currency1: row.currency1, fee: 0, tickSpacing: 60, hooks: d.clutchHook } },
          latency: r.latencyStats(),
        };
      },
    },
    {
      // A viewer calls a market now, paying the AI's inference with their own 0G account.
      method: "POST",
      re: /^\/streams\/([\w-]+)\/call$/,
      h: async ({ body, params: [slug], ip }) => {
        const key = String(body.zgKey ?? "").trim();
        if (!/^sk-[A-Za-z0-9-]{20,}$/.test(key)) throw httpError(400, "Connect a 0G API key (it starts with sk-).");
        const r = hub.runners.get(slug);
        if (!(r instanceof VideoRunner)) throw httpError(400, "Calling a market works on live video channels.");
        const tag = createHmac("sha256", config.authSecret).update(key).digest("hex").slice(0, 16);
        const last = Math.max(callLimit.get(tag) ?? 0, callLimit.get(ip) ?? 0);
        if (Date.now() - last < 20_000) throw httpError(429, `Give it ${Math.ceil((20_000 - (Date.now() - last)) / 1000)}s before calling another market.`);
        callLimit.set(tag, Date.now());
        callLimit.set(ip, Date.now());
        const res = await r.callMarket(new ZeroG(key, "viewer"));
        if (!res.ok) throw httpError(409, res.reason);
        return res;
      },
    },
    { method: "GET", re: /^\/markets$/, h: ({ query }) => listMarkets({ slug: query.get("slug") ?? undefined, open: query.has("open") ? query.get("open") === "1" : undefined, limit: Number(query.get("limit") ?? 50) }) },
    {
      method: "GET",
      re: /^\/markets\/(\d+)$/,
      h: async ({ params: [id] }) => {
        const m = await marketDetail(Number(id));
        if (!m) throw httpError(404, "No such market");
        const view = [...hub.runners.values()].flatMap((r) => r.live.map((x) => x.view)).find((v) => v.id === Number(id));
        if (view) m.market = { ...view };
        return m;
      },
    },
    { method: "GET", re: /^\/receipts$/, h: ({ query }) => recentReceipts(Number(query.get("limit") ?? 20), query.get("slug") ?? undefined) },
    { method: "GET", re: /^\/receipts\/(\d+)$/, h: async ({ params: [id] }) => (await receipt(Number(id))) ?? Promise.reject(httpError(404, "No receipt yet")) },
    { method: "GET", re: /^\/trades$/, h: () => recentTrades(30) },
    { method: "GET", re: /^\/portfolio\/(0x[0-9a-fA-F]{40})$/, h: ({ params: [a] }) => portfolio(a) },
    { method: "GET", re: /^\/leaderboard$/, h: () => leaderboard(50) },
    { method: "GET", re: /^\/stats$/, h: async () => ({ ...(await platformStats()), agent: hub.agentState(), chain: hub.chainState }) },

    // ── Auth ──
    { method: "POST", re: /^\/auth\/nonce$/, h: ({ body }) => (isAddress(body.address) ? { nonce: newNonce() } : Promise.reject(httpError(400, "invalid address"))) },
    { method: "POST", re: /^\/auth\/message$/, h: ({ body }) => ({ message: signInMessage(body.address, body.nonce) }) },
    {
      method: "POST",
      re: /^\/auth\/verify$/,
      h: async ({ body }) => {
        const token = await signIn(body.address, body.nonce, body.signature);
        await run(`INSERT OR IGNORE INTO profiles (address, created_at) VALUES (?, ?)`, [body.address.toLowerCase(), Date.now()]);
        return { token };
      },
    },
    {
      method: "GET",
      re: /^\/me$/,
      auth: true,
      h: async ({ user }) => {
        const p = await one<{ name: string | null; lichess: string | null; created_at: number }>(`SELECT name, lichess, created_at FROM profiles WHERE address = ?`, [user!]);
        const nullifier = await nullifierOf(user!);
        const streams = [...hub.runners.values()].filter((r) => r.row.owner_address === user && r.row.owner_nullifier !== "0").map((r) => r.state);
        return { address: user, name: p?.name ?? null, lichess: p?.lichess ?? null, verifiedHuman: Boolean(nullifier), streams };
      },
    },
    {
      method: "POST",
      re: /^\/me\/profile$/,
      auth: true,
      h: async ({ user, body }) => {
        const name = String(body.name ?? "").trim();
        if (!/^[\w.-]{3,20}$/.test(name)) throw httpError(400, "Use 3 to 20 letters, numbers, dots, dashes or underscores.");
        const taken = await one(`SELECT address FROM profiles WHERE lower(name) = lower(?) AND address != ?`, [name, user!]);
        if (taken) throw httpError(409, "That name is taken.");
        await run(`INSERT INTO profiles (address, name, created_at) VALUES (?,?,?) ON CONFLICT(address) DO UPDATE SET name = excluded.name`, [user!, name, Date.now()]);
        return { name };
      },
    },

    // ── Human pass ──
    // ── World ID Agent Pass: a human authorizes a trading agent ──
    { method: "POST", re: /^\/agents\/authorize$/, auth: true, h: ({ user, body }) => startAuthorization(user! as `0x${string}`, body) },
    { method: "GET", re: /^\/agents\/authorize\/([a-f0-9]{24})$/, auth: true, h: ({ user, params: [id] }) => pollAuthorization(user! as `0x${string}`, id) },
    { method: "POST", re: /^\/agents\/authorize\/([a-f0-9]{24})\/dev$/, auth: true, h: ({ user, params: [id], body }) => devDecide(user! as `0x${string}`, id, Boolean(body.approve)) },
    { method: "GET", re: /^\/agents$/, auth: true, h: ({ user }) => listAgents(user!) },
    { method: "POST", re: /^\/agents\/(0x[0-9a-fA-F]{40})\/revoke$/, auth: true, h: ({ user, params: [a] }) => revokeAgent(user!, a) },
    // The agent's own endpoint. A pass only lets the agent's own key trade, so it isn't secret.
    { method: "GET", re: /^\/agents\/(0x[0-9a-fA-F]{40})\/pass$/, h: ({ params: [a] }) => agentPass(a) },
    { method: "POST", re: /^\/pass\/context$/, h: () => rpContext() },
    { method: "POST", re: /^\/pass\/verify$/, h: ({ body }) => verifyAndIssue(body.result, wallet(body.wallet)) },
    {
      method: "POST",
      re: /^\/pass\/starter$/,
      h: async ({ body, ip }) => {
        const w = wallet(body.wallet);
        const day = new Date().toISOString().slice(0, 10);
        const n = Number((await kvGet(`starter:ip:${ip}:${day}`)) ?? 0);
        // Per network address, generous on purpose: a venue or office shares one IP. Spoofable via X-Forwarded-For,
        // so it's a brake on scripts, not the real limit (that's one starter top-up per wallet, small caps per wallet).
        if (n >= config.starterPerIpDaily && !isLocalChain) throw httpError(429, "Too many new wallets from this network today. Verify with World ID to keep going.");
        await kvSet(`starter:ip:${ip}:${day}`, String(n + 1));
        const streamer = [...hub.runners.values()].some((r) => r.row.owner_address?.toLowerCase() === w.toLowerCase() && r.row.owner_nullifier !== "0");
        return starterIssue(w, streamer);
      },
    },
    { method: "POST", re: /^\/pass\/dev$/, h: ({ body }) => devIssue(String(body.persona ?? "alice"), wallet(body.wallet)) },
    { method: "GET", re: /^\/pass\/limits\/(\d+)$/, h: ({ params: [n] }) => limits(n) },

    // ── Testnet faucet ──
    {
      method: "POST",
      re: /^\/faucet$/,
      // Free money is exactly what bots farm, so it follows the person: a new wallet gets one small starter top-up,
      // and only a verified human (World ID) gets a daily refill, once per person however many wallets they use.
      h: async ({ body, ip }) => {
        const to = wallet(body.address);
        const day = new Date().toISOString().slice(0, 10);
        const ipCount = Number((await kvGet(`faucet:ip:${ip}:${day}`)) ?? 0);
        if (ipCount >= config.faucetPerIpDaily && !isLocalChain) throw httpError(429, "Daily faucet limit reached for this network.");
        const human = await nullifierOf(to);
        let usdc: number;
        if (human) {
          if (await kvGet(`faucet:h:${human}:${day}`)) throw httpError(429, "You've had today's free funds. They refill at 00:00 UTC.");
          await kvSet(`faucet:h:${human}:${day}`, String(Date.now()));
          usdc = config.faucetHumanDailyUsdc;
        } else {
          if (await kvGet(`faucet:w:${to.toLowerCase()}`)) throw Object.assign(httpError(403, `This wallet already had its starter funds. Verify with World ID for ${config.faucetHumanDailyUsdc} free test USDC every day.`), { code: "verify" });
          await kvSet(`faucet:w:${to.toLowerCase()}`, String(Date.now()));
          usdc = config.faucetStarterUsdc;
        }
        await kvSet(`faucet:ip:${ip}:${day}`, String(ipCount + 1));
        return { ...(await chain.faucet(to, usdc)), human: Boolean(human) };
      },
    },

    // ── Telemetry ──
    { method: "POST", re: /^\/telemetry\/latency$/, h: async ({ body }) => (await hub.runners.get(String(body.slug))?.reportLatency(Number(body.ms)), { ok: true }) },

    // ── Studio ──
    {
      method: "POST",
      re: /^\/studio\/lichess$/,
      auth: true,
      h: async ({ user, body }) => {
        // Lichess OAuth (PKCE). The engine exchanges the code, reads the account, and revokes the token immediately.
        const form = new URLSearchParams({ grant_type: "authorization_code", code: body.code, code_verifier: body.verifier, redirect_uri: body.redirectUri, client_id: config.lichessClientId });
        const tok = await fetch("https://lichess.org/api/token", { method: "POST", body: form });
        if (!tok.ok) throw httpError(400, "Lichess sign-in failed. Try again.");
        const { access_token } = (await tok.json()) as { access_token: string };
        const acc = await fetch("https://lichess.org/api/account", { headers: { Authorization: `Bearer ${access_token}` } });
        void fetch("https://lichess.org/api/token", { method: "DELETE", headers: { Authorization: `Bearer ${access_token}` } }).catch(() => {});
        if (!acc.ok) throw httpError(400, "Couldn't read your Lichess account.");
        const { username } = (await acc.json()) as { username: string };
        await run(`INSERT INTO profiles (address, lichess, created_at) VALUES (?,?,?) ON CONFLICT(address) DO UPDATE SET lichess = excluded.lichess`, [user!, username, Date.now()]);
        return { lichess: username, profile: await lichessProfile(username) };
      },
    },
    {
      method: "POST",
      re: /^\/studio\/channel$/,
      auth: true,
      h: async ({ user, body }) => {
        const p = await one<{ lichess: string | null }>(`SELECT lichess FROM profiles WHERE address = ?`, [user!]);
        if (!p?.lichess) throw httpError(400, "Connect your Lichess account first.");
        const nullifier = await nullifierOf(user!);
        if (!nullifier) throw httpError(400, "Verify you're a unique human first. It's what stops you trading your own markets.");
        const twitch = body.twitch ? String(body.twitch).trim().toLowerCase() : undefined;
        if (twitch && !/^[a-z0-9_]{3,25}$/.test(twitch)) throw httpError(400, "That doesn't look like a Twitch channel name.");
        const row = await hub.createStreamerChannel({ address: user!, nullifier, lichess: p.lichess, twitch, title: body.title });
        return { slug: row.slug };
      },
    },
    { method: "POST", re: /^\/studio\/claim-code$/, auth: true, h: ({ user }) => ({ code: claimCode(user!) }) },
    {
      method: "POST",
      re: /^\/studio\/video$/,
      auth: true,
      h: async ({ user, body }) => {
        const nullifier = await nullifierOf(user!);
        if (!nullifier) throw httpError(400, "Verify you're a unique human first. It's what stops you trading your own markets.");
        const row = await hub.createVideoChannel({ address: user!, nullifier, url: String(body.url ?? ""), code: claimCode(user!), title: body.title });
        return { slug: row.slug };
      },
    },
    {
      method: "POST",
      re: /^\/studio\/([\w-]+)\/veto$/,
      auth: true,
      h: async ({ user, body, params: [slug] }) => {
        const r = hub.runners.get(slug);
        if (!r || (r.row.owner_address !== user && !(isLocalChain && r.row.kind !== "lichess-user"))) throw httpError(403, "Not your channel.");
        await r.setVetoed(Array.isArray(body.vetoed) ? body.vetoed.map(String) : []);
        return r.state;
      },
    },
    {
      method: "POST",
      re: /^\/studio\/([\w-]+)\/pause$/,
      auth: true,
      h: async ({ user, body, params: [slug] }) => {
        // Streamer channels pause onchain from the streamer's own wallet; this endpoint covers house channels locally.
        const r = hub.runners.get(slug);
        if (!r || r.row.kind === "lichess-user" || !isLocalChain) throw httpError(403, "Pause from your wallet in the studio.");
        void user;
        await chain.setPausedAsOwner(r.row.pool_id as `0x${string}`, Boolean(body.paused));
        r.setPaused(Boolean(body.paused));
        return { paused: r.state.paused };
      },
    },

    // ── Local demo controls ──
    // Demo control for the mock sequencer feed: operator only (it voids markets), like the AI switch.
    { method: "POST", re: /^\/demo\/outage$/, h: ({ body, req }) => (operator(req) ? chain.simulateOutage(Number(body.seconds ?? 30)) : Promise.reject(httpError(403, "Operator only."))) },
  ];

  const server = createServer(async (req, res) => {
    cors(req, res);
    if (req.method === "OPTIONS") return res.writeHead(204).end();
    const url = new URL(req.url ?? "/", "http://x");

    // What the AI sees: latest frame per channel (/frames/<slug>.jpg) and evidence frames (/frames/<sha256>.jpg).
    const fr = url.pathname.match(/^\/frames\/([a-z0-9_-]{1,64})\.jpg$/);
    if (fr && req.method === "GET") {
      const p = join(config.dataDir, "frames", `${fr[1]}.jpg`);
      if (!existsSync(p)) return json(res, 404, { error: "not found" });
      res.writeHead(200, { "Content-Type": "image/jpeg", "Cache-Control": /^[0-9a-f]{64}$/.test(fr[1]) ? "public, max-age=31536000, immutable" : "no-store" });
      return res.end(readFileSync(p));
    }

    const ev = url.pathname.match(/^\/evidence\/(0x[0-9a-fA-F]{64})$/);
    if (ev && req.method === "GET") {
      const body = readEvidence(ev[1]);
      if (!body) return json(res, 404, { error: "not found" });
      res.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "public, max-age=31536000, immutable" });
      return res.end(body);
    }

    for (const r of routes) {
      const m = url.pathname.match(r.re);
      if (!m || r.method !== req.method) continue;
      try {
        const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() || req.socket.remoteAddress || "?";
        const body = r.method === "POST" ? await readBody(req) : {};
        const user = r.auth ? verifyToken(req.headers.authorization) : undefined;
        return json(res, 200, await r.h({ body, req, params: m.slice(1), query: url.searchParams, user, ip }));
      } catch (e: any) {
        if (e instanceof PassRefused) return json(res, 403, { error: e.code, message: e.message });
        if (e instanceof AuthError) return json(res, 401, { error: "auth", message: e.message });
        if (e?.status) return json(res, e.status, { error: e.code ?? e.message, code: e.code, message: e.message });
        log.error(req.method, url.pathname, e.shortMessage ?? e.message);
        return json(res, 500, { error: "server", message: "Something went wrong on our side." });
      }
    }
    json(res, 404, { error: "not found" });
  });

  // ── WebSocket: subscribe to "global" and "stream:<slug>" channels ──
  const wss = new WebSocketServer({ server, path: "/ws", maxPayload: 16 * 1024 });
  const subs = new Map<WebSocket, Set<string>>();
  const countFor = (slug: string) => [...subs.values()].filter((s) => s.has(`stream:${slug}`)).length;
  const recount = (channels: Iterable<string>) => {
    for (const c of channels) if (c.startsWith("stream:")) hub.setWatching(c.slice(7), countFor(c.slice(7)));
  };

  wss.on("connection", (ws) => {
    subs.set(ws, new Set());
    let alive = true;
    ws.on("pong", () => (alive = true));
    const ping = setInterval(() => {
      if (!alive) return ws.terminate();
      alive = false;
      ws.ping();
    }, 25_000);

    ws.on("message", async (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      const set = subs.get(ws)!;
      const channels = (msg.channels ?? []).filter((c) => c === "global" || /^stream:[\w-]{1,40}$/.test(c)).slice(0, 10);
      if (msg.type === "sub") {
        for (const c of channels) {
          if (set.has(c)) continue;
          set.add(c);
          if (c === "global") send(ws, await hub.hello());
          else {
            const r = hub.runners.get(c.slice(7));
            if (r) send(ws, { type: "stream", stream: r.state });
          }
        }
      } else if (msg.type === "unsub") for (const c of channels) set.delete(c);
      recount(channels);
    });
    ws.on("close", () => {
      clearInterval(ping);
      const had = subs.get(ws) ?? new Set();
      subs.delete(ws);
      recount(had);
    });
  });

  hub.on("broadcast", (channel: string, msg: ServerMessage) => {
    const data = JSON.stringify(msg);
    for (const [ws, set] of subs) if (set.has(channel) && ws.readyState === ws.OPEN) ws.send(data);
  });

  server.listen(config.port, () => log.info(`engine on http://localhost:${config.port} (ws /ws)`));
}

/** One-time code a streamer puts in their live title to prove they control the channel. */
function claimCode(address: string) {
  return `clutch-${createHmac("sha256", config.authSecret).update(address).digest("hex").slice(0, 6)}`;
}

function send(ws: WebSocket, m: ServerMessage) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m));
}

function wallet(a: unknown): `0x${string}` {
  if (typeof a !== "string" || !isAddress(a)) throw httpError(400, "invalid wallet address");
  return a;
}

function cors(req: IncomingMessage, res: ServerResponse) {
  const origin = req.headers.origin;
  const allowed = config.appOrigin.split(",").map((s) => s.trim());
  res.setHeader("Access-Control-Allow-Origin", origin && (allowed.includes(origin) || isLocalChain) ? origin : allowed[0]);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
}

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)));
}

async function readBody(req: IncomingMessage): Promise<any> {
  let raw = "";
  for await (const c of req) {
    raw += c;
    if (raw.length > 1e6) throw httpError(413, "body too large");
  }
  try {
    return raw ? JSON.parse(raw) : {};
  } catch {
    throw httpError(400, "invalid JSON");
  }
}
