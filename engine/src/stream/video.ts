import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  categoryFor,
  counterRule,
  defaultQuestion,
  evaluateCounter,
  ruleHash as hashRule,
  tradeable,
  type AiDecision,
  type Category,
  type CounterKind,
  type CounterReading,
  type CounterSpec,
  type MarketView,
  type Receipt,
  type Refusal,
  type Rule,
  type SceneState,
  type SourceReading,
  type StreamState,
  type StreamSummary,
} from "@clutch/shared";
import { keccak256, toBytes, type Hex } from "viem";
import { config } from "../config";
import { log } from "../log";
import * as chain from "../chain";
import { all, run } from "../db";
import { ZeroG } from "../ai/zeroG";
import { storeEvidence } from "../evidence";
import { FrameSampler, grabFrame, probe, type ChannelRef, type Frame } from "../video/capture";
import type { VisionReader } from "../video/perceive";
import type { StreamRow } from "./runner";

const framesDir = join(config.dataDir, "frames");
mkdirSync(framesDir, { recursive: true });

interface Live {
  view: MarketView;
  rule: Rule;
  spec: CounterSpec;
  /** reader B's readings: window start, any confirming checks, window end */
  b: CounterReading[];
  bStarted: boolean;
  /** reader B actually read the window start (a failed start read leaves B without a verdict) */
  bStartRead?: boolean;
  checking: boolean;
  resolving: boolean;
  retryAt?: number;
  frames: { at: number; sha: string; reader: string; note: string }[];
}

interface Reading {
  at: number;
  sha: string;
  state: SceneState;
}

const MAX_LIVE = 2; // one trading + one playing out, so there's almost always something to trade

/**
 * A live video channel (Twitch, Kick, YouTube).
 *
 * Reader A (0G vision) reads every sampled frame in one pass: mode, survival, and every counter on the HUD.
 * The 0G agent turns steady, contested counters into markets ("Clix eliminations go up in the next 45s?").
 * Reader B (a different model family) independently reads just that counter on its own frames over its own
 * connection: before opening, at window start, when A sees the outcome early, and at window end. Both must reach
 * the same verdict or the market voids and everyone is refunded. Reruns never get markets.
 */
export class VideoRunner extends EventEmitter {
  state: StreamState;
  readonly ref: ChannelRef;
  private live: Live[] = [];
  private sampler?: FrameSampler;
  private timeline: Reading[] = [];
  private perceiving = false;
  private lastProposalAt = 0;
  private proposing = false;
  private refused = new Set<string>();
  private recentQuestions: string[] = [];
  /** spec keys of the most recent markets, newest first: the hard no-repeat rule reads this */
  private recentKeys: string[] = [];
  private ticker?: NodeJS.Timeout;
  private prober?: NodeJS.Timeout;
  private category: Category = "other";
  chainBlocked = false;
  slotGranted = false;
  helixManaged = false;

