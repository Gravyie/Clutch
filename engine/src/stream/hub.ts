import { EventEmitter } from "node:events";
import type { Hex } from "viem";
import type { AgentState, ChainState, ServerMessage, StreamKind } from "@clutch/shared";
import { HOUSE_CHANNELS, config } from "../config";
import { log } from "../log";
import * as chain from "../chain";
import { all, migrate, one, run } from "../db";
import { ZeroG } from "../ai/zeroG";
import { Indexer } from "../indexer";
import { devNullifier } from "../pass";
import { listMarkets, recentReceipts, todayByStream } from "../queries";
import { LichessExportSource, LichessStreamSource, LichessUserWatcher, TvDirector } from "../sources/lichess";
import { Replay } from "../sources/replay";
import { StreamRunner, type StreamRow } from "./runner";

/**
 * Runs every channel. Boots house channels (Lichess TV) and streamer channels from the database, creates their
 * onchain pools on first run, restores markets that were open when the engine last stopped, and fans state out
 * to WebSocket subscribers.
 */
export class Hub extends EventEmitter {
  readonly zg = new ZeroG();
  readonly runners = new Map<string, StreamRunner>();
  readonly indexer = new Indexer();
  private readonly watcher = new LichessUserWatcher();
  private readonly directors = new Map<string, TvDirector>();
  chainState?: ChainState;
  earnedUsd = 0;
  private dirty = new Set<string>();
  private today = new Map<string, { settled: number; volume: number }>();

  async boot() {
    await migrate();
    await this.ensureHouseStreams();
    for (const row of await all<StreamRow>(`SELECT * FROM streams WHERE enabled = 1 ORDER BY created_at`)) this.addRunner(row);
    await this.restoreOpenMarkets();

    this.watcher.on("game", (user: string, gameId: string) => {
      const r = [...this.runners.values()].find((x) => x.row.lichess_user?.toLowerCase() === user);
      if (!r) return;
      log.info(`${r.row.slug}: streamer started game ${gameId}`);
      r.attach(LichessStreamSource.open(gameId), new LichessExportSource(gameId), "white");
    });
    this.watcher.on("idle", (user: string) => [...this.runners.values()].find((x) => x.row.lichess_user?.toLowerCase() === user)?.idle());

    this.indexer.on("trade", async (t) => {
      const r = this.runners.get(t.slug);
      const n = await one<{ n: number }>(`SELECT COUNT(*) n FROM trades WHERE market_id = ? AND trader = ?`, [t.marketId, t.trader.toLowerCase()]);
      r?.onTrade(t.marketId, t.amount, t.priceYesAfter, Number(n?.n ?? 0) === 1);
      this.broadcast("global", { type: "trade", trade: t });
    });
    void this.indexer.start();

    setInterval(() => void this.refreshChain(), 3000);
    setInterval(() => void this.refreshPaused(), 10_000);
    setInterval(() => void this.refreshToday(), 30_000);
    setInterval(() => this.flush(), 1000);
    void this.refreshChain();
    void this.refreshToday();
  }

  // ─── Channels ────────────────────────────────────────────────────────────────────────────────

  private async ensureHouseStreams() {
    const wanted = HOUSE_CHANNELS.filter((h) => config.houseChannels.includes(h.slug));
    for (const h of wanted) {
      if (await one(`SELECT slug FROM streams WHERE slug = ?`, [h.slug])) continue;
      log.info(`creating pool for house channel ${h.slug}`);
      const pool = await chain.createStreamPool({ name: `Clutch: ${h.title}`, symbol: `c${h.slug.toUpperCase().slice(0, 6)}`, streamer: chain.owner.address, streamerNullifier: 0n, latencyBuffer: config.defaultLatencyBufferSec });
      await this.insertStream({ slug: h.slug, kind: "lichess-tv", title: h.title, subtitle: h.subtitle, lichessChannel: h.channel, owner: chain.owner.address, ownerNullifier: "0", pool });
    }
    if (config.replay && !(await one(`SELECT slug FROM streams WHERE slug = 'replay'`))) {
      // An offline channel replaying a recorded game. Its "streamer" is the dev streamer persona, so the
      // streamer-can't-trade-own-market rule can be demonstrated without any external account.
      const nullifier = devNullifier("streamer");
      const pool = await chain.createStreamPool({ name: "Clutch: Replay", symbol: "cREPLAY", streamer: chain.owner.address, streamerNullifier: BigInt(nullifier), latencyBuffer: config.defaultLatencyBufferSec });
      await this.insertStream({ slug: "replay", kind: "replay", title: "Replay: Classic Blitz", subtitle: "Recorded game, real time", owner: chain.owner.address, ownerNullifier: nullifier, pool });
    }
  }

