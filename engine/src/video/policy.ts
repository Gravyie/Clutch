import { evaluateCounter, type CounterReading, type CounterSpec, type SceneState } from "@clutch/shared";

/** Backend-only evidence fields. Missing identity is never inferred from a generic scene description. */
export interface VideoScene extends SceneState {
  povIdentity?: string | null;
  roundId?: string | null;
}
export interface Observation {
  at: number;
  sha: string;
  state: VideoScene;
  requestId?: string;
}
export interface EvidenceSample extends CounterReading {
  valid: boolean;
  sha?: string;
  requestId?: string;
}
export interface EvidenceLimits {
  maxFrameAgeMs: number;
  maxSampleGapMs: number;
  boundaryToleranceMs: number;
}
const normalized = (s?: string | null) => s?.trim().toLowerCase() ?? null;
export const identity = (s: VideoScene) => JSON.stringify([/overwatch/i.test(s.game ?? s.scene) ? "overwatch" : normalized(s.game ?? s.scene), normalized(s.povIdentity), normalized(s.roundId)]);
export const isOverwatch = (s: VideoScene) => /overwatch/i.test(s.game ?? s.scene);
export const keysOf = (s: CounterSpec) => [s.key, ...(s.key2 ? [s.key2] : [])];
export const complete = (s: CounterSpec, values: Record<string, number | null>) => keysOf(s).every((k) => typeof values[k] === "number" && Number.isFinite(values[k]));
export const fresh = (at: number, now: number, maxAge: number) => at <= now && now - at <= maxAge;

/** Two independent-in-time frames, not two completions for an old/frozen frame. */
export function openingEvidence(timeline: Observation[], now: number, limits: EvidenceLimits): string | undefined {
  const [a, b] = timeline.slice(-2);
  if (!b || !fresh(b.at, now, limits.maxFrameAgeMs)) return "STALE_FRAME";
  if (b.state.mode !== "gameplay" || b.state.confidence < 0.4) return "NO_VERIFIABLE_MARKET";
  if (!a || b.at <= a.at || a.sha === b.sha || b.at - a.at > limits.maxSampleGapMs || identity(a.state) !== identity(b.state) || a.state.mode !== "gameplay" || a.state.confidence < 0.4) return "NO_FRESH_EVENT";
}

/** Bounded family cooldown plus an exact semantic identity; no OCR values in the key. */
export class MarketMemory {
  private recent: { family: string; identity: string; sourceAt: number; until: number; end: number }[] = [];
  constructor(private readonly cooldownMs: number) {}
  family(channel: string, s: CounterSpec) {
    return JSON.stringify([channel, s.key === "__pov_alive" ? "survives" : s.kind, ...keysOf(s)]);
  }
  check(channel: string, context: string, s: CounterSpec, sourceAt: number, now: number) {
    const family = this.family(channel, s);
    const exact = JSON.stringify([family, context, sourceAt, s.threshold ?? null, s.seconds]);
    if (this.recent.some((r) => r.identity === exact || r.family === family && sourceAt <= r.sourceAt)) return "NO_FRESH_EVENT";
    if (this.recent.some((r) => r.family === family && now < r.until)) return "RECENT_TEMPLATE_COOLDOWN";
    if (this.recent.some((r) => r.family === family && sourceAt <= r.end)) return "NO_FRESH_EVENT";
  }
  record(channel: string, context: string, s: CounterSpec, sourceAt: number, end: number) {
    const family = this.family(channel, s);
    this.recent = [{ family, identity: JSON.stringify([family, context, sourceAt, s.threshold ?? null, s.seconds]), sourceAt, end, until: end + this.cooldownMs }, ...this.recent].slice(0, 64);
  }
}

/** Missing/late/occluded samples cannot become a negative verdict (or a survival YES). */
export function evaluateVideo(spec: CounterSpec, samples: EvidenceSample[], ws: number, we: number, ended: boolean, limits: EvidenceLimits): "YES" | "NO" | "PENDING" {
  const ordered = [...samples].sort((a, b) => a.at - b.at);
  // A baseline must precede the window; an event between the boundary and a late baseline cannot be lost.
  const start = ordered.filter((r) => r.at <= ws).at(-1);
  if (!start || ws - start.at > limits.boundaryToleranceMs || !start.valid || !complete(spec, start.values)) return "PENDING";
  const during = ordered.filter((r) => r.at > ws && r.at <= we);
  if (!during.length) return "PENDING";
  let previous = start;
  const accepted: EvidenceSample[] = [];
  for (const r of during) {
    if (!r.valid || !complete(spec, r.values) || r.at - previous.at > limits.maxSampleGapMs || r.at <= previous.at || r.sha && r.sha === previous.sha) return "PENDING";
    accepted.push(r);
    previous = r;
    if (spec.key === "__pov_alive") {
      if (start.values.__pov_alive !== 0) return "PENDING";
      if (r.values.__pov_alive === 1) return "NO";
    } else {
      const early = evaluateCounter(spec, start, accepted, false);
      if (early !== "PENDING") return early;
    }
  }
  if (!ended || we - previous.at > limits.boundaryToleranceMs) return "PENDING";
  return spec.key === "__pov_alive" ? "YES" : evaluateCounter(spec, start, accepted, true);
}
