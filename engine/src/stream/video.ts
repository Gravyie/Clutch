import { EventEmitter } from "node:events";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  categoryFor,
  readable,
  ruleHash as hashRule,
  validate,
  visionTemplateById,
  VISION_TEMPLATES,
  type AiDecision,
  type Category,
  type MarketView,
  type Reading,
  type Receipt,
  type Refusal,
  type Rule,
  type SceneState,
  type SourceReading,
  type StreamState,
  type StreamSummary,
  type VisionTemplate,
} from "@clutch/shared";
import { keccak256, toBytes, type Hex } from "viem";
import { config } from "../config";
import { log } from "../log";
import * as chain from "../chain";
import { all, one, run } from "../db";
import type { ZeroG } from "../ai/zeroG";
import { storeEvidence } from "../evidence";
import { FrameSampler, grabFrame, probe, type ChannelRef, type Frame } from "../video/capture";
import type { VisionReader } from "../video/perceive";
import type { StreamRow } from "./runner";

const framesDir = join(config.dataDir, "frames");
mkdirSync(framesDir, { recursive: true });

interface Active {
  view: MarketView;
  rule: Rule;
  template: VisionTemplate<any>;
  params: Record<string, unknown>;
  startA?: SceneState;
  startB?: Reading;
  b: Reading[];
  resolving: boolean;
  checking: boolean;
  retryAt?: number;
}

/** Base rates used when 0G isn't configured. Shown as "base rates" on every market they price. */
function prior(t: VisionTemplate<any>, s: SceneState, p: any): number {
  switch (t.id) {
    case "score_change":
      return s.phase === "buy" ? 0.2 : (s.clock ?? 90) < 55 ? 0.7 : 0.45;
    case "team_scores_next": {
      const diff = (p.team === "A" ? (s.scoreA ?? 0) - (s.scoreB ?? 0) : (s.scoreB ?? 0) - (s.scoreA ?? 0)) * 0.03;
      return Math.min(0.8, Math.max(0.2, 0.47 + diff));
    }
    case "round_ends":
      return (s.clock ?? 90) <= 40 ? 0.88 : 0.4;
    case "clutch":
      return p.side === "A" ? [0, 0.62, 0.3, 0.17, 0.09, 0.05][s.aliveB ?? 2] ?? 0.1 : [0, 0.62, 0.3, 0.17, 0.09, 0.05][s.aliveA ?? 2] ?? 0.1;
    case "bomb_plant":
      return 0.56;
    case "field_shrinks":
      return 0.5;
    case "pov_survives":
      return 0.55;
    default:
      return 0.5;
  }
}

const PRIORITY = ["clutch", "bomb_plant", "round_ends", "team_scores_next", "score_change", "field_shrinks", "pov_survives"];

/**
 * A live video channel (Twitch, Kick, YouTube). Reader A perceives sampled frames continuously; Reader B checks
 * at window start and end over its own connection. Markets open only on live gameplay that both readers can see,
 * never on reruns, and void whenever the readers disagree.
 */
export class VideoRunner extends EventEmitter {
  state: StreamState;
  active?: Active;
  readonly ref: ChannelRef;
  private sampler?: FrameSampler;
  private timeline: Reading[] = [];
  private perceiving = false;
  private lastProposalAt = 0;
  private lastSettledAt = 0;
  private proposing = false;
  private refused = new Set<string>();
  private ticker?: NodeJS.Timeout;
  private prober?: NodeJS.Timeout;
  private category: Category = "other";
  chainBlocked = false;
  /** Set by the hub: whether this channel may hold one of the limited vision slots. */
  slotGranted = false;

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

  /** Whether this channel wants a vision slot (live, not a rerun). */
  get wantsVision() {
    return this.state.live && !this.state.rerun;
  }

  // ─── Liveness ────────────────────────────────────────────────────────────────────────────────

