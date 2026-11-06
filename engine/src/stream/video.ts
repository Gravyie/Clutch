import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  categoryFor,
  counterRule,
  defaultQuestion,
  ruleHash as hashRule,
  tradeable,
  type AiDecision,
  type Category,
  type CounterKind,
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
import { FrameSampler, probe, type ChannelRef, type Frame } from "../video/capture";
import type { VisionReader } from "../video/perceive";
import type { StreamRow } from "./runner";
import { MarketMemory, complete, evaluateVideo, fresh, identity, isOverwatch, openingEvidence, type EvidenceSample, type Observation, type VideoScene } from "../video/policy";

export interface VideoRuntime {
  now: () => number;
  chain: Pick<typeof chain, "chainNow" | "openMarket" | "resolveMarket">;
  captureB?: (at?: number) => Promise<Frame>;
}
const runtime: VideoRuntime = { now: Date.now, chain };
const limits = { maxFrameAgeMs: config.videoMaxFrameAgeMs, maxSampleGapMs: config.videoMaxSampleGapMs, boundaryToleranceMs: config.videoBoundaryToleranceMs };

const framesDir = join(config.dataDir, "frames");
mkdirSync(framesDir, { recursive: true });

interface Live {
  view: MarketView;
  rule: Rule;
  spec: CounterSpec;
  /** reader B's readings: window start, any confirming checks, window end */
  b: EvidenceSample[];
  context: string;
  nextBAt: number;
  bStarted: boolean;
  checking: boolean;
  resolving: boolean;
  retryAt?: number;
  frames: { at: number; sha: string; reader: string; note: string; requestId?: string }[];
}

/**
 * A live video channel (Twitch, Kick, YouTube).
 *
 * Reader A (0G vision) reads every sampled frame in one pass: mode, survival, and every counter on the HUD.
 * The 0G agent turns steady, contested counters into markets ("Clix eliminations go up in the next 45s?").
 * Reader B (a different model family) independently verifies the game, POV and counters on its own
 * connection: before opening, at window boundaries and throughout the interval. Both must reach
 * the same verdict or the market voids and everyone is refunded. Reruns never get markets.
 */
/** how long a counter rests after carrying a market (a market is open ~60-90s, so this is roughly "not back to back") */
/** a reader slot with nothing tradeable on screen for this long moves to another channel */
const UNPRODUCTIVE_SEC = Number(process.env.UNPRODUCTIVE_SEC ?? 75);

/** seconds between reader A reads while no market is live on the channel */
const IDLE_READ_SEC = Number(process.env.IDLE_READ_SEC ?? 6);

const REPEAT_COOLDOWN_SEC = Number(process.env.REPEAT_COOLDOWN_SEC ?? 75);

const SCREEN: Record<string, string> = { menu: "a menu", replay: "a replay", break: "a break screen", camera: "the camera, not the game", other: "something other than gameplay" };

export class VideoRunner extends EventEmitter {
  state: StreamState;
  readonly ref: ChannelRef;
  /** markets open on this channel (read-only outside the runner) */
  live: Live[] = [];
  private sampler?: FrameSampler;
  private timeline: Observation[] = [];
  private verifierSampler?: FrameSampler;
  private memory = new MarketMemory(config.videoTemplateCooldownMs);
  readonly diagnostics = { counts: {} as Record<string, number>, last: undefined as { code: string; at: number; detail?: string } | undefined, opened: 0, resolved: 0, voided: 0 };
  private perceiving = false;
  private stopped = false;
  private lastProposalAt = 0;
  private proposing = false;
  private refused = new Set<string>();
  private recentQuestions: string[] = [];
  private ticker?: NodeJS.Timeout;
  private prober?: NodeJS.Timeout;
  private category: Category = "other";
  chainBlocked = false;
  slotGranted = false;
  helixManaged = false;

  constructor(readonly row: StreamRow & { platform: string; channel: string; category: string | null }, private readonly zg: ZeroG, private readonly readers: { a: VisionReader; b: VisionReader; independent: string }, private readonly io: VideoRuntime = runtime) {
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
    if (this.ticker) return;
    this.stopped = false;
    this.ticker = setInterval(() => void this.tick(), 1000);
    this.prober = setInterval(() => void this.refreshInfo(), 60_000);
    void this.refreshInfo();
  }

