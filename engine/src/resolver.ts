import { keccak256, toBytes } from "viem";
import { canonicalJson, templateById, type ChessFacts, type Rule, type SourceReading, type Evaluation } from "@clutch/shared";

/** How long after the window ends we wait for a lagging source before voiding. */
export const GRACE_MS = 45_000;

export type Resolution =
  | { state: "pending" }
  | { state: "final"; verdict: "YES" | "NO" | "VOID"; voidReason?: string; readings: [SourceReading, SourceReading] };

/**
 * Evaluates a committed rule against two independent sources.
 *
 * Source A's first-observed time per ply is the timeline (it is the agent's own observation log, kept in the
 * evidence); source B must independently report the same moves, status and result over the window. The rule is
 * evaluated on each source separately. Same verdict on both → that verdict. Anything else → VOID, refund at cost.
 */
export function resolveRule(rule: Rule, a: ChessFacts | undefined, b: ChessFacts | undefined, now = Date.now()): Resolution {
  const t = templateById(rule.template);
  const w = { start: rule.windowStart * 1000, end: rule.windowEnd * 1000 };
  const pastGrace = now > w.end + GRACE_MS;
  if (!t) return final("VOID", "Unknown template.", reading(rule.sources[0], a, "MISSING", w), reading(rule.sources[1], b, "MISSING", w));
  if (!a || !b) {
    if (!pastGrace) return { state: "pending" };
    return final("VOID", "A source produced no data for this game.", reading(rule.sources[0], a, "MISSING", w), reading(rule.sources[1], b, "MISSING", w));
  }

  const bAligned = align(a, b);
  const evA = t.evaluate(rule.params as any, a, w, now);
  const evB = t.evaluate(rule.params as any, bAligned, w, now);
  const rA = reading(rule.sources[0], a, evA, w);
  const rB = reading(rule.sources[1], bAligned, evB, w);

  if (evA === "PENDING" || evB === "PENDING") {
    if (!pastGrace) return { state: "pending" };
    return final("VOID", `${evA === "PENDING" ? "Source A" : "Source B"} had not reported the window by the deadline.`, rA, rB);
  }

  // The facts themselves must agree over the window, not just the verdicts.
  // Compare squares + resulting material: push streams omit the promotion letter that exports include, and the
  // material balance already pins down which piece was promoted to.
  const relevant = (f: ChessFacts) => f.plies.filter((p) => p.at <= w.end || t.windowSeconds >= 600).map((p) => `${p.uci.slice(0, 4)}:${p.material}`);
  const ra = relevant(a);
  const rb = relevant(bAligned);
  const n = Math.min(ra.length, rb.length);
  for (let i = 0; i < n; i++) {
    if (ra[i] !== rb[i]) return final("VOID", `Sources disagree at ply ${i + 1} (${a.plies[i]?.san} vs ${b.plies[i]?.san}).`, rA, rB);
  }
  if (evA !== evB) return final("VOID", `Sources reached different verdicts (${evA} vs ${evB}).`, rA, rB);
  return final(evA, undefined, rA, rB);
}

/** Copies A's observation times onto B's plies where the moves match, so both are judged on one timeline. */
function align(a: ChessFacts, b: ChessFacts): ChessFacts {
  return {
    ...b,
    endedAt: b.status !== "started" ? (a.endedAt ?? b.endedAt) : undefined,
    plies: b.plies.map((p, i) => (a.plies[i]?.uci.slice(0, 4) === p.uci.slice(0, 4) ? { ...p, at: a.plies[i].at } : p)),
  };
}

function reading(source: string, f: ChessFacts | undefined, ev: Evaluation | "MISSING", w: { start: number; end: number }): SourceReading {
  const win = (f?.plies ?? []).filter((p) => p.at >= w.start - 10_000 && p.at <= w.end + 5_000);
  return {
    source,
    evaluation: ev,
    plies: f?.plies.length ?? 0,
    status: f?.status ?? "missing",
    winner: f?.winner,
    digest: keccak256(toBytes(canonicalJson({ plies: (f?.plies ?? []).map((p) => p.uci), status: f?.status, winner: f?.winner }))),
    excerpt: win.map((p) => ({ san: p.san, at: p.at, material: p.material })),
  };
}

function final(verdict: "YES" | "NO" | "VOID", voidReason: string | undefined, a: SourceReading, b: SourceReading): Resolution {
  return { state: "final", verdict, voidReason, readings: [a, b] };
}
