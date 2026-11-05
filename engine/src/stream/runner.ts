import { EventEmitter } from "node:events";
import {
  ruleHash as hashRule,
  type MarketView,
  type Ply,
  type Receipt,
  type Refusal,
  type Rule,
  type StreamKind,
  type StreamState,
  type StreamSummary,
} from "@clutch/shared";
import type { Hex } from "viem";
import { config } from "../config";
import { log } from "../log";
import * as chain from "../chain";
import { all, one, run } from "../db";
import { features, interest, propose, SOURCES } from "../ai/moment";
import type { ZeroG } from "../ai/zeroG";
import { resolveRule } from "../resolver";
import { storeEvidence } from "../evidence";
import type { Source } from "../sources/lichess";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export interface StreamRow {
  slug: string;
  kind: StreamKind;
  title: string;
  subtitle: string;
  lichess_channel: string | null;
  lichess_user: string | null;
  twitch_channel: string | null;
  owner_address: string | null;
  owner_nullifier: string | null;
  pool_id: string | null;
  latency_buffer: number;
  vetoed: string;
}

interface Active {
  view: MarketView;
  rule: Rule;
  a: Source;
  b: Source;
  resolving: boolean;
  retryAt?: number;
  lastSaved?: number;
}

/**
 * One channel's loop: watch → moment → open → trade → lock → window → resolve → receipt → cooldown.
 * At most one market per stream is live at a time (the contract enforces it too). Every market and its observed
 * timeline is persisted, so an engine restart resumes resolution instead of abandoning traders.
 */
export class StreamRunner extends EventEmitter {
  state: StreamState;
  active?: Active;
  private a?: Source;
  private b?: Source;
  private lastSettledAt = 0;
  private lastProposalAt = 0;
  private proposing = false;
  private refusedThisGame = new Set<string>();
  private latencySamples: number[] = [];
  private ticker?: NodeJS.Timeout;

  constructor(readonly row: StreamRow, private readonly zg: ZeroG) {
    super();
    this.state = {
      slug: row.slug,
      kind: row.kind,
      title: row.title,
      subtitle: row.subtitle,
      media: { kind: "chess" },
      category: "chess",
      game: "Chess",
      owner: row.owner_address && row.kind === "lichess-user"
        ? { address: row.owner_address as `0x${string}`, lichess: row.lichess_user ?? undefined, twitch: row.twitch_channel ?? undefined, verified: true }
        : undefined,
      live: false,
      watching: 0,
      fen: START_FEN,
      orientation: "white",
      white: { name: "" },
      black: { name: "" },
      plies: 0,
      status: "waiting",
      settledToday: 0,
      volumeToday: 0,
      latencyBufferSec: row.latency_buffer,
      paused: false,
      vetoed: JSON.parse(row.vetoed),
      poolId: (row.pool_id ?? undefined) as Hex | undefined,
      moments: [],
    };
  }

  get poolId(): Hex {
    return this.row.pool_id as Hex;
  }

  start() {
    this.ticker = setInterval(() => void this.tick(), 1000);
  }

  stop() {
    clearInterval(this.ticker);
    this.a?.stop();
    this.b?.stop();
  }

  summary(): StreamSummary {
    const { latencyBufferSec, paused, vetoed, poolId, moments, ...s } = this.state;
    const v = this.active?.view;
    return { ...s, market: v ? { id: v.id, question: v.question, phase: v.phase, priceYes: v.priceYes, lockTime: v.lockTime, volume: v.volume, outcome: v.outcome } : undefined };
  }

  // ─── Sources ─────────────────────────────────────────────────────────────────────────────────

  attach(a: Source, b: Source, orientation: "white" | "black") {
    if (this.a && this.a !== this.active?.a) this.a.stop();
    if (this.b && this.b !== this.active?.b) this.b.stop();
    this.a = a;
    this.b = b;
    this.refusedThisGame.clear();
    this.state.orientation = orientation;
    this.state.live = true;
    a.on("update", () => this.onFacts());
    a.on("closed", () => {
      if (this.a === a) this.idle();
    });
  }

  /** The streamer isn't in a game right now. Open markets keep their own sources until they resolve. */
  idle() {
    if (this.a && this.a !== this.active?.a) this.a.stop();
    if (this.b && this.b !== this.active?.b) this.b.stop();
    this.a = this.b = undefined;
    this.state.live = false;
    this.state.status = "offline";
    this.changed();
  }