  constructor(readonly row: StreamRow & { platform: string; channel: string; category: string | null }, private readonly zg: ZeroG, private readonly readers: { a: VisionReader; b: VisionReader; independent: string }) {
    super();
    this.ref = { platform: row.platform as ChannelRef["platform"], channel: row.channel };
    this.category = (row.category as Category) ?? "other";
    this.state = {
      slug: row.slug,
      kind: "video",
      title: row.title,
      subtitle: row.subtitle,
      media: { kind: "video", platform: this.ref.platform, channel: this.ref.channel },
      category: this.category,
      owner: row.owner_address && row.owner_nullifier !== "0" ? { address: row.owner_address as `0x${string}`, verified: true } : undefined,
      live: false,
      watching: 0,
      fen: "",
      orientation: "white",
      white: { name: "" },
      black: { name: "" },
      plies: 0,
      status: "offline",
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

  /** The market a viewer should see first: the one still trading, else the newest. */
  get active() {
    const pick = this.live.find((m) => m.view.phase === "trading") ?? this.live[this.live.length - 1];
    return pick ? { view: pick.view } : undefined;
  }

  get wantsVision() {
    return this.state.live && !this.state.rerun;
  }

  start() {
    this.ticker = setInterval(() => void this.tick(), 1000);
    this.prober = setInterval(() => void this.refreshInfo(), 60_000);
    void this.refreshInfo();
  }

  stop() {
    clearInterval(this.ticker);
    clearInterval(this.prober);
    this.sampler?.stop();
  }

  summary(): StreamSummary {
    const { latencyBufferSec, paused, vetoed, poolId, moments, ...s } = this.state;
    const v = this.active?.view;
    return { ...s, market: v ? { id: v.id, question: v.question, phase: v.phase, priceYes: v.priceYes, lockTime: v.lockTime, volume: v.volume, outcome: v.outcome } : undefined };
  }

  // ─── Liveness ────────────────────────────────────────────────────────────────────────────────

  applyInfo(info: { live: boolean; title?: string; game?: string; viewers?: number }) {
    if (info.viewers !== undefined) this.state.platformViewers = info.viewers;
    this.updateInfo({ live: info.live, title: info.title, game: info.game, rerun: /\b(rerun|re-run|vod|replay|rebroadcast|highlights?)\b/i.test(info.title ?? "") });
  }

  private async refreshInfo() {
    if (this.helixManaged) return;
    this.updateInfo(await probe(this.ref));
  }

  private updateInfo(info: { live: boolean; title?: string; game?: string; rerun: boolean }) {
    const wasLive = this.state.live;
    this.state.live = info.live;
    this.state.rerun = info.rerun;
    this.state.status = info.live ? "live" : "offline";
    if (info.title) this.state.streamTitle = info.title;
    if (info.game) {
      this.state.game = info.game;
      this.category = categoryFor(info.game);
      this.state.category = this.category;
    }
    if (info.live && !wasLive) this.moment(`Live${info.game ? ` · ${info.game}` : ""}`, "game");
    if (!info.live && wasLive) this.moment("Stream ended", "game");
    this.emit("slots");
    this.changed();
  }

  setSlot(granted: boolean) {
    if (granted === this.slotGranted) return;
    this.slotGranted = granted;
    this.state.reading = granted;
    if (granted) {
      this.sampler = new FrameSampler(this.ref, { intervalSec: 2, width: 1024, keep: 60 }).start();
      this.sampler.on("frame", (f: Frame) => {
        this.state.frameAt = f.at;
        writeFileSync(join(framesDir, `${this.row.slug}.jpg`), f.jpeg);
        void this.perceive(f);
      });
    } else {
      this.sampler?.stop();
      this.sampler = undefined;
    }
    this.changed();
  }

  // ─── Reader A ────────────────────────────────────────────────────────────────────────────────

  private async perceive(f: Frame) {
    if (this.perceiving) return; // the next frame is fresher anyway
    this.perceiving = true;
    try {
      const r = await this.readers.a.discover(f.jpeg, this.state.game);
      this.timeline.push({ at: f.at, sha: f.sha, state: r.state });
      if (this.timeline.length > 300) this.timeline.splice(0, 60);
      this.state.vision = { state: r.state, at: f.at, reader: this.readers.a.name, ms: r.ms };
      this.changed();
      // A decisive change for a live market: ask B to confirm right away.
      for (const m of this.live) if (m.view.phase === "window" && !m.resolving && this.evalA(m, false) !== "PENDING") void this.confirm(m);
      void this.maybeOpen();
    } catch (e: any) {
      log.warn(`${this.row.slug} reader A`, e.message);
    } finally {
      this.perceiving = false;
    }
  }

  /** Counters read with the same value in at least two of the last three readings: safe to build a market on. */
  private steadyCounters() {
    const recent = this.timeline.slice(-3).filter((r) => r.state.mode === "gameplay");
    if (recent.length < 2) return [];
    const latest = recent[recent.length - 1].state.counters ?? [];
    return latest.filter((c) => recent.slice(0, -1).some((r) => r.state.counters?.some((x) => x.key === c.key && Math.abs(x.value - c.value) <= Math.max(1, c.value * 0.2))) && tradeable(c.key, c.label));
  }

  // ─── Opening ─────────────────────────────────────────────────────────────────────────────────

  private async maybeOpen() {
    if (this.proposing || this.state.paused || this.chainBlocked || !this.poolId || this.state.rerun) return;
    if (this.live.some((m) => m.view.phase === "trading") || this.live.length >= MAX_LIVE) return;
    if (Date.now() - this.lastProposalAt < 6000) return;
    const latest = this.timeline[this.timeline.length - 1];
    if (!latest || latest.state.mode !== "gameplay") return;
    const counters = this.steadyCounters();
    const pov = latest.state.povAlive === true && this.timeline.slice(-3).filter((r) => r.state.povAlive === true).length >= 2;
    if (!counters.length && !pov) return;

    this.proposing = true;
    this.lastProposalAt = Date.now();
    try {
      const pick = await this.choose(counters, latest.state, pov);
      if (!pick) return;
      // Reader B must see the counter on its own frame before money goes on it.
      const keys = this.keysOf(pick.spec);
      if (keys.length) {
        const fb = await grabFrame(this.ref, 1024);
        const rb = await this.readers.b.readKeys(fb.jpeg, keys);
        if (rb.mode !== "gameplay" || keys.some((k) => rb.values[k.key] === null)) {
          log.info(`${this.row.slug}: reader B can't see "${pick.spec.label}"; skipping`);
          return;
        }
      }
      await this.open(pick.spec, pick.question, pick.p, pick.ai, latest.state);
    } catch (e: any) {
      log.warn(`${this.row.slug} open failed`, e.shortMessage ?? e.message);
    } finally {
      this.proposing = false;
    }
  }

  private keysOf(s: CounterSpec) {
    if (s.key === "__pov_alive") return [];
    return [{ key: s.key, label: s.label }, ...(s.key2 ? [{ key: s.key2, label: s.label2 ?? s.key2 }] : [])];
  }

  /** The 0G agent picks a counter, a kind, a threshold and a window, prices it, and phrases the question. */
  /**
   * A viewer asks for a market now, paying the agent's inference with their own 0G account. Skips the wait for a
   * "tense" moment, but every integrity rule still applies (live gameplay, both readers, no repeats, no reruns).
   */
  async callMarket(viewer: ZeroG): Promise<{ ok: true; marketId: number; question: string; costUsd: number; requestId?: string } | { ok: false; reason: string }> {
    if (!this.state.live) return { ok: false, reason: "This channel is offline." };
    if (this.state.rerun) return { ok: false, reason: "Reruns never get markets: the result already happened." };
    if (!this.slotGranted) return { ok: false, reason: "The AI isn't reading this channel right now. Try one marked AI watching." };
    if (this.live.some((m) => m.view.phase === "trading")) return { ok: false, reason: "A market is already open. Trade that one first." };
    if (this.live.length >= MAX_LIVE) return { ok: false, reason: "Two markets are already playing out. The next one opens in a moment." };
    if (this.proposing) return { ok: false, reason: "The AI is already creating a market." };
    const latest = this.timeline[this.timeline.length - 1];
    if (!latest || latest.state.mode !== "gameplay") return { ok: false, reason: `The AI sees ${latest ? `a ${latest.state.mode} screen` : "nothing yet"}. Markets open during live gameplay.` };
    this.proposing = true;
    this.lastProposalAt = Date.now();
    try {
      const counters = this.steadyCounters();
      const pov = latest.state.povAlive === true;
      this.lastDecline = "";
      const pick = await this.choose(counters, latest.state, pov, viewer, 1);
      if (!pick) return { ok: false, reason: `No fair market right now: ${this.lastDecline || "nothing on screen is uncertain enough"}. Try again in a few seconds.` };
      const keys = this.keysOf(pick.spec);
      if (keys.length) {
        const fb = await grabFrame(this.ref, 1024);
        const rb = await this.readers.b.readKeys(fb.jpeg, keys);
        if (rb.mode !== "gameplay" || keys.some((k) => rb.values[k.key] === null)) return { ok: false, reason: `The second reader can't see "${pick.spec.label}" right now, so it can't be settled fairly.` };
      }
      const id = await this.open(pick.spec, pick.question, pick.p, { ...pick.ai, paidBy: "viewer" }, latest.state);
      return { ok: true, marketId: id, question: pick.question, costUsd: pick.ai.costUsd ?? 0, requestId: pick.ai.requestId };
    } catch (e: any) {
      return { ok: false, reason: /401|403|auth/i.test(e.message) ? "0G rejected that key. Check it at pc.0g.ai." : /402|insufficient|balance/i.test(e.message) ? "Your 0G balance is too low for this call." : "The AI couldn't create a market just now." };
    } finally {
      this.proposing = false;
    }
  }

  /** Why the last choose() came back empty, for the viewer who asked and for the log. */
  private lastDecline = "";
  private decline(why: string) {
    this.lastDecline = why;
    log.info(`${this.row.slug}: no market (${why})`);
    return null;
  }

  private async choose(allCounters: { key: string; label: string; value: number }[], s: SceneState, povAvailable: boolean, zg: ZeroG = this.zg, memory = 3) {
    // Hard no-repeat rule, enforced here rather than requested in the prompt: a counter can't carry two of the last
    // `memory` markets, and "survives" can't run twice in a row. A viewer calling a market explicitly gets memory 1
    // (never the same market back to back), since a HUD with one counter would otherwise refuse them for minutes.
    const banned = new Set(this.recentKeys.slice(0, memory));
    const counters = allCounters.filter((c) => !banned.has(c.key));
    const pov = povAvailable && !this.recentKeys.slice(0, Math.min(2, memory)).includes("__pov_alive");
    if (!counters.length && !pov) return this.decline("every number on screen carried one of the last few markets");
    const recent = this.live.map((m) => m.spec.key);
    if (zg.provider === "0g") {
      const history = this.timeline.slice(-8).map((r) => ({ t: Math.round((r.at - Date.now()) / 1000), mode: r.state.mode, counters: Object.fromEntries((r.state.counters ?? []).map((c) => [c.key, c.value])) }));
      try {
        const res = await zg.json<{ kind: CounterKind | "survives"; key: string; key2?: string; threshold?: number; seconds: number; pYes: number; question: string; contested: boolean; rationale: string }>(
          `You create live prediction markets for Clutch from what's on a stream's screen. Pick ONE market that is genuinely uncertain and exciting in the next 20-60 seconds.
Allowed kinds:
- goes_up: a counter increases (kills, eliminations, team score)
- reaches: a counter reaches a threshold
- drops_below: a counter falls below a threshold (players left, health, shield)
- race: counter key increases before counter key2 (e.g. which team scores first)
- survives: the streamer's player is still alive at the end (only if povAlive, and only when no counter makes a good market)
Rules: use only the counter keys provided; never use counters the streamer alone controls (ammo, money spent) or clocks; it must be contested by opponents or chance. seconds between 20 and 60. pYes is your calibrated probability (viewers trade against it), between 0.15 and 0.85. question: natural, punchy, at most 60 characters, ends with "?", must mean exactly the structured rule (name the team/player when known). Prefer counter markets (scores, kills, players left) over "survives". Vary the market: avoid repeating recent ones: ${JSON.stringify([...recent, ...this.recentQuestions])}.
Respond with JSON only: {"kind","key","key2","threshold","seconds","pYes","question","contested","rationale"}`,
          JSON.stringify({ game: s.game ?? this.state.game, streamTitle: this.state.streamTitle, summary: s.summary, povAlive: s.povAlive, counters, history }),
        );
        const d = res.data;
        const ai: AiDecision = { provider: "0g", model: config.zgModel, requestId: res.requestId, latencyMs: res.latencyMs, costUsd: res.costUsd, rationale: d.rationale };
        const p = Math.round(Number(d.pYes) * 100) / 100;
        const seconds = Math.max(20, Math.min(60, Math.round(Number(d.seconds) || 45)));
        if (d.contested === false) return this.refuse(d.question ?? "AI proposal", "steerable", "One person could decide it.");
        if (!(p >= 0.15 && p <= 0.85)) return this.refuse(d.question ?? "AI proposal", "not-uncertain", `Opening probability ${Math.round(p * 100)}% is outside 15-85%.`);
        let spec: CounterSpec;
        if (d.kind === "survives") {
          if (!pov) return this.decline("the AI wanted a survival market, which just ran"); // banned by the no-repeat rule or not visible
          spec = { kind: "goes_up", key: "__pov_alive", label: "Streamer alive", seconds };
        } else {
          const c = counters.find((x) => x.key === d.key);
          const c2 = d.key2 ? counters.find((x) => x.key === d.key2) : undefined;
          if (!c || (d.kind === "race" && !c2) || banned.has(c.key)) return this.decline(`the AI picked "${d.key}", which isn't on screen or just ran`);
          if (!["goes_up", "reaches", "drops_below", "race"].includes(d.kind)) return this.decline(`unknown market kind "${d.kind}"`);
          spec = { kind: d.kind, key: c.key, label: c.label, key2: c2?.key, label2: c2?.label, threshold: d.threshold !== undefined && d.threshold !== null ? Number(d.threshold) : undefined, seconds };
          // A threshold that's already met isn't a question.
          if (spec.kind === "reaches" && !(Number(spec.threshold) > c.value)) return this.decline("the threshold was already reached");
          if (spec.kind === "drops_below" && !(Number(spec.threshold) <= c.value)) return this.decline("the threshold was already passed");
        }
        const question = typeof d.question === "string" && d.question.length <= 70 && d.question.trim().endsWith("?") ? d.question.trim() : defaultQuestion(spec);
        return { spec, question, p, ai };
      } catch (e: any) {
        // A viewer's call surfaces its own 0G error (bad key, no balance) instead of a vague "nothing fair".
        if (zg.payer === "viewer") throw e;
        log.warn(`${this.row.slug} 0G moment call`, e.message);
        return null;
      }
    }
    // Without 0G: the first steady contested counter, at an even-ish base rate.
    const c = counters[0];
    if (!c && pov) {
      const spec: CounterSpec = { kind: "goes_up", key: "__pov_alive", label: "Streamer alive", seconds: 45 };
      return { spec, question: "Streamer survives the next 45s?", p: 0.6, ai: { provider: "heuristic", model: "base rates", rationale: "Survival base rate." } as AiDecision };
    }
    if (!c) return null;
    const spec: CounterSpec = { kind: "goes_up", key: c.key, label: c.label, seconds: 45 };
    return { spec, question: defaultQuestion(spec), p: 0.45, ai: { provider: "heuristic", model: "base rates", rationale: `Read "${c.label}" = ${c.value} from the stream.` } as AiDecision };
  }

  private refuse(question: string, reason: Refusal["reason"], detail: string) {
    this.lastDecline = `the AI's idea ("${question}") was refused: ${detail.replace(/\.$/, "").toLowerCase()}`;
    const key = `${reason}:${question}`;
    if (this.refused.has(key)) return null;
    this.refused.add(key);
    const r: Refusal = { at: Date.now(), slug: this.row.slug, template: "counter", question, reason, detail };
    void run(`INSERT INTO refusals (slug, at, json) VALUES (?,?,?)`, [this.row.slug, r.at, JSON.stringify(r)]);
    this.emit("refusal", r);
    return null;
  }

  private async open(spec: CounterSpec, question: string, p: number, ai: AiDecision, s: SceneState): Promise<number> {
    const t0 = await chain.chainNow();
    const lockTime = t0 + config.videoTradingSec;
    const windowStart = lockTime + this.state.latencyBufferSec;
    const windowEnd = windowStart + spec.seconds;
    const rule: Rule = {
      v: 1,
      adapter: "vision",
      template: spec.key === "__pov_alive" ? "survives" : `counter:${spec.kind}`,
      params: { ...spec },
      subject: { stream: `${this.ref.platform}:${this.ref.channel}`, scene: s.game ?? s.scene, teams: [s.teamA, s.teamB].filter(Boolean) as string[] },
      question,
      resolution: spec.key === "__pov_alive" ? `YES if the streamer's player is still alive at window end (${spec.seconds}s). NO if they are eliminated first.` : counterRule(spec),
      sources: [this.readers.a.name, this.readers.b.name],
      lockTime,
      windowStart,
      windowEnd,
      agreement: "Both readers, each on its own frames, must reach the same verdict. Otherwise VOID.",
    };
    const ruleHash = hashRule(rule);
    const opened = await chain.openMarket({ poolId: this.poolId, ruleHash, lockTime, windowStart, windowEnd, bUsdc: config.liquidityB, pYes: p });
    const view: MarketView = {
      id: opened.id,
      slug: this.row.slug,
      streamTitle: this.state.title,
      question,
      template: rule.template,
      rule,
      ruleHash,
      phase: "trading",
      openedAt: t0,
      lockTime,
      windowStart,
      windowEnd,
      pYes0: p,
      priceYes: p,
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
      [view.id, view.slug, question, view.template, JSON.stringify(rule), ruleHash, JSON.stringify(ai), p, p, view.b, view.subsidy, t0, lockTime, windowStart, windowEnd, "trading", opened.tx, `${this.ref.platform}:${this.ref.channel}`],
    );
    this.live.push({ view, rule, spec, b: [], bStarted: false, checking: false, resolving: false, frames: [] });
    this.recentQuestions = [question, ...this.recentQuestions].slice(0, 5);
    this.recentKeys = [spec.key, ...this.recentKeys].slice(0, 6);
    log.market(`${this.row.slug} #${view.id}`, `"${question}"`, `p=${p}`, ai.provider, ai.requestId ?? "");
    this.moment(ai.paidBy === "viewer" ? `A viewer called a market: ${question}` : `New market: ${question}`, "market");
    this.emit("market", view);
    this.changed();
    return view.id;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────────────────────

  private async tick() {
    const now = Date.now() / 1000;
    for (const m of [...this.live]) {
      const v = m.view;
      const phase = now < v.lockTime ? "trading" : now < v.windowStart ? "locked" : m.resolving ? "resolving" : "window";
      if (phase !== v.phase) {
        v.phase = phase;
        if (phase === "locked") void this.maybeOpen(); // the next round can open while this one plays out
        void run(`UPDATE markets SET phase = ? WHERE id = ?`, [phase, v.id]);
        this.emit("market", v);
        this.changed();
      }
      if (now >= v.windowStart && !m.bStarted && !m.checking) void this.readB(m, "start");
      if (now >= v.windowEnd + 1 && !m.resolving && (m.retryAt ?? 0) <= Date.now()) void this.finish(m);
      if (now > v.windowEnd + 120 && !m.resolving) void this.finish(m, "The stream stopped giving readable frames.");
    }
  }

  private povReading(alive: boolean | null) {
    return { __pov_alive: alive === null ? null : alive ? 0 : 1 };
  }

  /** Reader A's view of a market, from the timeline. */
  private evalA(m: Live, ended: boolean) {
    const ws = m.view.windowStart * 1000;
    const toReading = (r: Reading): CounterReading => ({ at: r.at, values: m.spec.key === "__pov_alive" ? this.povReading(r.state.povAlive) : Object.fromEntries((r.state.counters ?? []).map((c) => [c.key, c.value])) });
    const start = [...this.timeline].reverse().find((r) => r.at <= ws);
    const during = this.timeline.filter((r) => r.at > ws && r.at <= m.view.windowEnd * 1000 + 2500 && r.state.mode === "gameplay").map(toReading);
    // A reader that didn't see the start, or saw nothing in the window, has no verdict; the market voids.
    if (!start || !during.length) return "PENDING";
    if (m.spec.key === "__pov_alive") return this.survived(toReading(start), during, ended);
    return evaluateCounter(m.spec, toReading(start), during, ended);
  }

  private evalB(m: Live, ended: boolean) {
    const [start, ...rest] = m.b;
    if (!m.bStartRead || !start || !rest.length) return "PENDING";
    if (m.spec.key === "__pov_alive") return this.survived(start, rest, ended);
    return evaluateCounter(m.spec, start, rest, ended);
  }

  /** "Survives" = an alive(0)/dead(1) counter that must not go up. */
  private survived(start: CounterReading, during: CounterReading[], ended: boolean) {
    if (start.values.__pov_alive !== 0) return "PENDING"; // not seen alive at the start: nothing to survive
    const died = evaluateCounter({ kind: "goes_up", key: "__pov_alive", label: "", seconds: 0 }, start, during, ended);
    return died === "PENDING" ? "PENDING" : died === "YES" ? "NO" : "YES";
  }

  /** Reader B reads this market's counter on a fresh frame over its own connection. */
  private async readB(m: Live, why: "start" | "confirm" | "end") {
    if (m.checking) return;
    m.checking = true;
    try {
      const f = await grabFrame(this.ref, 1024);
      writeFileSync(join(framesDir, `${f.sha}.jpg`), f.jpeg);
      let values: Record<string, number | null>;
      let mode: SceneState["mode"];
      if (m.spec.key === "__pov_alive") {
        const r = await this.readers.b.discover(f.jpeg, this.state.game);
        mode = r.state.mode;
        values = this.povReading(r.state.povAlive);
      } else {
        const r = await this.readers.b.readKeys(f.jpeg, this.keysOf(m.spec));
        mode = r.mode;
        values = r.values;
      }
      const reading: CounterReading = { at: f.at, values };
      if (why === "start") {
        m.b.unshift(reading);
        m.bStarted = true;
        m.bStartRead = true;
      } else m.b.push(reading);
      const fmt = (k: string, x: number | null) => (k === "__pov_alive" ? `alive: ${x === 0 ? "yes" : x === 1 ? "no" : "?"}` : `${m.spec.key === k ? m.spec.label : m.spec.label2}: ${x ?? "?"}`);
      m.frames.push({ at: f.at, sha: f.sha, reader: this.readers.b.name, note: `${why} · ${Object.entries(values).map(([k, x]) => fmt(k, x)).join(", ")} · ${mode}` });
    } catch (e: any) {
      log.warn(`${this.row.slug} reader B`, e.message);
      if (why === "start") m.bStarted = true; // no start reading → B can't confirm → void at the end
    } finally {
      m.checking = false;
    }
  }

  /** A saw the outcome early: if B confirms on its own frame, settle now instead of waiting out the window. */
  private async confirm(m: Live) {
    if (m.checking || m.resolving || !m.bStarted) return;
    const evA = this.evalA(m, false);
    if (evA === "PENDING") return;
    await this.readB(m, "confirm");
    if (this.evalB(m, false) === evA) void this.finish(m);
  }

  private async finish(m: Live, forcedVoid?: string) {
    if (m.resolving) return;
    m.resolving = true;
    try {
      const ended = Date.now() / 1000 >= m.view.windowEnd;
      if (ended && !forcedVoid) await this.readB(m, "end");
      const evA = this.evalA(m, ended || Boolean(forcedVoid));
      const evB = this.evalB(m, ended || Boolean(forcedVoid));
      let verdict: "YES" | "NO" | "VOID" = evA === evB && evA !== "PENDING" ? evA : "VOID";
      let reason = forcedVoid;
      if (forcedVoid) verdict = "VOID";
      else if (verdict === "VOID") reason = evA === "PENDING" || evB === "PENDING" ? "A reader couldn't see the result on screen." : `The readers disagreed (${evA} vs ${evB}).`;
      await this.settle(m, verdict, reason, evA, evB);
    } catch (e: any) {
      log.warn(`${this.row.slug} settle deferred`, e.shortMessage ?? e.message);
      m.resolving = false;
      m.retryAt = Date.now() + 5000;
    }
  }

  private async settle(m: Live, verdict: "YES" | "NO" | "VOID", voidReason: string | undefined, evA: string, evB: string) {
    const v = m.view;
    v.phase = "resolving";
    this.emit("market", v);
    const ws = v.windowStart * 1000;
    const aWindow = this.timeline.filter((r) => r.at >= ws - 8000 && r.at <= v.windowEnd * 1000 + 3000);
    const note = (r: Reading) => (m.spec.key === "__pov_alive" ? `alive: ${r.state.povAlive ?? "?"}` : `${m.spec.label}: ${r.state.counters?.find((c) => c.key === m.spec.key)?.value ?? "?"}`);
    const readings: [SourceReading, SourceReading] = [
      { source: this.readers.a.name, evaluation: evA === "PENDING" ? "MISSING" : (evA as "YES" | "NO"), plies: aWindow.length, status: aWindow[aWindow.length - 1]?.state.summary ?? "no frames", digest: keccak256(toBytes(aWindow.map((r) => r.sha).join(","))), excerpt: aWindow.slice(-10).map((r) => ({ san: note(r), at: r.at, material: 0 })) },
      { source: this.readers.b.name, evaluation: evB === "PENDING" ? "MISSING" : (evB as "YES" | "NO"), plies: m.b.length, status: m.frames[m.frames.length - 1]?.note ?? "no frames", digest: keccak256(toBytes(m.frames.map((f) => f.sha).join(","))), excerpt: m.frames.map((f) => ({ san: f.note, at: f.at, material: 0 })) },
    ];
    const bundle = {
      kind: "clutch.evidence.v1",
      adapter: "vision",
      market: { id: v.id, chainId: config.chainId, hook: config.deployment.clutchHook, poolId: this.poolId, stream: `${this.ref.platform}:${this.ref.channel}` },
      rule: m.rule,
      ruleHash: v.ruleHash,
      verdict,
      voidReason,
      independence: this.readers.independent,
      readerA: { name: this.readers.a.name, readings: aWindow.map((r) => ({ at: r.at, frame: r.sha, mode: r.state.mode, counters: r.state.counters, povAlive: r.state.povAlive })) },
      readerB: { name: this.readers.b.name, readings: m.b, frames: m.frames },
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
      rule: m.rule,
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
      frames: m.frames.map((f) => ({ at: f.at, url: `/frames/${f.sha}.jpg`, reader: f.reader, summary: f.note })),
    };
    await run(`UPDATE markets SET phase = ?, outcome = ?, void_reason = ?, tx_resolve = ?, resolved_at = ? WHERE id = ?`, [v.phase, r.outcome, v.voidReason ?? null, r.tx, receipt.resolvedAt, v.id]);
    await run(`INSERT OR REPLACE INTO receipts (market_id, slug, json, resolved_at) VALUES (?,?,?,?)`, [v.id, v.slug, JSON.stringify(receipt), receipt.resolvedAt]);
    log.market(`${this.row.slug} #${v.id} ${r.outcome}`, voidReason ?? "", stored.root);
    this.moment(r.outcome === "VOID" ? `Voided: ${v.question}` : `${r.outcome}: ${v.question}`, "market");
    this.live = this.live.filter((x) => x !== m);
    this.emit("market", v);
    this.emit("receipt", receipt);
    this.changed();
    void this.maybeOpen();
  }

  async voidStale(ids: number[]) {
    for (const id of ids) {
      try {
        await chain.resolveMarket(id, "VOID", ("0x" + "0".repeat(64)) as Hex);
        await run(`UPDATE markets SET phase = 'void', outcome = 'VOID', void_reason = ? WHERE id = ?`, ["The engine restarted while this market was open, so it was voided and refunded.", id]);
      } catch (e: any) {
        log.warn(`could not void #${id}`, e.shortMessage ?? e.message);
      }
    }
  }

  onTrade(marketId: number, amount: number, priceYesAfter: number, newTrader: boolean) {
    const m = this.live.find((x) => x.view.id === marketId);
    if (!m) return;
    m.view.priceYes = priceYesAfter;
    m.view.volume += amount;
    m.view.trades += 1;
    if (newTrader) m.view.traders += 1;
    this.emit("market", m.view);
    this.changed();
  }

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

  async reportLatency(_ms: number) {}
  latencyStats() {
    return { samples: 0, p50: null, p95: null };
  }

  private moment(text: string, kind: "game" | "market" | "integrity") {
    this.state.moments = [{ at: Date.now(), text, kind }, ...this.state.moments].slice(0, 40);
  }

  private changed() {
    this.emit("state");
  }
}

export async function staleVideoMarkets(slug: string) {
  return (await all<{ id: number }>(`SELECT id FROM markets WHERE slug = ? AND phase IN ('trading','locked','window','resolving')`, [slug])).map((r) => Number(r.id));
}