  private async refreshInfo() {
    const info = await probe(this.ref);
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

  /** Called by the hub when this channel gains or loses one of the limited vision slots. */
  setSlot(granted: boolean) {
    if (granted === this.slotGranted) return;
    this.slotGranted = granted;
    if (granted) {
      this.sampler = new FrameSampler(this.ref).start();
      this.sampler.on("frame", (f: Frame) => {
        this.state.frameAt = f.at;
        writeFileSync(join(framesDir, `${this.row.slug}.jpg`), f.jpeg);
        void this.perceive(f);
      });
    } else {
      this.sampler?.stop();
      this.sampler = undefined;
    }
  }

  // ─── Perception (Reader A) ───────────────────────────────────────────────────────────────────

  private async perceive(f: Frame) {
    if (this.perceiving) return; // drop frames while the model is busy; the next one is fresher anyway
    this.perceiving = true;
    try {
      const r = await this.readers.a.read(f.jpeg, this.category, this.state.game);
      const reading: Reading = { at: f.at, frame: f.sha, state: r.state, reader: this.readers.a.name };
      this.timeline.push(reading);
      if (this.timeline.length > 400) this.timeline.splice(0, 100);
      this.state.vision = { state: r.state, at: f.at, reader: this.readers.a.name, ms: r.ms };
      this.changed();
      if (this.active && this.active.view.phase === "window") void this.maybeEarly();
      else void this.maybeOpen();
    } catch (e: any) {
      log.warn(`${this.row.slug} perception`, e.message);
    } finally {
      this.perceiving = false;
    }
  }

  // ─── Opening ─────────────────────────────────────────────────────────────────────────────────

  private async maybeOpen() {
    const latest = this.timeline[this.timeline.length - 1];
    if (!latest || this.active || this.proposing || this.state.paused || this.chainBlocked || !this.poolId) return;
    if (this.state.rerun) return this.refuseOnce("rerun", "Markets on this stream", "not-resolvable", "This is a rerun: the result already happened, so trading it would be insider trading.");
    const now = Date.now();
    if (now - this.lastSettledAt < config.cooldownSec * 1000 || now - this.lastProposalAt < 15_000) return;
    if (latest.state.mode !== "gameplay" || latest.state.confidence < 0.6) return;
    if (this.zg.mode === "paused") return;

    const s = latest.state;
    const candidates: { t: VisionTemplate<any>; params: any; question: string; p: number }[] = [];
    for (const t of VISION_TEMPLATES) {
      if (!t.categories.includes(this.category)) continue;
      if (!t.eligible(s)) continue;
      const params = t.params(s);
      const question = t.question(params, s);
      const p = prior(t, s, params);
      const refusal = validate({ template: t as any, pYes: p, sources: ["vision:a", "vision:b"], vetoedCategories: this.state.vetoed, fieldsOk: readable(t, s) });
      if (refusal && refusal.reason !== "not-uncertain") {
        this.refuseOnce(t.id, question, refusal.reason, refusal.detail);
        continue;
      }
      if (!refusal) candidates.push({ t, params, question, p });
    }
    if (!candidates.length) return;
    this.proposing = true;
    this.lastProposalAt = now;
    try {
      const pick = await this.choose(candidates, s);
      if (!pick) return;

      // Reader B must independently see the same fields before we commit money to it.
      const fb = await grabFrame(this.ref);
      const rb = await this.readers.b.read(fb.jpeg, this.category, this.state.game);
      if (!readable(pick.t, rb.state) || !pick.t.eligible(rb.state)) {
        log.info(`${this.row.slug}: reader B can't confirm "${pick.question}" (${rb.state.summary})`);
        return;
      }

      const t0 = await chain.chainNow();
      const lockTime = t0 + config.tradingSec;
      const windowStart = lockTime + this.state.latencyBufferSec;
      const windowEnd = windowStart + pick.t.windowSeconds;
      const rule: Rule = {
        v: 1,
        adapter: "vision",
        template: pick.t.id,
        params: pick.params,
        subject: { stream: `${this.ref.platform}:${this.ref.channel}`, scene: s.scene, teams: [s.teamA, s.teamB].filter(Boolean) as string[] },
        question: pick.question,
        resolution: pick.t.rule(pick.params),
        sources: [this.readers.a.name, this.readers.b.name],
        lockTime,
        windowStart,
        windowEnd,
        agreement: "Both readers must reach the same verdict from their own frames. Otherwise VOID.",
      };
      const ruleHash = hashRule(rule);
      const opened = await chain.openMarket({ poolId: this.poolId, ruleHash, lockTime, windowStart, windowEnd, bUsdc: config.liquidityB, pYes: pick.p });
      const view: MarketView = {
        id: opened.id,
        slug: this.row.slug,
        streamTitle: this.state.title,
        question: pick.question,
        template: pick.t.id,
        rule,
        ruleHash,
        phase: "trading",
        openedAt: t0,
        lockTime,
        windowStart,
        windowEnd,
        pYes0: pick.p,
        priceYes: pick.p,
        b: config.liquidityB,
        subsidy: opened.subsidy,
        volume: 0,
        trades: 0,
        traders: 0,
        ai: pick.ai,
        tx: { open: opened.tx },
      };
      await run(
        `INSERT OR REPLACE INTO markets (id, slug, question, template, rule, rule_hash, ai, p_yes0, price_yes, b, subsidy, opened_at, lock_time, window_start, window_end, phase, tx_open, game_id)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [view.id, view.slug, view.question, view.template, JSON.stringify(rule), ruleHash, JSON.stringify(pick.ai), view.pYes0, view.priceYes, view.b, view.subsidy, t0, lockTime, windowStart, windowEnd, "trading", opened.tx, `${this.ref.platform}:${this.ref.channel}`],
      );
      this.active = { view, rule, template: pick.t, params: pick.params, b: [], resolving: false, checking: false };
      log.market(`${this.row.slug} #${view.id}`, `"${pick.question}"`, `p=${pick.p}`, pick.ai.provider);
      this.moment(`New market: ${pick.question}`, "market");
      this.emit("market", view);
      this.changed();
    } catch (e: any) {
      log.warn(`${this.row.slug} open failed`, e.shortMessage ?? e.message);
    } finally {
      this.proposing = false;
    }
  }

  /** 0G picks and prices when configured; otherwise the highest-priority template at its base rate. */
  private async choose(cands: { t: VisionTemplate<any>; params: any; question: string; p: number }[], s: SceneState) {
    if (this.zg.provider === "0g") {
      try {
        const recent = this.timeline.slice(-8).map((r) => ({ t: Math.round((r.at - Date.now()) / 1000), ...r.state }));
        const res = await this.zg.json<{ template: string; pYes: number; rationale: string }>(
          `You are the moment engine for Clutch, live prediction markets on streams. Pick the single candidate whose outcome is most genuinely uncertain and exciting right now and give a calibrated probability it resolves YES. Viewers trade against your number. Respond with JSON {"template","pYes","rationale"}.`,
          JSON.stringify({ game: this.state.game, recentStates: recent, candidates: cands.map((c) => ({ id: c.t.id, question: c.question, rule: c.t.rule(c.params), baseRate: c.p })) }),
        );
        const c = cands.find((x) => x.t.id === res.data.template);
        const p = Math.round(Number(res.data.pYes) * 100) / 100;
        if (c && p >= 0.15 && p <= 0.85) {
          const ai: AiDecision = { provider: "0g", model: config.zgModel, requestId: res.requestId, latencyMs: res.latencyMs, costUsd: res.costUsd, rationale: res.data.rationale };
          return { ...c, p, ai };
        }
      } catch (e: any) {
        log.warn("0G moment call failed", e.message);
        return null;
      }
    }
    const c = [...cands].sort((a, b) => PRIORITY.indexOf(a.t.id) - PRIORITY.indexOf(b.t.id))[0];
    const ai: AiDecision = { provider: "heuristic", model: `vision:${this.readers.a.name} + base rates`, rationale: `Read from the stream: ${s.summary || s.scene}. Priced from base rates for this situation.` };
    return { ...c, p: Math.round(c.p * 100) / 100, ai };
  }

  private refuseOnce(key: string, question: string, reason: Refusal["reason"], detail: string) {
    if (this.refused.has(key)) return;
    this.refused.add(key);
    const r: Refusal = { at: Date.now(), slug: this.row.slug, template: key, question, reason, detail };
    void run(`INSERT INTO refusals (slug, at, json) VALUES (?,?,?)`, [this.row.slug, r.at, JSON.stringify(r)]);
    this.emit("refusal", r);
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
      void run(`UPDATE markets SET phase = ? WHERE id = ?`, [phase, v.id]);
      this.emit("market", v);
      this.changed();
    }
    // Reader B's first checkpoint, right at window start.
    if (now >= v.windowStart && !act.startB && !act.checking) void this.checkpointB(true);
    if (now >= v.windowEnd + 2 && !act.resolving && (act.retryAt ?? 0) <= Date.now()) void this.finish(true);
    if (now > v.windowEnd + 180 && !act.resolving) void this.finish(true, "The stream stopped giving readable frames.");
  }

  private async checkpointB(isStart: boolean) {
    const act = this.active;
    if (!act || act.checking) return;
    act.checking = true;
    try {
      const f = await grabFrame(this.ref);
      const r = await this.readers.b.read(f.jpeg, this.category, this.state.game);
      const reading: Reading = { at: f.at, frame: f.sha, state: r.state, reader: this.readers.b.name };
      writeFileSync(join(framesDir, `${f.sha}.jpg`), f.jpeg);
      if (isStart) act.startB = reading;
      else act.b.push(reading);
    } catch (e: any) {
      log.warn(`${this.row.slug} reader B`, e.message);
    } finally {
      act.checking = false;
    }
  }

  /** Reader A thinks it's decided before the window ends: ask B for a confirming checkpoint. */
  private async maybeEarly() {
    const act = this.active;
    if (!act || act.resolving || act.checking || !act.startB) return;
    const evA = this.evaluateA(act, false);
    if (evA === "PENDING") return;
    await this.checkpointB(false);
    const evB = act.template.evaluate(act.params, act.startB.state, act.b, false);
    if (evB === evA) void this.finish(false);
  }

  private evaluateA(act: Active, ended: boolean) {
    const ws = act.view.windowStart * 1000;
    const start = [...this.timeline].reverse().find((r) => r.at <= ws)?.state;
    act.startA = start;
    const during = this.timeline.filter((r) => r.at > ws && r.at <= act.view.windowEnd * 1000 + 3000);
    return act.template.evaluate(act.params, start, during, ended);
  }

  private async finish(ended: boolean, forcedVoid?: string) {
    const act = this.active;
    if (!act || act.resolving) return;
    act.resolving = true;
    try {
      if (ended && !forcedVoid) await this.checkpointB(false);
      const evA = this.evaluateA(act, ended || Date.now() / 1000 >= act.view.windowEnd);
      const evB = act.startB ? act.template.evaluate(act.params, act.startB.state, act.b, ended || Date.now() / 1000 >= act.view.windowEnd) : "PENDING";
      let verdict: "YES" | "NO" | "VOID" = evA === evB && evA !== "PENDING" ? evA : "VOID";
      let reason = forcedVoid;
      if (!reason && verdict === "VOID") reason = evA === "PENDING" || evB === "PENDING" ? "A reader couldn't see the result on screen." : `The readers disagreed (${evA} vs ${evB}).`;
      if (forcedVoid) verdict = "VOID";
      await this.settle(act, verdict, reason, evA, evB);
    } catch (e: any) {
      log.warn(`${this.row.slug} settle deferred`, e.shortMessage ?? e.message);
      act.resolving = false;
      act.retryAt = Date.now() + 5000;
    }
  }

  private async settle(act: Active, verdict: "YES" | "NO" | "VOID", voidReason: string | undefined, evA: string, evB: string) {
    const v = act.view;
    v.phase = "resolving";
    this.emit("market", v);
    const ws = v.windowStart * 1000;
    const aWindow = this.timeline.filter((r) => r.at >= ws - 15_000 && r.at <= v.windowEnd * 1000 + 3000);
    const reading = (name: string, ev: string, rs: Reading[]): SourceReading => ({
      source: name,
      evaluation: (ev === "PENDING" ? "MISSING" : ev) as SourceReading["evaluation"],
      plies: rs.length,
      status: rs[rs.length - 1]?.state.summary ?? "no frames",
      digest: keccak256(toBytes(rs.map((r) => r.frame).join(","))),
      excerpt: rs.slice(-12).map((r) => ({ san: score(r.state), at: r.at, material: 0 })),
    });
    const bAll = [act.startB, ...act.b].filter(Boolean) as Reading[];
    const readings: [SourceReading, SourceReading] = [reading(this.readers.a.name, evA, aWindow), reading(this.readers.b.name, evB, bAll)];
    const bundle = {
      kind: "clutch.evidence.v1",
      adapter: "vision",
      market: { id: v.id, chainId: config.chainId, hook: config.deployment.clutchHook, poolId: this.poolId, stream: `${this.ref.platform}:${this.ref.channel}` },
      rule: act.rule,
      ruleHash: v.ruleHash,
      verdict,
      voidReason,
      independence: this.readers.independent,
      readerA: { name: this.readers.a.name, readings: aWindow },
      readerB: { name: this.readers.b.name, readings: bAll },
      frames: bAll.map((r) => ({ sha256: r.frame, url: `/frames/${r.frame}.jpg` })),
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
      frames: bAll.map((x) => ({ at: x.at, url: `/frames/${x.frame}.jpg`, reader: x.reader, summary: x.state.summary })),
    };
    await run(`UPDATE markets SET phase = ?, outcome = ?, void_reason = ?, tx_resolve = ?, resolved_at = ? WHERE id = ?`, [v.phase, r.outcome, v.voidReason ?? null, r.tx, receipt.resolvedAt, v.id]);
    await run(`INSERT OR REPLACE INTO receipts (market_id, slug, json, resolved_at) VALUES (?,?,?,?)`, [v.id, v.slug, JSON.stringify(receipt), receipt.resolvedAt]);
    log.market(`${this.row.slug} #${v.id} ${r.outcome}`, voidReason ?? "", stored.root);
    this.moment(r.outcome === "VOID" ? "Voided: everyone refunded" : `Settled ${r.outcome}`, "market");
    this.emit("market", v);
    this.emit("receipt", receipt);
    this.active = undefined;
    this.lastSettledAt = Date.now();
    this.changed();
  }

  /** Markets left open by a restart can't be re-observed from video: void them so everyone is refunded. */
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
    const v = this.active?.view;
    if (!v || v.id !== marketId) return;
    v.priceYes = priceYesAfter;
    v.volume += amount;
    v.trades += 1;
    if (newTrader) v.traders += 1;
    this.emit("market", v);
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

function score(s: SceneState) {
  if (s.scoreA !== null && s.scoreB !== null) return `${s.teamA ?? "A"} ${s.scoreA}-${s.scoreB} ${s.teamB ?? "B"}`;
  if (s.remaining !== null) return `${s.remaining} left`;
  return s.mode;
}

export async function staleVideoMarkets(slug: string) {
  return (await all<{ id: number }>(`SELECT id FROM markets WHERE slug = ? AND phase IN ('trading','locked','window','resolving')`, [slug])).map((r) => Number(r.id));
}
export { one };
