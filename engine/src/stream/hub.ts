import { EventEmitter } from "node:events";
import type { Hex } from "viem";
import type { AgentState, ChainState, ServerMessage, StreamKind } from "@clutch/shared";
import { HOUSE_CHANNELS, VIDEO_SEEDS, config } from "../config";
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
import { VideoRunner } from "./video";
import { makeReaders } from "../video/perceive";
import { parseChannel, probe, type ChannelRef } from "../video/capture";
import { discover, twitchConfigured, viewers as twitchViewers } from "../video/twitch";
import { categoryFor } from "@clutch/shared";

export type Runner = StreamRunner | VideoRunner;
type Row = StreamRow & { platform: string | null; channel: string | null; category: string | null };

/**
 * Runs every channel. Boots house channels (Lichess TV) and streamer channels from the database, creates their
 * onchain pools on first run, restores markets that were open when the engine last stopped, and fans state out
 * to WebSocket subscribers.
 */
const BENCH_MS = 5 * 60_000;

export class Hub extends EventEmitter {
  readonly zg = new ZeroG();
  readonly runners = new Map<string, Runner>();
  readonly readers = makeReaders(this.zg);
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
    await this.ensureVideoSeeds();
    for (const row of await all<Row>(`SELECT * FROM streams WHERE enabled = 1 ORDER BY created_at`)) this.addRunner(row);
    await this.restoreOpenMarkets();

    this.watcher.on("game", (user: string, gameId: string) => {
      const r = [...this.runners.values()].find((x): x is StreamRunner => x instanceof StreamRunner && x.row.lichess_user?.toLowerCase() === user);
      if (!r) return;
      log.info(`${r.row.slug}: streamer started game ${gameId}`);
      r.attach(LichessStreamSource.open(gameId), new LichessExportSource(gameId), "white");
    });
    this.watcher.on("idle", (user: string) =>
      [...this.runners.values()].find((x): x is StreamRunner => x instanceof StreamRunner && x.row.lichess_user?.toLowerCase() === user)?.idle(),
    );

    this.indexer.on("trade", async (t) => {
      const r = this.runners.get(t.slug);
      const n = await one<{ n: number }>(`SELECT COUNT(*) n FROM trades WHERE market_id = ? AND trader = ?`, [t.marketId, t.trader.toLowerCase()]);
      r?.onTrade(t.marketId, t.amount, t.priceYesAfter, Number(n?.n ?? 0) === 1);
      this.broadcast("global", { type: "trade", trade: t });
    });
    void this.indexer.start();

    if (twitchConfigured) {
      // Known channels get their live status first (one Helix call); discovering new ones takes longer.
      void this.refreshTwitch().then(() => this.discoverTwitch());
      setInterval(() => void this.discoverTwitch(), 4 * 60_000);
      setInterval(() => void this.refreshTwitch(), 60_000);
    }
    setInterval(() => void this.refreshChain(), 3000);
    setInterval(() => this.allocateSlots(), 15_000); // rotate unproductive reader slots
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

  /** House video channels (Twitch/Kick), each with its own market pool. */
  private async ensureVideoSeeds() {
    for (const seed of VIDEO_SEEDS) {
      const [platform, channel] = seed.split(":") as [ChannelRef["platform"], string];
      const slug = `${platform === "twitch" ? "" : platform + "-"}${channel}`.toLowerCase();
      if (await one(`SELECT slug FROM streams WHERE slug = ?`, [slug])) continue;
      await this.insertStream({ slug, kind: "video", title: channel, subtitle: platform === "twitch" ? "Twitch" : platform === "kick" ? "Kick" : "YouTube", owner: chain.owner.address, ownerNullifier: "0", latency: config.twitchLatencyBufferSec, platform, channel });
    }
  }