  private onFacts() {
    const f = this.a?.facts();
    if (!f) return;
    const last = f.plies[f.plies.length - 1];
    const prevPlies = this.state.plies;
    const wasLive = this.state.status === "started";
    this.state = {
      ...this.state,
      live: f.status === "started" || f.status === "unknown",
      gameId: f.gameId,
      fen: last?.fenAfter ?? START_FEN,
      lastMove: last?.uci,
      white: { ...f.white, ms: f.whiteMs },
      black: { ...f.black, ms: f.blackMs },
      plies: f.plies.length,
      status: f.status,
    };
    if (this.row.kind === "lichess-user" && this.row.lichess_user) {
      this.state.orientation = f.black.name.toLowerCase() === this.row.lichess_user.toLowerCase() ? "black" : "white";
    }
    if (f.clock && this.row.kind !== "lichess-user") this.state.subtitle = `${speedName(f.speed)} ${f.clock.initial / 60}+${f.clock.increment}`;
    if (!wasLive && f.status === "started" && prevPlies === 0) this.moment(`${f.white.name} vs ${f.black.name}`, "game");
    if (last && f.plies.length === prevPlies + 1 && Math.abs(last.material - (f.plies[f.plies.length - 2]?.material ?? 0)) >= 3)
      this.moment(`${last.san}: material ${last.material > 0 ? "+" : ""}${last.material}`, "game");
    if (wasLive && f.status !== "started" && f.status !== "unknown") this.moment(`Game over: ${f.status}${f.winner ? `, ${f.winner} wins` : ""}`, "game");
    this.changed();
    void this.maybeOpen();
  }

  // ─── Opening markets ─────────────────────────────────────────────────────────────────────────

