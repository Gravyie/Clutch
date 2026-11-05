import { test } from "node:test";
import assert from "node:assert/strict";
import { Chess } from "chess.js";
import { materialFromFen, type ChessFacts, type Rule } from "@clutch/shared";
import { resolveRule, GRACE_MS } from "./resolver";

const T0 = 1_800_000_000_000;

function facts(sans: string[], times: number[], opts: Partial<ChessFacts> = {}): ChessFacts {
  const c = new Chess();
  const plies = sans.map((san, i) => {
    const m = c.move(san);
    return { uci: m.from + m.to, san: m.san, at: times[i], fenAfter: c.fen(), material: materialFromFen(c.fen()) };
  });
  return { gameId: "g", plies, status: "started", white: { name: "W" }, black: { name: "B" }, ...opts };
}

const rule = (template: string, params: Record<string, unknown>, startMs: number, endMs: number): Rule => ({
  v: 1,
  adapter: "chess",
  template,
  params,
  subject: { gameId: "g", white: "W", black: "B" },
  question: "q",
  resolution: "r",
  sources: ["lichess:tv-stream", "lichess:rest-export"],
  lockTime: startMs / 1000 - 8,
  windowStart: startMs / 1000,
  windowEnd: endMs / 1000,
  agreement: "Both sources must report the same moves and status over the window, and yield the same verdict. Otherwise VOID.",
});

// 1.e4 d5 2.exd5 Qxd5: material swings by 1 then back; then 3.Nc3 Qa5 ... a quiet sequence.
const SANS = ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qa5", "d4", "Nf6"];
const TIMES = SANS.map((_, i) => T0 + i * 3000);

test("both sources agree → their verdict", () => {
  const r = rule("material_swing", { plies: 4, threshold: 3 }, T0 + 12_000 - 1, T0 + 60_000);
  const a = facts(SANS, TIMES);
  const b = facts(SANS, TIMES.map((t) => t + 1500));
  const res = resolveRule(r, a, b, T0 + 120_000);
  assert.equal(res.state, "final");
  assert.equal(res.state === "final" && res.verdict, "NO");
});

test("sources disagree on a move → VOID", () => {
  const r = rule("material_swing", { plies: 4, threshold: 3 }, T0 + 12_000 - 1, T0 + 60_000);
  const a = facts(SANS, TIMES);
  const bad = facts([...SANS.slice(0, 6), "d3", "Nf6"], TIMES);
  const res = resolveRule(r, a, bad, T0 + 120_000);
  assert.equal(res.state === "final" && res.verdict, "VOID");
  assert.match(res.state === "final" ? res.voidReason ?? "" : "", /disagree/);
});

test("a source that never reports → pending, then VOID after grace", () => {
  const r = rule("side_wins", { side: "white" }, T0, T0 + 60_000);
  const a = facts(SANS, TIMES, { status: "mate", winner: "white", endedAt: T0 + 30_000 });
  const b = facts(SANS, TIMES);
  assert.equal(resolveRule(r, a, b, T0 + 70_000).state, "pending");
  const late = resolveRule(r, a, b, T0 + 60_000 + GRACE_MS + 1);
  assert.equal(late.state === "final" && late.verdict, "VOID");
});

test("both report the same result → YES", () => {
  const r = rule("side_wins", { side: "white" }, T0, T0 + 60_000);
  const a = facts(SANS, TIMES, { status: "resign", winner: "white", endedAt: T0 + 30_000 });
  const b = facts(SANS, TIMES, { status: "resign", winner: "white", endedAt: T0 + 31_000 });
  const res = resolveRule(r, a, b, T0 + 40_000);
  assert.equal(res.state === "final" && res.verdict, "YES");
});

test("a promotion reported with and without the promotion letter is the same move", () => {
  const r = rule("material_swing", { plies: 4, threshold: 3 }, T0 + 12_000 - 1, T0 + 60_000);
  const a = facts(SANS, TIMES);
  const b = facts(SANS, TIMES);
  a.plies[6] = { ...a.plies[6], uci: a.plies[6].uci.slice(0, 4) };
  b.plies[6] = { ...b.plies[6], uci: b.plies[6].uci.slice(0, 4) + "q" };
  const res = resolveRule(r, a, b, T0 + 120_000);
  assert.notEqual(res.state === "final" && res.verdict, "VOID");
});