  private async insertStream(s: {
    slug: string;
    kind: StreamKind;
    title: string;
    subtitle: string;
    lichessChannel?: string;
    lichessUser?: string;
    twitch?: string;
    owner: string;
    ownerNullifier: string;
    pool: { token: string; poolId: Hex; key: chain.PoolKeyShape };
    latency?: number;
  }) {
    await run(
      `INSERT INTO streams (slug, kind, title, subtitle, lichess_channel, lichess_user, twitch_channel, owner_address, owner_nullifier, pool_id, token, currency0, currency1, latency_buffer, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        s.slug,
        s.kind,
        s.title,
        s.subtitle,
        s.lichessChannel ?? null,
        s.lichessUser ?? null,
        s.twitch ?? null,
        s.owner.toLowerCase(),
        s.ownerNullifier,
        s.pool.poolId,
        s.pool.token,
        s.pool.key.currency0,
        s.pool.key.currency1,
        s.latency ?? config.defaultLatencyBufferSec,
        Date.now(),
      ],
    );
    return (await one<StreamRow>(`SELECT * FROM streams WHERE slug = ?`, [s.slug]))!;
  }

  /** A streamer's own channel: verified Lichess account, verified human, their own pool. */
  async createStreamerChannel(p: { address: `0x${string}`; nullifier: string; lichess: string; twitch?: string; title?: string }) {
    const slug = p.lichess.toLowerCase();
    if (this.runners.has(slug)) throw Object.assign(new Error("This channel already exists."), { status: 409 });
    const latency = p.twitch ? config.twitchLatencyBufferSec : config.defaultLatencyBufferSec;
    const pool = await chain.createStreamPool({ name: `Clutch: ${p.lichess}`, symbol: `c${slug.toUpperCase().slice(0, 8)}`, streamer: p.address, streamerNullifier: BigInt(p.nullifier), latencyBuffer: latency });
    const row = await this.insertStream({
      slug,
      kind: "lichess-user",
      title: p.title?.trim() || p.lichess,
      subtitle: p.twitch ? `Live on Twitch · ${p.twitch}` : "Playing on Lichess",
      lichessUser: p.lichess,
      twitch: p.twitch,
      owner: p.address,
      ownerNullifier: p.nullifier,
      pool,
      latency,
    });
    this.addRunner(row);
    return row;
  }

  private addRunner(row: StreamRow) {
    const r = new StreamRunner(row, this.zg);
    this.runners.set(row.slug, r);
    r.on("state", () => {
      this.dirty.add(row.slug);
      this.broadcast(`stream:${row.slug}`, { type: "stream", stream: r.state });
    });
    r.on("market", (market) => this.broadcast("global", { type: "market", market }));
    r.on("receipt", (receipt) => this.broadcast("global", { type: "receipt", receipt }));
    r.on("refusal", (refusal) => this.broadcast(`stream:${row.slug}`, { type: "refusal", refusal }));
    r.on("agent", () => this.broadcast("global", { type: "agent", agent: this.agentState() }));
    r.start();

    if (row.kind === "lichess-tv" && row.lichess_channel) {
      const dir = new TvDirector(row.lichess_channel);
      this.directors.set(row.slug, dir);
      dir.on("game", (g) => r.attach(LichessStreamSource.open(g.id), new LichessExportSource(g.id), g.orientation));
    } else if (row.kind === "lichess-user" && row.lichess_user) {
      this.watcher.add(row.lichess_user);
      r.idle();
    } else if (row.kind === "replay") {
      const loop = () => {
        const rep = new Replay();
        r.attach(rep.a, rep.b, "white");
        rep.on("closed", loop);
      };
      loop();
    }
  }

  /** Markets that were open when the engine stopped: resume with their saved timeline, or void if impossible. */
  private async restoreOpenMarkets() {
    const open = await all<any>(`SELECT * FROM markets WHERE phase IN ('trading','locked','window','resolving')`);
    for (const m of open) {
      const onchain = await chain.marketOnchain(Number(m.id)).catch(() => undefined);
      if (!onchain || onchain.status !== 1) continue; // already settled onchain; the indexer reconciles it
      const r = this.runners.get(m.slug);
      if (!r || r.row.kind === "replay" || String(m.game_id).startsWith("replay-")) {
        // A recorded replay can't be re-observed; refunding everyone is the honest outcome.
        try {
          await chain.resolveMarket(Number(m.id), "VOID", ("0x" + "0".repeat(64)) as Hex);
          await run(`UPDATE markets SET phase = 'void', outcome = 'VOID', void_reason = ? WHERE id = ?`, ["The engine restarted during a replay, so this market was voided and refunded.", m.id]);
          log.info(`voided market #${m.id} (replay restarted)`);
        } catch (e: any) {
          log.warn(`could not void #${m.id}`, e.shortMessage ?? e.message);
        }
        continue;
      }
      await r.restore(m, (gameId, seedA, seedB) => {
        const b = new LichessExportSource(gameId);
        b.seed = seedB;
        return [LichessStreamSource.open(gameId, seedA), b];
      });
    }
  }

  // ─── Periodic ────────────────────────────────────────────────────────────────────────────────

  private async refreshChain() {
    try {
      await chain.pokeGuardIfStale();
      this.chainState = await chain.readChainState();
      this.earnedUsd = await chain.agentEarnings();
      const blocked = this.chainState.sequencerPhase !== "Normal";
      for (const r of this.runners.values()) r.chainBlocked = blocked;
      this.broadcast("global", { type: "chain", chain: this.chainState });
    } catch (e: any) {
      log.warn("chain read failed", e.shortMessage ?? e.message);
    }
  }

  private async refreshPaused() {
    for (const r of this.runners.values()) {
      if (!r.row.pool_id) continue;
      try {
        const s = await chain.readStream(r.row.pool_id as Hex);
        r.setPaused(s.paused);
      } catch {}
    }
  }

  private async refreshToday() {
    this.today = await todayByStream();
    for (const [slug, r] of this.runners) {
      const t = this.today.get(slug);
      r.state.settledToday = t?.settled ?? 0;
      r.state.volumeToday = t?.volume ?? 0;
      this.dirty.add(slug);
    }
  }

  /** Coalesces channel-card updates into at most one `streams` message per second. */
  private flush() {
    if (!this.dirty.size) return;
    this.dirty.clear();
    this.broadcast("global", { type: "streams", streams: this.summaries() });
  }

  setWatching(slug: string, n: number) {
    const r = this.runners.get(slug);
    if (r && r.state.watching !== n) {
      r.state.watching = n;
      this.dirty.add(slug);
    }
  }

  summaries() {
    return [...this.runners.values()].map((r) => r.summary());
  }

  agentState(): AgentState {
    return {
      address: chain.agent.address,
      mode: this.zg.mode,
      provider: this.zg.provider,
      model: this.zg.provider === "0g" ? config.zgModel : "base-rates-v1",
      requestsToday: this.zg.requestsToday,
      spentTodayUsd: this.zg.spentTodayUsd,
      capTodayUsd: config.zgDailyCapUsd,
      earnedUsd: this.earnedUsd,
      lastRequestId: this.zg.lastRequestId,
    };
  }

  async hello(): Promise<ServerMessage> {
    const live = [...this.runners.values()].flatMap((r) => (r.active ? [r.active.view] : []));
    const recent = await listMarkets({ open: false, limit: 12 });
    return {
      type: "hello",
      streams: this.summaries(),
      markets: [...live, ...recent],
      receipts: await recentReceipts(12),
      agent: this.agentState(),
      chain: this.chainState ?? { chainId: config.chainId, block: 0, sequencerPhase: "Unknown", blocksIntoRecovery: 0, blackoutFeePips: 0, vault: { totalAssets: 0, idle: 0, outstanding: 0, realizedPnl: 0, marketsFunded: 0 } },
    };
  }

  private broadcast(channel: string, msg: ServerMessage) {
    this.emit("broadcast", channel, msg);
  }
}
