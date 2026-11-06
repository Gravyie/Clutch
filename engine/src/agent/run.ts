/**
 * clutch-agent: a trading agent that acts for one verified human.
 *
 *   pnpm --filter @clutch/engine agent            # or: npx tsx --env-file=.env src/agent/run.ts [name]
 *
 * 1. Creates (or loads) its own wallet and prints the address.
 * 2. Waits until its human authorizes it in Clutch (Account → Agents), which takes a fresh World ID approval.
 * 3. Watches live markets and asks a 0G model, from the AI's own reading of the stream, whether the price is wrong.
 * 4. Trades small stakes when it sees an edge, inside the human's onchain daily cap, which it shares.
 *
 * It never holds a pass for longer than an hour; if its human revokes it, it stops at the next renewal.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createWalletClient, http, maxUint256, parseEther, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ClutchHookAbi, ClutchRouterAbi, HumanPassGateAbi, MockUSDCAbi, toUsdc, fromUsdc } from "@clutch/shared";
import { config } from "../config";
import { chain, publicClient } from "../chain";
import { ZeroG } from "../ai/zeroG";

const ENGINE = process.env.ENGINE_URL ?? `http://localhost:${config.port}`;
const NAME = (process.argv[2] ?? "agent").replace(/\W/g, "") || "agent";
const STAKE = Number(process.env.AGENT_STAKE_USD ?? 2);
const EDGE = Number(process.env.AGENT_MIN_EDGE ?? 0.08);
const d = config.deployment;

const dir = join(import.meta.dirname, "../../data");
mkdirSync(dir, { recursive: true });
const keyFile = join(dir, `agent-${NAME}.key`);
if (!existsSync(keyFile)) writeFileSync(keyFile, generatePrivateKey(), { mode: 0o600 });
const account = privateKeyToAccount(readFileSync(keyFile, "utf8").trim() as Hex);
const wallet = createWalletClient({ account, chain, transport: http(config.rpcUrl) });
const zg = new ZeroG(process.env.ZG_API_KEY, "viewer");

const say = (...a: unknown[]) => console.log(new Date().toISOString().slice(11, 19), ...a);
const get = async <T>(path: string): Promise<T> => {
  const r = await fetch(ENGINE + path);
  const b: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(b.message ?? r.statusText), { status: r.status });
  return b as T;
};

say(`agent "${NAME}" wallet ${account.address}`);
say(`authorize it: open Clutch → Account → Agents → paste this address, then approve with World ID`);

type Pass = { gateData: Hex; expiry: number; capUsdc: number; name: string };
let pass: Pass | undefined;
let lastReason = "";
async function ensurePass() {
  if (pass && pass.expiry > Date.now() / 1000 + 120) return pass;
  try {
    pass = await get<Pass>(`/agents/${account.address}/pass`);
    say(`pass ok: acting as "${pass.name}", shares its human's daily cap ($${pass.capUsdc})`);
    lastReason = "";
  } catch (e: any) {
    pass = undefined;
    if (e.message !== lastReason) say(`waiting: ${e.message}`);
    lastReason = e.message;
  }
  return pass;
}

async function ensureFunds() {
  const usdc = toUsdc(await publicClient.readContract({ address: d.usdc, abi: MockUSDCAbi, functionName: "balanceOf", args: [account.address] }));
  if (usdc >= STAKE) return;
  if (!config.local && config.chainId !== 31337) throw new Error(`agent wallet needs USDC: send some to ${account.address}`);
  await fetch(`${ENGINE}/faucet`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ address: account.address }) });
  const allowance = await publicClient.readContract({ address: d.usdc, abi: MockUSDCAbi, functionName: "allowance", args: [account.address, d.router] });
  if (allowance < fromUsdc(1_000_000)) await publicClient.waitForTransactionReceipt({ hash: await wallet.writeContract({ address: d.usdc, abi: MockUSDCAbi, functionName: "approve", args: [d.router, maxUint256] }) });
  say(`funded from the test faucet`);
}

const seen = new Set<number>();

async function consider(slug: string) {
  const s = await get<any>(`/streams/${slug}`);
  const m = s.market;
  if (!m || m.phase !== "trading" || seen.has(m.id) || m.lockTime - Date.now() / 1000 < 6) return;
  seen.add(m.id);
  const reading = s.stream.vision?.state;
  const res = await zg.json<{ pYes: number; reason: string }>(
    `You are a careful trader on 30-60 second live-stream prediction markets. Estimate the probability the market resolves YES, using only the rule and what's on screen. Respond with JSON only: {"pYes": number 0-1, "reason": "one short sentence"}`,
    JSON.stringify({ question: m.question, rule: m.rule.resolution, secondsUntilWindow: Math.round(m.windowStart - Date.now() / 1000), windowSeconds: m.windowEnd - m.windowStart, screen: reading ? { game: reading.game, summary: reading.summary, counters: reading.counters, povAlive: reading.povAlive } : s.stream.status, chess: s.stream.media?.kind === "chess" ? { white: s.stream.white, black: s.stream.black, plies: s.stream.plies } : undefined }),
    400,
  );
  const p = Math.min(0.99, Math.max(0.01, Number(res.data.pYes)));
  const edgeYes = p - m.priceYes;
  say(`#${m.id} "${m.question}" market ${Math.round(m.priceYes * 100)}% vs agent ${Math.round(p * 100)}% · 0G ${res.requestId} · $${res.costUsd.toFixed(5)}`);
  if (Math.abs(edgeYes) < EDGE) return say(`   skip: no edge (${res.data.reason})`);
  const yes = edgeYes > 0;
  const ps = await ensurePass();
  if (!ps) return;
  try {
    const { request, result } = await publicClient.simulateContract({ account, address: d.router, abi: [...ClutchRouterAbi, ...ClutchHookAbi.filter((x: any) => x.type === "error"), ...HumanPassGateAbi.filter((x: any) => x.type === "error")] as unknown as typeof ClutchRouterAbi, functionName: "back", args: [s.pool.key, BigInt(m.id), yes, fromUsdc(STAKE), 0n, ps.gateData] });
    const hash = await wallet.writeContract(request);
    await publicClient.waitForTransactionReceipt({ hash });
    say(`   ${yes ? "YES" : "NO"} $${STAKE} → ${toUsdc(result).toFixed(2)} shares · ${hash}`);
  } catch (e: any) {
    const name = e.cause?.data?.errorName ?? e.cause?.signature ?? "";
    const why = `${name} ${e.shortMessage ?? e.message}`;
    say(`   refused onchain: ${/DailyCap/.test(why) ? "its human's daily cap is spent; resting until tomorrow" : name || why.split("\n")[0]}`);
  }
}

for (;;) {
  try {
    if (await ensurePass()) {
      await ensureFunds();
      const streams = await get<any[]>(`/streams`);
      for (const s of streams.filter((x) => x.market?.phase === "trading")) await consider(s.slug).catch((e) => say(`   ${s.slug}: ${e.message}`));
    }
  } catch (e: any) {
    say(`error: ${e.message}`);
  }
  await new Promise((r) => setTimeout(r, 3000));
}
