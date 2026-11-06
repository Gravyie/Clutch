import { test } from "node:test";
import assert from "node:assert/strict";
import { Replay } from "./sources/replay";
import { resolveRule } from "./resolver";
import type { Rule } from "@clutch/shared";

test("recorded Lichess replay still reaches a deterministic two-source resolution", (t) => {
  const start = 1_800_000_000_000;
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: start });
  const replay = new Replay(undefined, 1000, 900);
  try {
    t.mock.timers.tick(100_000);
    const a = replay.a.facts();
    const b = replay.b.facts();
    assert.ok(a.plies.length > 16);
    assert.deepEqual(a.plies.map((p) => p.uci), b.plies.map((p) => p.uci));
    assert.equal(a.status, b.status);
    assert.notEqual(a.status, "started");
    const rule: Rule = { v: 1, adapter: "chess", template: "side_wins", params: { side: a.winner ?? "white" }, subject: { gameId: a.gameId, white: a.white.name, black: a.black.name }, question: "Recorded game's winner?", resolution: "Recorded result", sources: [replay.a.name, replay.b.name], lockTime: start / 1000 - 8, windowStart: start / 1000, windowEnd: start / 1000 + 120, agreement: "Both sources agree" };
    const result = resolveRule(rule, a, b, start + 200_000);
    assert.equal(result.state, "final");
    assert.notEqual(result.state === "final" && result.verdict, "VOID");
  } finally {
    replay.stop();
    t.mock.timers.reset();
  }
});
