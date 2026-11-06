import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import type { CounterSpec } from "@clutch/shared";
import { MarketMemory, evaluateVideo, identity, openingEvidence, type EvidenceSample, type VideoScene } from "./video/policy";

const limits = { maxFrameAgeMs: 10_000, maxSampleGapMs: 8000, boundaryToleranceMs: 2500 };
const spec: CounterSpec = { kind: "goes_up", key: "__pov_alive", label: "Sigma", seconds: 20 };
const scene: VideoScene = { scene: "Overwatch", game: "Overwatch", mode: "gameplay", povAlive: true, povIdentity: "Sigma", roundId: "1", confidence: 0.9, counters: [{ key: "health", label: "Health", value: 500 }], summary: "Own POV", scoreA: null, scoreB: null, teamA: null, teamB: null, phase: null, aliveA: null, aliveB: null, remaining: null, clock: null, bomb: null };
const observation = (at: number, state = scene) => ({ at, sha: `frame-${at}`, state });
const samples = (value: number | null = 0): EvidenceSample[] => [0, 4000, 8000, 12000, 16000, 20000].map((at) => ({ at, values: { __pov_alive: value }, valid: true, sha: `b-${at}` }));

test("persistent 500 HP does not ban a later, freshly evidenced event window", () => {
  const memory = new MarketMemory(60_000);
  assert.equal(openingEvidence([observation(1000), observation(5000)], 6000, limits), undefined);
  assert.equal(memory.check("emongg", identity(scene), spec, 5000, 6000), undefined);
  memory.record("emongg", identity(scene), spec, 5000, 50_000);
  assert.equal(memory.check("emongg", identity(scene), spec, 5000, 120_000), "NO_FRESH_EVENT");
  assert.equal(memory.check("emongg", identity(scene), spec, 60_000, 60_000), "RECENT_TEMPLATE_COOLDOWN");
  const later = { ...scene, roundId: "2" };
  assert.equal(openingEvidence([observation(116_000, later), observation(120_000, later)], 121_000, limits), undefined);
  assert.equal(memory.check("emongg", identity(later), spec, 120_000, 121_000), undefined);
  assert.equal(memory.check("another-channel", identity(scene), spec, 6000, 6000), undefined);
});

test("old, frozen, low-confidence, menu and 50-second observations do not create fresh events", () => {
  assert.equal(openingEvidence([observation(1000), observation(5000)], 56_000, limits), "STALE_FRAME");
  assert.equal(openingEvidence([observation(1000), observation(51_000)], 51_001, limits), "NO_FRESH_EVENT");
  assert.equal(openingEvidence([observation(1000), { ...observation(5000), sha: "frame-1000" }], 6000, limits), "NO_FRESH_EVENT");
  assert.equal(openingEvidence([observation(1000), observation(5000, { ...scene, mode: "menu" })], 6000, limits), "NO_VERIFIABLE_MARKET");
  assert.equal(openingEvidence([observation(1000), observation(5000, { ...scene, povIdentity: "D.Va" })], 6000, limits), "NO_FRESH_EVENT");
});

test("survival requires a valid baseline, continuous valid samples and an in-window end", () => {
  assert.equal(evaluateVideo(spec, samples(), 0, 20000, true, limits), "YES");
  assert.equal(evaluateVideo(spec, samples(), 0, 20000, false, limits), "PENDING");
  const dead = samples(); dead[2].values.__pov_alive = 1;
  assert.equal(evaluateVideo(spec, dead, 0, 20000, false, limits), "NO");
  for (const bad of [samples(null), samples().slice(1), samples().slice(0, -1), [samples()[0], samples().at(-1)!]]) {
    assert.equal(evaluateVideo(spec, bad, 0, 20000, true, limits), "PENDING");
  }
  const replay = samples(); replay[2].valid = false;
  assert.equal(evaluateVideo(spec, replay, 0, 20000, true, limits), "PENDING");
  const late = samples(); late.at(-1)!.at = 20001; late.at(-1)!.values.__pov_alive = 1;
  assert.equal(evaluateVideo(spec, late, 0, 20000, true, limits), "PENDING");
});

test("missing starting HUD or race target cannot become a NO verdict", () => {
  const counter: CounterSpec = { kind: "reaches", key: "score", label: "Score", threshold: 110, seconds: 20 };
  const readings = samples().map((r) => ({ ...r, values: { score: 109, opponent: 100 } as Record<string, number | null> }));
  readings[0].values.score = null;
  assert.equal(evaluateVideo(counter, readings, 0, 20000, true, limits), "PENDING");
  readings[0].values.score = 109;
  readings[0].values.opponent = null;
  assert.equal(evaluateVideo({ ...counter, kind: "race", key2: "opponent" }, readings, 0, 20000, true, limits), "PENDING");
  assert.equal(evaluateVideo(counter, readings, 0, 20000, true, limits), "NO");
  readings[2].values.score = 110;
  assert.equal(evaluateVideo(counter, readings, 0, 20000, false, limits), "YES");
});


test("recorded emongg #1: unknown A readings and late/replay B frames both stay unverified", () => {
  const record = JSON.parse(readFileSync(new URL("../fixtures/emongg-recorded-evidence.json", import.meta.url), "utf8"));
  const ws = record.rule.windowStart * 1000;
  const we = record.rule.windowEnd * 1000;
  const a = record.readerA.readings.map((r: any) => ({ at: r.at, valid: r.mode === "gameplay", values: { __pov_alive: r.povAlive === true ? 0 : r.povAlive === false ? 1 : null } }));
  const b = record.readerB.readings.map((r: any, i: number) => ({ ...r, valid: !record.readerB.frames[i].note.includes("replay") }));
  assert.equal(evaluateVideo(spec, a, ws, we, true, limits), "PENDING");
  assert.equal(evaluateVideo(spec, b, ws, we, true, limits), "PENDING");
});