  private async maybeOpen() {
    const f = this.a?.facts();
    if (!f || f.status !== "started" || this.state.paused || this.proposing || this.active || !this.poolId) return;
    const now = Date.now();
    if (now - this.lastSettledAt < config.cooldownSec * 1000 || now - this.lastProposalAt < 8000) return;
    if (this.chainBlocked) return;
    const mode = this.zg.mode;
    if (mode === "paused") return;
    const x = features(f);
    const idleFor = now - Math.max(this.lastSettledAt, this.lastProposalAt);
    const threshold = mode === "degraded" ? 0.7 : 0.45;
    if (interest(x) < threshold && idleFor < (mode === "degraded" ? 60_000 : 25_000)) return;

    this.proposing = true;
    this.lastProposalAt = now;
    try {
      const recent = (await all<{ template: string }>(`SELECT template FROM markets WHERE slug = ? ORDER BY opened_at DESC LIMIT 4`, [this.row.slug])).map((r) => r.template);
      const p = await propose(f, this.zg, this.state.vetoed, (r) => this.refuse(r), recent);
      this.emit("agent");
      if (!p) return;
      const t0 = await chain.chainNow();
      const lockTime = t0 + config.tradingSec;
      const windowStart = lockTime + this.state.latencyBufferSec;
      const windowEnd = windowStart + p.template.windowSeconds;
      const rule: Rule = {
        v: 1,
        adapter: "chess",
        template: p.template.id,
        params: p.params,
        subject: { gameId: f.gameId, white: f.white.name, black: f.black.name },
        question: p.question,
        resolution: p.template.rule(p.params),
        sources: SOURCES,
        lockTime,
        windowStart,
        windowEnd,
        agreement: "Both sources must report the same moves and status over the window, and yield the same verdict. Otherwise VOID.",
      };
      const ruleHash = hashRule(rule);
      const opened = await chain.openMarket({ poolId: this.poolId, ruleHash, lockTime, windowStart, windowEnd, bUsdc: config.liquidityB, pYes: p.pYes });
      const ai = { ...p.ai, headline: p.headline };
      const view: MarketView = {
        id: opened.id,
        slug: this.row.slug,
        streamTitle: this.state.title,
        question: p.question,
        template: p.template.id,
        rule,
        ruleHash,
        phase: "trading",
        openedAt: t0,
        lockTime,
        windowStart,
        windowEnd,
        pYes0: p.pYes,
        priceYes: p.pYes,
        b: config.liquidityB,
        subsidy: opened.subsidy,
        volume: 0,
        trades: 0,
        traders: 0,
        ai,
        tx: { open: opened.tx },
      };
      await run(
        `INSERT OR REPLACE INTO markets (id, slug, question, template, rule, rule_hash, ai, p_yes0, price_yes, b, subsidy, opened_at, lock_time, window_start, window_end, phase, tx_open, game_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [view.id, view.slug, view.question, view.template, JSON.stringify(rule), ruleHash, JSON.stringify(ai), view.pYes0, view.priceYes, view.b, view.subsidy, view.openedAt, lockTime, windowStart, windowEnd, "trading", opened.tx, f.gameId],
      );
      this.active = { view, rule, a: this.a!, b: this.b!, resolving: false };
      log.market(`${this.row.slug} #${view.id}`, `"${p.question}"`, `p=${p.pYes}`, p.ai.provider, p.ai.requestId ?? "");
      this.moment(`New market: ${p.question}`, "market");
      this.emit("market", view);
      this.changed();
    } catch (e: any) {
      log.error(`${this.row.slug} open failed`, e.shortMessage ?? e.message);
    } finally {
      this.proposing = false;
    }
  }

  /** Set by the hub: true while the chain is not safe to trade (Blackout Guard). */
  chainBlocked = false;

  private refuse(r: Omit<Refusal, "slug">) {
    const key = `${r.template}:${r.reason}`;
    if (this.refusedThisGame.has(key)) return;
    this.refusedThisGame.add(key);
    const full: Refusal = { ...r, slug: this.row.slug };
    void run(`INSERT INTO refusals (slug, at, json) VALUES (?,?,?)`, [this.row.slug, full.at, JSON.stringify(full)]);
    this.emit("refusal", full);
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────────────────────

  private async tick() {
    const act = this.active;
    if (!act) return;
    const now = Date.now() / 1000;
    const v = act.view;
    const phase = now < v.lockTime ? "trading" : now < v.windowStart ? "locked" : act.resolving ? "resolving" : "window";
    if (phase !== v.phase) {
      v.phase = phase;
      if (phase === "locked") this.moment(`Trading closed. Window opens in ${this.state.latencyBufferSec}s`, "integrity");
      if (phase === "window") act.b.setActive?.(true);
      void run(`UPDATE markets SET phase = ? WHERE id = ?`, [phase, v.id]);
      this.emit("market", v);
      this.changed();
    }
    if (now >= v.lockTime && (!act.lastSaved || Date.now() - act.lastSaved > 5000)) {
      act.lastSaved = Date.now();
      void run(`UPDATE markets SET timeline = ? WHERE id = ?`, [JSON.stringify({ a: act.a.facts()?.plies ?? [], b: act.b.facts()?.plies ?? [] }), v.id]);
    }
    if (now >= v.windowStart && !act.resolving && (act.retryAt ?? 0) <= Date.now()) {
      const res = resolveRule(act.rule, act.a.facts(), act.b.facts());
      if (res.state === "final") {
        act.resolving = true;
        void this.settle(act, res.verdict, res.voidReason, res.readings);
      }
    }
  }

  private async settle(act: Active, verdict: "YES" | "NO" | "VOID", voidReason: string | undefined, readings: Receipt["readings"]) {
    const v = act.view;
    v.phase = "resolving";
    this.emit("market", v);
    try {
      const bundle = {
        kind: "clutch.evidence.v1",
        market: { id: v.id, chainId: config.chainId, hook: config.deployment.clutchHook, poolId: this.poolId, stream: this.row.slug },
        rule: act.rule,
        ruleHash: v.ruleHash,
        verdict,
        voidReason,
        readings,
        rawFacts: { a: act.a.facts(), b: act.b.facts() },
        agent: { address: chain.agent.address, decision: v.ai },
        createdAt: Date.now(),
      };
      const stored = await storeEvidence(bundle);
      const r = await chain.resolveMarket(v.id, verdict, stored.root);
      v.phase = r.outcome === "VOID" ? "void" : "settled";
      v.outcome = r.outcome;
      v.voidReason = r.blackout ? "The sequencer went down while this market was trading, so Blackout Guard voided it." : voidReason;
      v.tx.resolve = r.tx;
      const receipt: Receipt = {
        marketId: v.id,
        slug: v.slug,
        question: v.question,
        rule: act.rule,
        ruleHash: v.ruleHash,
        readings,
        verdict: r.outcome,
        voidReason: v.voidReason,
        blackout: r.blackout,
        evidenceRoot: stored.root,
        storage: { provider: stored.provider, txHash: stored.txHash, uri: stored.uri },
        resolvedAt: Date.now(),
        tx: r.tx,
        ai: v.ai,
      };
      await run(`UPDATE markets SET phase = ?, outcome = ?, void_reason = ?, tx_resolve = ?, resolved_at = ? WHERE id = ?`, [v.phase, r.outcome, v.voidReason ?? null, r.tx, receipt.resolvedAt, v.id]);
      await run(`INSERT OR REPLACE INTO receipts (market_id, slug, json, resolved_at) VALUES (?,?,?,?)`, [v.id, v.slug, JSON.stringify(receipt), receipt.resolvedAt]);
      log.market(`${this.row.slug} #${v.id} ${r.outcome}`, voidReason ?? "", stored.root);
      this.moment(r.outcome === "VOID" ? `Voided: everyone refunded` : `Settled ${r.outcome}`, "market");
      this.emit("market", v);
      this.emit("receipt", receipt);
    } catch (e: any) {
      log.warn(`${this.row.slug} settle deferred; retrying in 5s`, e.shortMessage ?? e.message);
      act.resolving = false;
      act.retryAt = Date.now() + 5000;
      return;
    }
    act.b.setActive?.(false);
    if (act.a !== this.a) act.a.stop();
    if (act.b !== this.b) act.b.stop();
    this.active = undefined;
    this.lastSettledAt = Date.now();
    this.changed();
  }

  /** After a restart: resume a market that was open when the engine stopped. */
  async restore(m: { id: number; rule: string; ai: string; rule_hash: string; p_yes0: number; price_yes: number; b: number; subsidy: number; opened_at: number; tx_open: string; timeline: string | null; game_id: string }, sources: (gameId: string, seedA: Ply[], seedB: Ply[]) => [Source, Source]) {
    const rule: Rule = JSON.parse(m.rule);
    const tl = m.timeline ? (JSON.parse(m.timeline) as { a: Ply[]; b: Ply[] }) : { a: [], b: [] };
    const [a, b] = sources(m.game_id, tl.a, tl.b);
    const stats = await one<{ volume: number; trades: number; traders: number }>(
      `SELECT COALESCE(SUM(amount),0) volume, COUNT(*) trades, COUNT(DISTINCT trader) traders FROM trades WHERE market_id = ?`,
      [m.id],
    );
    const view: MarketView = {
      id: m.id,
      slug: this.row.slug,
      streamTitle: this.state.title,
      question: rule.question,
      template: rule.template,
      rule,
      ruleHash: m.rule_hash as Hex,
      phase: "window",
      openedAt: m.opened_at,
      lockTime: rule.lockTime,
      windowStart: rule.windowStart,
      windowEnd: rule.windowEnd,
      pYes0: m.p_yes0,
      priceYes: m.price_yes,
      b: m.b,
      subsidy: m.subsidy,
      volume: stats?.volume ?? 0,
      trades: stats?.trades ?? 0,
      traders: stats?.traders ?? 0,
      ai: JSON.parse(m.ai),
      tx: { open: m.tx_open as Hex },
    };
    b.setActive?.(true);
    this.active = { view, rule, a, b, resolving: false };
    log.info(`${this.row.slug}: resumed market #${m.id} after restart`);
  }

  onTrade(marketId: number, amount: number, priceYesAfter: number, newTrader: boolean) {
    const v = this.active?.view;
    if (!v || v.id !== marketId) return;
    v.priceYes = priceYesAfter;
    v.volume += amount;
    v.trades += 1;
    if (newTrader) v.traders += 1;
    this.emit("market", v);
    this.changed();
  }

  // ─── Controls ────────────────────────────────────────────────────────────────────────────────

  async setVetoed(vetoed: string[]) {
    this.state.vetoed = vetoed;
    await run(`UPDATE streams SET vetoed = ? WHERE slug = ?`, [JSON.stringify(vetoed), this.row.slug]);
    this.changed();
  }

  setPaused(p: boolean) {
    if (p === this.state.paused) return;
    this.state.paused = p;
    this.moment(p ? "Markets paused by the streamer" : "Markets resumed", "integrity");
    this.changed();
  }

  /** Viewers report player latency (e.g. Twitch `hlsLatencyBroadcaster`); the buffer follows the slow tail. */
  async reportLatency(ms: number) {
    if (!(ms > 0 && ms < 120_000) || !this.poolId) return;
    this.latencySamples = [...this.latencySamples, ms].slice(-200);
    const sorted = [...this.latencySamples].sort((x, y) => x - y);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? ms;
    const want = Math.max(this.row.latency_buffer, Math.ceil((p95 * 1.5) / 1000));
    if (want > this.state.latencyBufferSec && !this.active) {
      await chain.setLatencyBuffer(this.poolId, want);
      this.state.latencyBufferSec = want;
      await run(`UPDATE streams SET latency_buffer = ? WHERE slug = ?`, [want, this.row.slug]);
      this.moment(`Latency buffer raised to ${want}s (viewers' p95 delay ${(p95 / 1000).toFixed(1)}s)`, "integrity");
      this.changed();
    }
  }

  latencyStats() {
    const s = [...this.latencySamples].sort((x, y) => x - y);
    return { samples: s.length, p50: s[Math.floor(s.length / 2)] ?? null, p95: s[Math.floor(s.length * 0.95)] ?? null };
  }

  private moment(text: string, kind: "game" | "market" | "integrity") {
    this.state.moments = [{ at: Date.now(), text, kind }, ...this.state.moments].slice(0, 40);
  }

  private changed() {
    this.emit("state");
  }
}

function speedName(s?: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : "Live";
}