  stop() {
    this.stopped = true;
    clearInterval(this.ticker);
    clearInterval(this.prober);
    this.sampler?.stop();
    this.verifierSampler?.stop();
    this.ticker = undefined;
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

  /** when the slot was granted, the last time the screen had something tradeable, and a rest after a dry spell */
  slotSince = 0;
  lastTradeableAt = 0;
  benchedUntil = 0;

  /** Holding a reader slot but nothing on screen has been tradeable for a while (menus, IRL, a HUD with no score). */
  get unproductive() {
    if (!this.slotGranted || this.live.length) return false;
    return Date.now() - Math.max(this.slotSince, this.lastTradeableAt) > UNPRODUCTIVE_SEC * 1000;
  }

  setSlot(granted: boolean) {
    if (granted === this.slotGranted) return;
    this.slotGranted = granted;
    if (granted) this.slotSince = Date.now();
    this.state.reading = granted;
    if (granted) {
      this.verifierSampler = new FrameSampler(this.ref, { intervalSec: config.videoCaptureIntervalMs / 1000, width: 1024, keep: 60 }).start();
      this.sampler = new FrameSampler(this.ref, { intervalSec: config.videoCaptureIntervalMs / 1000, width: 1024, keep: 60 }).start();
      this.sampler.on("frame", (f: Frame) => {
        this.state.frameAt = f.at;
        writeFileSync(join(framesDir, `${this.row.slug}.jpg`), f.jpeg);
        void this.perceive(f);
      });
    } else {
      this.sampler?.stop();
      this.sampler = undefined;
      this.verifierSampler?.stop();
      this.verifierSampler = undefined;
    }
    this.changed();
  }

  // ─── Reader A ────────────────────────────────────────────────────────────────────────────────

  private lastReadAt = 0;
  private pausedUntil = 0;

  private async perceive(f: Frame) {
    if (this.perceiving || this.stopped) return; // the next frame is fresher anyway
    // Budget: read every frame only while a market is live; between markets one read every IDLE_READ_SEC is enough
    // to catch the next moment, and costs a third as much.
    const now = this.io.now();
    if (now < this.pausedUntil) return;
    if (!this.live.length && now - this.lastReadAt < IDLE_READ_SEC * 1000) return;
    this.lastReadAt = now;
    this.perceiving = true;
    try {
      const r = await this.readers.a.discover(f.jpeg, this.state.game);
      if (this.stopped) return;
      if (this.live.length || this.proposing) writeFileSync(join(framesDir, `${f.sha}.jpg`), f.jpeg);
      this.timeline.push({ at: f.at, sha: f.sha, state: r.state, requestId: r.requestId });
      log.info(JSON.stringify({ event: "video_observation", slug: this.row.slug, at: f.at, sha: f.sha, source: `${this.ref.platform}:streamlink`, reader: this.readers.a.name, requestId: r.requestId, frameAgeMs: this.io.now() - f.at, inferenceMs: r.ms, mode: r.state.mode, counters: r.state.counters?.map((c) => c.key) }));
      if (this.timeline.length > 300) this.timeline.splice(0, 60);
      this.state.vision = { state: r.state, at: f.at, reader: this.readers.a.name, ms: r.ms };
      if (r.state.mode === "gameplay" && this.steadyCounters().length) this.lastTradeableAt = Date.now();
      this.changed();
      // A decisive change for a live market: ask B to confirm right away.
      for (const m of this.live) if (m.view.phase === "window" && !m.resolving && this.evalA(m, false) !== "PENDING") void this.confirm(m);
      void this.maybeOpen();
    } catch (e: any) {
      this.decline("ORACLE_UNAVAILABLE", "Reader A inference failed");
      if (/budget spent|switched off/.test(e.message)) {
        // The daily cap is a hard stop: rest a minute instead of retrying every frame.
        if (!this.pausedUntil || now - this.pausedUntil > 5 * 60_000) log.warn(`${this.row.slug}: ${e.message}`);
        this.pausedUntil = Date.now() + 60_000;
      } else log.warn(`${this.row.slug} reader A`, e.message);
    } finally {
      this.perceiving = false;
    }
  }

  /** Counters read with the same value in at least two of the last two timely readings: safe to build a market on. */
  private steadyCounters() {
    const recent = this.timeline.slice(-2).filter((r) => r.state.mode === "gameplay");
    if (recent.length < 2) return [];
    const latest = recent[recent.length - 1].state.counters ?? [];
    return latest.filter((c) => recent.slice(0, -1).some((r) => r.state.counters?.some((x) => x.key === c.key && Math.abs(x.value - c.value) <= Math.max(1, c.value * 0.2))) && tradeable(c.key, c.label));
  }

  // ─── Opening ─────────────────────────────────────────────────────────────────────────────────

  private async maybeOpen() {
    if (this.stopped || this.proposing || this.state.paused || this.chainBlocked || !this.poolId || this.state.rerun) return;
    if (this.live.length) return;
    if (this.io.now() - this.lastProposalAt < 6000) return;
    const latest = this.timeline[this.timeline.length - 1];
    const rejection = openingEvidence(this.timeline, this.io.now(), limits);
    if (rejection) { this.decline(rejection); return; }
    const counters = this.steadyCounters();
    const pov = false; // Preserve upstream policy: no streamer-controlled survival markets.
    if (!counters.length && !pov) { this.decline("MISSING_COUNTER"); return; }

    this.proposing = true;
    this.lastProposalAt = this.io.now();
    try {
      const pick = await this.choose(counters, latest.state, pov);
      if (!pick) return;
      if (!await this.verifyOpening(pick.spec, latest)) return;
      await this.open(pick.spec, pick.question, pick.p, pick.ai, latest);
    } catch (e: any) {
      this.decline("OPEN_FAILED", "Market submission or verification failed");
      log.warn(`${this.row.slug} open failed`, e.shortMessage ?? e.message);
    } finally {
      this.proposing = false;
    }
  }

  /** The 0G agent picks a counter, a kind, a threshold and a window, prices it, and phrases the question. */
  /**
   * A viewer asks for a market now, paying the agent's inference with their own 0G account. Skips the wait for a
   * "tense" moment, but every integrity rule still applies (live gameplay, both readers, no repeats, no reruns).
   */
  async callMarket(viewer: ZeroG): Promise<{ ok: true; marketId: number; question: string; costUsd: number; requestId?: string } | { ok: false; reason: string }> {
    if (this.stopped) return { ok: false, reason: "Channel reader is stopped." };
    if (!this.state.live) return { ok: false, reason: "This channel is offline." };
    if (this.state.rerun) return { ok: false, reason: "Reruns never get markets: the result already happened." };
    if (!this.slotGranted) return { ok: false, reason: "The AI isn't reading this channel right now. Try one marked AI watching." };
    if (this.state.paused || this.chainBlocked || !this.poolId) return { ok: false, reason: "Markets are paused or the pool is unavailable." };
    if (this.live.length) return { ok: false, reason: "A market is already active. Wait for it to finish." };
    if (this.proposing) return { ok: false, reason: "The AI is already creating a market." };
    const latest = this.timeline[this.timeline.length - 1];
    const rejection = openingEvidence(this.timeline, this.io.now(), limits);
    if (rejection) { this.decline(rejection); return { ok: false, reason: rejection }; }
    this.proposing = true;
    this.lastProposalAt = this.io.now();
    try {
      const counters = this.steadyCounters();
      const pov = false; // Preserve upstream anti-steering policy.
      this.lastDecline = "";
      const pick = await this.choose(counters, latest.state, pov, viewer);
      if (!pick) return { ok: false, reason: `No fair market right now: ${this.lastDecline || "nothing on screen is uncertain enough"}. Try again in a few seconds.` };
      if (!await this.verifyOpening(pick.spec, latest)) return { ok: false, reason: this.lastDecline };
      const id = await this.open(pick.spec, pick.question, pick.p, { ...pick.ai, paidBy: "viewer" }, latest);
      return { ok: true, marketId: id, question: pick.question, costUsd: pick.ai.costUsd ?? 0, requestId: pick.ai.requestId };
    } catch (e: any) {
      return { ok: false, reason: /401|403|auth/i.test(e.message) ? "0G rejected that key. Check it at pc.0g.ai." : /402|insufficient|balance/i.test(e.message) ? "Your 0G balance is too low for this call." : "The AI couldn't create a market just now." };
    } finally {
      this.proposing = false;
    }
  }

  /** Why the last choose() came back empty, for the viewer who asked and for the log. */
  private lastDecline = "";
  private decline(code: string, detail?: string) {
    this.lastDecline = detail ? `${code}: ${detail}` : code;
    this.diagnostics.counts[code] = (this.diagnostics.counts[code] ?? 0) + 1;
    this.diagnostics.last = { code, detail, at: this.io.now() };
    log.info(JSON.stringify({ event: "video_rejected", slug: this.row.slug, ...this.diagnostics.last, count: this.diagnostics.counts[code] }));
    return null;
  }

  private async choose(allCounters: { key: string; label: string; value: number }[], s: VideoScene, povAvailable: boolean, zg: ZeroG = this.zg) {
    const latest = this.timeline.at(-1)!;
    const eligibility = openingEvidence(this.timeline, this.io.now(), limits);
    if (eligibility) return this.decline(eligibility);
    const observedCategory = categoryFor(s.game ?? s.scene);
    if (observedCategory === "other" || observedCategory === "irl") return this.decline("NO_VERIFIABLE_MARKET");
    // Overwatch has one approved grammar: tracked POV survival, never arbitrary HUD/overlay scores.
    const counters = isOverwatch(s) ? [] : allCounters;
    const pov = false; // A fresh independently read POV still does not make survival non-steerable.
    if (!counters.length && !pov) return this.decline("NO_VERIFIABLE_MARKET", "No independently identifiable POV or readable game counter");
    const survival: CounterSpec = { kind: "goes_up", key: "__pov_alive", label: s.povIdentity ?? "Streamer alive", seconds: 45 };
    if (!counters.length) {
      const cooldown = this.memory.check(this.row.slug, identity(s), survival, latest.at, this.io.now());
      if (cooldown) return this.decline(cooldown);
    }
    const recent = this.live.map((m) => m.spec.key);
    if (zg.provider === "0g") {
      // Send only supported, observable counters; no values from overlays.
      const allowed = new Set(counters.map((c) => c.key));
      const history = this.timeline.slice(-8).map((r) => ({ t: Math.round((r.at - this.io.now()) / 1000), mode: r.state.mode, counters: Object.fromEntries((r.state.counters ?? []).filter((c) => allowed.has(c.key)).map((c) => [c.key, c.value])) }));
      try {
        const res = await zg.json<{ kind: CounterKind | "survives"; key: string; key2?: string; threshold?: number; seconds: number; pYes: number; question: string; contested: boolean; rationale: string }>(
          `You create live prediction markets for Clutch from what's on a stream's screen. Pick ONE market that is genuinely uncertain and exciting in the next 20-60 seconds.
Allowed kinds:
- goes_up: a counter increases (kills, eliminations, team score)
- reaches: a counter reaches a threshold
- drops_below: a counter falls below a threshold (players left, health, shield)
- race: counter key increases before counter key2 (e.g. which team scores first)
Rules: use only the exact counter keys in "counters" (copy them character for character); never use counters the streamer or the player on camera alone controls (their own survival, ammo, money spent) or clocks; it must be contested by opponents or chance (team scores, rounds, who scores first, players left in a lobby). seconds between 20 and 60. pYes is your calibrated probability (viewers trade against it), between 0.15 and 0.85. question: natural, punchy, at most 60 characters, ends with "?", must mean exactly the structured rule (name the team/player when known). Vary the market: avoid repeating recent ones: ${JSON.stringify([...recent, ...this.recentQuestions])}.
Respond with JSON only: {"kind","key","key2","threshold","seconds","pYes","question","contested","rationale"}`,
          JSON.stringify({ game: s.game ?? this.state.game, streamTitle: this.state.streamTitle, summary: s.summary, povAlive: pov, povIdentity: s.povIdentity, counters, history }),
        );
        const d = res.data;
        const ai: AiDecision = { provider: "0g", model: config.zgModel, requestId: res.requestId, latencyMs: res.latencyMs, costUsd: res.costUsd, rationale: d.rationale };
        const p = Math.round(Number(d.pYes) * 100) / 100;
        const seconds = Math.max(20, Math.min(60, Math.round(Number(d.seconds) || 45)));
        if (d.contested !== true) return this.refuse(d.question ?? "AI proposal", "steerable", "One person could decide it.");
        if (!(p >= 0.15 && p <= 0.85)) return this.refuse(d.question ?? "AI proposal", "not-uncertain", `Opening probability ${Math.round(p * 100)}% is outside 15-85%.`);
        let spec: CounterSpec;
        if (d.kind === "survives") {
          if (!pov) return this.decline("MISSING_COUNTER", "Survival requires a consistently identified live POV");
          spec = { kind: "goes_up", key: "__pov_alive", label: s.povIdentity ?? "Streamer alive", seconds };
        } else {
          // Models often respell keys ("darkzero_score" for "dark_zero_score"); match on letters and digits only.
          const norm = (k?: string) => (k ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
          const find = (k?: string) => counters.find((x) => x.key === k) ?? counters.find((x) => norm(x.key) === norm(k) || norm(x.label) === norm(k));
          const c = find(d.key);
          const c2 = d.key2 ? find(d.key2) : undefined;
          if (!c || (d.kind === "race" && (!c2 || c2.key === c.key))) return this.decline("MISSING_COUNTER", "Proposal requires an unobserved or identical race target");
          if (!["goes_up", "reaches", "drops_below", "race"].includes(d.kind)) return this.decline("NO_VERIFIABLE_MARKET", "Unsupported market kind");
          spec = { kind: d.kind, key: c.key, label: c.label, key2: c2?.key, label2: c2?.label, threshold: d.threshold !== undefined && d.threshold !== null ? Number(d.threshold) : undefined, seconds };
          // A threshold that's already met isn't a question.
          if (spec.kind === "reaches" && !(Number.isFinite(spec.threshold) && Number(spec.threshold) > c.value)) return this.decline("NO_FRESH_EVENT", "Threshold already reached or invalid");
          if (spec.kind === "drops_below" && !(Number.isFinite(spec.threshold) && Number(spec.threshold) < c.value)) return this.decline("NO_FRESH_EVENT", "Threshold already passed or invalid");
        }
        const question = spec.key === "__pov_alive" ? `${spec.label} survives the next ${seconds}s?` : defaultQuestion(spec);
        return { spec, question, p, ai };
      } catch (e: any) {
        // A viewer's call surfaces its own 0G error (bad key, no balance) instead of a vague "nothing fair".
        if (zg.payer === "viewer") throw e;
        log.warn(`${this.row.slug} 0G moment call`, e.message);
        return this.decline("ORACLE_UNAVAILABLE");
      }
    }
    // Without 0G: the first steady contested counter, at an even-ish base rate.
    const c = counters[0];
    if (!c && pov) {
      const spec: CounterSpec = { kind: "goes_up", key: "__pov_alive", label: s.povIdentity ?? "Streamer alive", seconds: 45 };
      return { spec, question: `${spec.label} survives the next 45s?`, p: 0.6, ai: { provider: "heuristic", model: "base rates", rationale: "Survival base rate." } as AiDecision };
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
    const r: Refusal = { at: this.io.now(), slug: this.row.slug, template: "counter", question, reason, detail };
    void run(`INSERT INTO refusals (slug, at, json) VALUES (?,?,?)`, [this.row.slug, r.at, JSON.stringify(r)]);
    this.emit("refusal", r);
    return null;
  }

  private async open(spec: CounterSpec, question: string, p: number, ai: AiDecision, source: Observation): Promise<number> {
    const s = source.state;
    if (this.stopped || this.live.length || this.state.paused || this.chainBlocked || this.state.rerun || !this.state.live) throw new Error("Market opening no longer eligible");
    if (!fresh(source.at, this.io.now(), limits.maxFrameAgeMs)) throw new Error("STALE_FRAME");
    const t0 = await this.io.chain.chainNow();
    if (!fresh(source.at, this.io.now(), limits.maxFrameAgeMs)) throw new Error("STALE_FRAME");
    const latest = this.timeline.at(-1)!;
    const rejection = openingEvidence(this.timeline, this.io.now(), limits);
    if (rejection || identity(latest.state) !== identity(s) || spec.key === "__pov_alive" && latest.state.povAlive !== true) throw new Error(rejection ?? "NO_FRESH_EVENT");
    const value = latest.state.counters?.find((c) => c.key === spec.key)?.value;
    if (spec.kind === "reaches" && (value === undefined || value >= spec.threshold!) || spec.kind === "drops_below" && (value === undefined || value <= spec.threshold!)) throw new Error("NO_FRESH_EVENT");
    const lockTime = t0 + config.videoTradingSec;
    const windowStart = lockTime + this.state.latencyBufferSec;
    const windowEnd = windowStart + spec.seconds;
    const rule: Rule = {
      v: 1,
      adapter: "vision",
      template: spec.key === "__pov_alive" ? "survives" : `counter:${spec.kind}`,
      params: { ...spec, evidenceLimits: limits, povIdentity: s.povIdentity ?? null, roundId: s.roundId ?? null },
      subject: { stream: `${this.ref.platform}:${this.ref.channel}`, scene: s.game ?? s.scene, teams: [s.teamA, s.teamB].filter(Boolean) as string[] },
      question,
      resolution: spec.key === "__pov_alive" ? `YES if the streamer's player is still alive at window end (${spec.seconds}s). NO if they are eliminated first.` : counterRule(spec),
      sources: [this.readers.a.name, this.readers.b.name],
      lockTime,
      windowStart,
      windowEnd,
      agreement: `Both readers on independent frames must agree. Require valid game/player evidence, a baseline at or up to ${limits.boundaryToleranceMs}ms before window start, sample gaps no longer than ${limits.maxSampleGapMs}ms, and an in-window end reading within ${limits.boundaryToleranceMs}ms of window end for a non-decisive result. Missing evidence or disagreement: VOID.`,
    };
    const ruleHash = hashRule(rule);
    const opened = await this.io.chain.openMarket({ poolId: this.poolId, ruleHash, lockTime, windowStart, windowEnd, bUsdc: config.liquidityB, pYes: p });
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
    this.live.push({ view, rule, spec, context: identity(s), nextBAt: windowStart * 1000, b: [], bStarted: false, checking: false, resolving: false, frames: [] });
    this.recentQuestions = [question, ...this.recentQuestions].slice(0, 5);
    this.memory.record(this.row.slug, identity(s), spec, source.at, windowEnd * 1000);
    this.diagnostics.opened++;
    this.diagnostics.last = undefined;
    log.info(JSON.stringify({ event: "video_opened", slug: this.row.slug, id: view.id, sourceAt: source.at, frameAgeMs: this.io.now() - source.at, openLatencyMs: this.io.now() - this.lastProposalAt, requestId: ai.requestId, tx: opened.tx, lockTime, windowStart, windowEnd }));
    log.market(`${this.row.slug} #${view.id}`, `"${question}"`, `p=${p}`, ai.provider, ai.requestId ?? "");
    this.moment(ai.paidBy === "viewer" ? `A viewer called a market: ${question}` : `New market: ${question}`, "market");
    this.emit("market", view);
    this.changed();
    return view.id;
  }

  // ─── Lifecycle ───────────────────────────────────────────────────────────────────────────────

  private async tick() {
    if (this.stopped) return;
    const now = this.io.now() / 1000;
    for (const m of [...this.live]) {
      const v = m.view;
      const phase = now < v.lockTime ? "trading" : now < v.windowStart ? "locked" : m.resolving ? "resolving" : "window";
      if (phase !== v.phase) {
        v.phase = phase;
        log.info(JSON.stringify({ event: "video_phase", slug: this.row.slug, id: v.id, phase, at: this.io.now() }));
        void run(`UPDATE markets SET phase = ? WHERE id = ?`, [phase, v.id]);
        this.emit("market", v);
        this.changed();
      }
      if (now >= v.windowStart && !m.bStarted && !m.checking) void this.readB(m, "start");
      else if (now >= v.windowStart && now < v.windowEnd && this.io.now() >= m.nextBAt && !m.checking && !m.resolving) void this.readB(m, "confirm");
      if (now >= v.windowEnd + limits.maxFrameAgeMs / 1000 + 1 && !m.resolving && (m.retryAt ?? 0) <= this.io.now()) void this.finish(m);
      if (now > v.windowEnd + 120 && !m.resolving) void this.finish(m, "The stream stopped giving readable frames.");
    }
  }

  private povReading(alive: boolean | null) {
    return { __pov_alive: alive === true ? 0 : alive === false ? 1 : null };
  }

  private sample(spec: CounterSpec, r: Observation, context: string): EvidenceSample {
    const values = spec.key === "__pov_alive" ? this.povReading(r.state.povAlive) : Object.fromEntries((r.state.counters ?? []).map((c) => [c.key, c.value]));
    return { at: r.at, sha: r.sha, requestId: r.requestId, values, valid: r.state.mode === "gameplay" && r.state.confidence >= 0.4 && identity(r.state) === context && complete(spec, values) };
  }

  private evalA(m: Live, ended: boolean) {
    return evaluateVideo(m.spec, this.timeline.map((r) => this.sample(m.spec, r, m.context)), m.view.windowStart * 1000, m.view.windowEnd * 1000, ended, limits);
  }

  private evalB(m: Live, ended: boolean) {
    return evaluateVideo(m.spec, m.b, m.view.windowStart * 1000, m.view.windowEnd * 1000, ended, limits);
  }

  private async captureB(at = this.io.now()) {
    if (this.io.captureB) return this.io.captureB(at);
    const frame = this.verifierSampler?.ring.filter((f) => f.at <= at).at(-1);
    if (!frame || !fresh(frame.at, at, limits.boundaryToleranceMs)) throw new Error("FEED_UNAVAILABLE: no timely independent frame");
    return frame;
  }

  private async verifyOpening(spec: CounterSpec, source: Observation) {
    const reason = this.memory.check(this.row.slug, identity(source.state), spec, source.at, this.io.now());
    if (reason) { this.decline(reason); return false; }
    try {
      const f = await this.captureB();
      // Full independent discovery also verifies game/player identity, not just a model-supplied label.
      const r = await this.readers.b.discover(f.jpeg, this.state.game);
      const sample = this.sample(spec, { ...f, state: r.state, requestId: r.requestId }, identity(source.state));
      const a = this.sample(spec, source, identity(source.state));
      if (!sample.valid || !a.valid || spec.key === "__pov_alive" && sample.values.__pov_alive !== 0) {
        this.decline("READER_B_UNVERIFIABLE", "Missing counter, wrong game/player, non-gameplay or low confidence");
        return false;
      }
      if (!fresh(f.at, this.io.now(), limits.maxFrameAgeMs) || !fresh(source.at, this.io.now(), limits.maxFrameAgeMs) || r.ms > limits.maxSampleGapMs) {
        this.decline("STALE_FRAME", "Independent verification exceeded the observation budget");
        return false;
      }
      log.info(JSON.stringify({ event: "video_verified", slug: this.row.slug, frameAt: f.at, frameAgeMs: this.io.now() - f.at, reader: this.readers.b.name, requestId: r.requestId }));
      return true;
    } catch {
      this.decline("READER_B_UNVERIFIABLE", "Independent feed or reader unavailable");
      return false;
    }
  }

  /** Separate continuous connection; select the boundary frame BEFORE inference, preserving capture time. */
  private async readB(m: Live, why: "start" | "confirm" | "end") {
    if (m.checking) return;
    m.checking = true;
    m.nextBAt = this.io.now() + config.videoSampleIntervalMs;
    try {
      const target = why === "start" ? m.view.windowStart * 1000 : why === "end" ? m.view.windowEnd * 1000 : this.io.now();
      const f = await this.captureB(target);
      writeFileSync(join(framesDir, `${f.sha}.jpg`), f.jpeg);
      const r = await this.readers.b.discover(f.jpeg, this.state.game);
      const sample = this.sample(m.spec, { ...f, state: r.state, requestId: r.requestId }, m.context);
      // Slow inference can still describe its captured frame, but cannot fill a missing interval.
      if (!m.b.some((b) => b.at === sample.at)) m.b.push(sample);
      m.frames.push({ at: f.at, sha: f.sha, reader: this.readers.b.name, requestId: r.requestId, note: `${why} · ${JSON.stringify(sample.values)} · ${r.state.mode} · valid:${sample.valid}` });
      log.info(JSON.stringify({ event: "video_verification", slug: this.row.slug, id: m.view.id, why, frameAt: f.at, frameAgeMs: this.io.now() - f.at, valid: sample.valid, requestId: r.requestId }));
    } catch (e: any) {
      log.warn(`${this.row.slug} reader B`, e.message);
      m.b.push({ at: this.io.now(), values: {}, valid: false });
    } finally {
      if (why === "start") m.bStarted = true;
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
    if (m.resolving || m.checking) return;
    m.resolving = true;
    try {
      const ended = this.io.now() / 1000 >= m.view.windowEnd;
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
      m.retryAt = this.io.now() + 5000;
    }
  }

  private async settle(m: Live, verdict: "YES" | "NO" | "VOID", voidReason: string | undefined, evA: string, evB: string) {
    const v = m.view;
    v.phase = "resolving";
    this.emit("market", v);
    const ws = v.windowStart * 1000;
    const aWindow = this.timeline.filter((r) => r.at >= ws - 8000 && r.at <= v.windowEnd * 1000 + 3000);
    const note = (r: Observation) => (m.spec.key === "__pov_alive" ? `alive: ${r.state.povAlive ?? "?"}` : `${m.spec.label}: ${r.state.counters?.find((c) => c.key === m.spec.key)?.value ?? "?"}`);
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
      evidenceLimits: limits,
      context: m.context,
      verdict,
      voidReason,
      independence: this.readers.independent,
      readerA: { name: this.readers.a.name, readings: aWindow.map((r) => ({ at: r.at, frame: r.sha, requestId: r.requestId, confidence: r.state.confidence, sample: this.sample(m.spec, r, m.context), mode: r.state.mode, counters: r.state.counters, povAlive: r.state.povAlive, povIdentity: r.state.povIdentity, roundId: r.state.roundId })) },
      readerB: { name: this.readers.b.name, readings: m.b, frames: m.frames },
      agent: { address: chain.agent.address, decision: v.ai },
      createdAt: this.io.now(),
    };
    const stored = await storeEvidence(bundle);
    const r = await this.io.chain.resolveMarket(v.id, verdict, stored.root);
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
      resolvedAt: this.io.now(),
      tx: r.tx,
      ai: v.ai,
      frames: m.frames.map((f) => ({ at: f.at, url: `/frames/${f.sha}.jpg`, reader: f.reader, summary: f.note })),
    };
    await run(`UPDATE markets SET phase = ?, outcome = ?, void_reason = ?, tx_resolve = ?, resolved_at = ? WHERE id = ?`, [v.phase, r.outcome, v.voidReason ?? null, r.tx, receipt.resolvedAt, v.id]);
    await run(`INSERT OR REPLACE INTO receipts (market_id, slug, json, resolved_at) VALUES (?,?,?,?)`, [v.id, v.slug, JSON.stringify(receipt), receipt.resolvedAt]);
    log.market(`${this.row.slug} #${v.id} ${r.outcome}`, voidReason ?? "", stored.root);
    this.moment(r.outcome === "VOID" ? `Voided: ${v.question}` : `${r.outcome}: ${v.question}`, "market");
    this.live = this.live.filter((x) => x !== m);
    if (r.outcome === "VOID") this.diagnostics.voided++; else this.diagnostics.resolved++;
    log.info(JSON.stringify({ event: "video_completed", slug: this.row.slug, id: v.id, verdict: r.outcome, tx: r.tx, requestId: v.ai.requestId, cycles: this.diagnostics }));
    this.emit("market", v);
    this.emit("receipt", receipt);
    this.changed();
    void this.maybeOpen();
  }

  async voidStale(ids: number[]) {
    for (const id of ids) {
      try {
        await this.io.chain.resolveMarket(id, "VOID", ("0x" + "0".repeat(64)) as Hex);
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
    this.state.moments = [{ at: this.io.now(), text, kind }, ...this.state.moments].slice(0, 40);
  }

  private changed() {
    this.emit("state");
  }
}

export async function staleVideoMarkets(slug: string) {
  return (await all<{ id: number }>(`SELECT id FROM markets WHERE slug = ? AND phase IN ('trading','locked','window','resolving')`, [slug])).map((r) => Number(r.id));
}