  /**
   * A streamer's own video channel. Ownership is proven by putting a one-time code in the live stream's title,
   * which works on every platform without platform API keys.
   */
  async createVideoChannel(p: { address: `0x${string}`; nullifier: string; url: string; code: string; title?: string }) {
    const ref = parseChannel(p.url);
    if (!ref) throw Object.assign(new Error("Paste a Twitch, Kick or YouTube channel link."), { status: 400 });
    const info = await probe(ref);
    if (!info.live) throw Object.assign(new Error("Go live first, with the code in your stream title, then try again."), { status: 400 });
    if (!info.title?.includes(p.code)) throw Object.assign(new Error(`Your live title doesn't contain ${p.code} yet. It can take a minute to update.`), { status: 400 });
    const slug = `${ref.platform === "twitch" ? "" : ref.platform + "-"}${ref.channel.replace(/^@/, "")}`.toLowerCase();
    const existing = this.runners.get(slug);
    if (existing && existing.row.owner_nullifier !== "0") throw Object.assign(new Error("This channel is already claimed."), { status: 409 });
    if (existing) {
      // A house channel being claimed by its real owner: hand it over to a new pool registered to them.
      existing.stop();
      this.runners.delete(slug);
      await run(`DELETE FROM streams WHERE slug = ?`, [slug]);
    }
    const pool = await chain.createStreamPool({ name: `Clutch: ${ref.channel}`, symbol: `c${slug.toUpperCase().slice(0, 8)}`, streamer: p.address, streamerNullifier: BigInt(p.nullifier), latencyBuffer: config.twitchLatencyBufferSec });
    const row = await this.insertStream({
      slug,
      kind: "video",
      title: p.title?.trim() || info.author || ref.channel,
      subtitle: ref.platform === "twitch" ? "Twitch" : ref.platform === "kick" ? "Kick" : "YouTube",
      owner: p.address,
      ownerNullifier: p.nullifier,
      pool,
      latency: config.twitchLatencyBufferSec,
      platform: ref.platform,
      channel: ref.channel,
      category: categoryFor(info.game),
    });
    this.addRunner(row as Row);
    return row;
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
    pool?: { token: string; poolId: Hex; key: chain.PoolKeyShape };
    latency?: number;
    platform?: string;
    channel?: string;
    category?: string;
  }) {
    await run(
      `INSERT INTO streams (slug, kind, title, subtitle, lichess_channel, lichess_user, twitch_channel, owner_address, owner_nullifier, pool_id, token, currency0, currency1, latency_buffer, created_at, platform, channel, category)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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
        s.pool?.poolId ?? null,
        s.pool?.token ?? null,
        s.pool?.key.currency0 ?? null,
        s.pool?.key.currency1 ?? null,
        s.latency ?? config.defaultLatencyBufferSec,
        Date.now(),
        s.platform ?? null,
        s.channel ?? null,
        s.category ?? null,
      ],
    );
    return (await one<Row>(`SELECT * FROM streams WHERE slug = ?`, [s.slug]))!;
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

  private warnedNoReaders = false;

  private addRunner(row: Row) {
    if (row.kind === "video" && !this.readers) {
      // Video markets need both 0G readers; there is no fallback that guesses.
      if (!this.warnedNoReaders) log.warn("ZG_API_KEY is not set: video channels are skipped (chess still runs)");
      this.warnedNoReaders = true;
      return;
    }
    const r: Runner = row.kind === "video" ? new VideoRunner(row as Row & { platform: string; channel: string }, this.zg, this.readers!) : new StreamRunner(row, this.zg);
    if (r instanceof VideoRunner) r.on("slots", () => this.allocateSlots());
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

    if (r instanceof VideoRunner) return;
    if (!(r instanceof StreamRunner)) return;
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

  /** Adds the top live Twitch streams in supported games as channels. Pools are created when they first get a slot. */
  private async discoverTwitch() {
    try {
      const live = await discover();
      let added = 0;
      for (const st of live) {
        const slug = st.login.toLowerCase();
        if (this.runners.has(slug)) continue;
        const row = await this.insertStream({ slug, kind: "video", title: st.name, subtitle: "Twitch", owner: chain.owner.address, ownerNullifier: "0", latency: config.twitchLatencyBufferSec, platform: "twitch", channel: slug, category: categoryFor(st.game) });
        this.addRunner(row as Row);
        added++;
      }
      if (added) log.info(`discovered ${added} live Twitch channel${added > 1 ? "s" : ""}`);
      await this.refreshTwitch();
    } catch (e: any) {
      log.warn("twitch discovery", e.message);
    }
  }

  /** Liveness, titles, games and viewer counts for every Twitch channel in one or two Helix calls. */
  private async refreshTwitch() {
    const tw = [...this.runners.values()].filter((r): r is VideoRunner => r instanceof VideoRunner && r.ref.platform === "twitch");
    try {
      const info = await twitchViewers(tw.map((r) => r.ref.channel));
      for (const r of tw) {
        r.helixManaged = true;
        const i = info.get(r.ref.channel.toLowerCase());
        r.applyInfo(i ? { live: true, title: i.title, game: i.game, viewers: i.viewers } : { live: false, viewers: 0 });
      }
    } catch (e: any) {
      log.warn("twitch refresh", e.message);
    }
  }

  private creatingPool = new Set<string>();

  /** Lazily give a channel its market pool the first time it needs one. */
  private async ensurePool(r: VideoRunner) {
    if (r.row.pool_id || this.creatingPool.has(r.row.slug)) return;
    this.creatingPool.add(r.row.slug);
    try {
      const pool = await chain.createStreamPool({ name: `Clutch: ${r.ref.channel}`, symbol: `c${r.ref.channel.toUpperCase().slice(0, 8)}`, streamer: chain.owner.address, streamerNullifier: 0n, latencyBuffer: config.twitchLatencyBufferSec });
      await run(`UPDATE streams SET pool_id = ?, token = ?, currency0 = ?, currency1 = ? WHERE slug = ?`, [pool.poolId, pool.token, pool.key.currency0, pool.key.currency1, r.row.slug]);
      r.row.pool_id = pool.poolId;
      r.state.poolId = pool.poolId;
      log.info(`${r.row.slug}: market pool ready`);
    } catch (e: any) {
      log.warn(`${r.row.slug} pool`, e.shortMessage ?? e.message);
    } finally {
      this.creatingPool.delete(r.row.slug);
    }
  }

  /**
   * Vision is the scarce resource (one model, a few seconds per frame). Grant live, non-rerun channels a slot:
   * channels with an open market first, then gaming categories, then by audience.
   */
  private allocateSlots() {
    const now = Date.now();
    const video = [...this.runners.values()].filter((r): r is VideoRunner => r instanceof VideoRunner);
    // Rotate: a slot that has shown nothing tradeable for a while (a menu, an IRL stream, a HUD with no score) goes to
    // the next channel, so readers spend their time where markets can actually open. A channel someone on Clutch is
    // watching keeps its slot.
    for (const r of video) if (r.unproductive && !r.state.watching) r.benchedUntil = now + BENCH_MS;
    const likely = (c?: string) => (c === "fps" || c === "battle-royale" || c === "sports" || c === "moba" ? 2e8 : c === "irl" || c === "other" ? 0 : 1e8);
    const rank = (r: VideoRunner) => (r.active ? 1e9 : 0) + likely(r.state.category) + r.state.watching * 1e6 + (r.state.platformViewers ?? 0);
    const want = video.filter((r) => r.active || (r.wantsVision && (r.benchedUntil < now || r.state.watching > 0))).sort((a, b) => rank(b) - rank(a));
    // With the AI switched off nothing is read (and no frames are pulled), so it costs nothing.
    const granted = new Set(ZeroG.enabled ? want.slice(0, config.maxVideoStreams) : []);
    for (const r of video) {
      if (granted.has(r) && !r.row.pool_id) void this.ensurePool(r);
      r.setSlot(granted.has(r));
    }
  }

  /** Markets that were open when the engine stopped: resume with their saved timeline, or void if impossible. */
  private async restoreOpenMarkets() {
    const open = await all<any>(`SELECT * FROM markets WHERE phase IN ('trading','locked','window','resolving')`);
    for (const m of open) {
      const onchain = await chain.marketOnchain(Number(m.id)).catch(() => undefined);
      if (!onchain || onchain.status !== 1) continue; // already settled onchain; the indexer reconciles it
      const r = this.runners.get(m.slug);
      if (r instanceof VideoRunner) {
        await r.voidStale([Number(m.id)]);
        continue;
      }
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
      await (r as StreamRunner).restore(m, (gameId, seedA, seedB) => {
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
      this.allocateSlots();
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
      enabled: ZeroG.enabled,
      outOfCredits: ZeroG.outOfCredits,
    };
  }

  /** Flip platform inference on or off at runtime (and for good): readers start or rest within one allocation. */
  async setAi(on: boolean) {
    await ZeroG.setEnabled(on);
    log.info(`AI switched ${on ? "on" : "off"}`);
    this.allocateSlots();
    this.broadcast("global", { type: "agent", agent: this.agentState() });
    return this.agentState();
  }

  async hello(): Promise<ServerMessage> {
    const live = [...this.runners.values()].flatMap((r) => r.live.map((m) => m.view));
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
