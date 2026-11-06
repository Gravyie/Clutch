import { after, test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import type { MarketView, Receipt } from "@clutch/shared";
import type { VideoScene } from "./video/policy";
import type { VisionReader } from "./video/perceive";
import type { StreamRow } from "./stream/runner";

// Isolated database; no keys, live frames, network inference or real transactions in unit tests.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "clutch-video-test-"));
process.env.DATABASE_URL = `file:${join(process.env.DATA_DIR, "test.db")}`;
const { VideoRunner } = await import("./stream/video");
const { migrate, db, one } = await import("./db");
const { ZeroG } = await import("./ai/zeroG");
const { gameCounters } = await import("./video/perceive");
await migrate();
after(() => db.close());

const hex = (n: number) => `0x${n.toString(16).padStart(64, "0")}` as `0x${string}`;
const initial: VideoScene = { scene: "League of Legends", game: "League of Legends", mode: "gameplay", povAlive: null, povIdentity: null, roundId: "1", confidence: 0.9, counters: [{ key: "team_score", label: "Blue team score", value: 0 }], summary: "Synthetic policy fixture; not a live vision result", scoreA: null, scoreB: null, teamA: null, teamB: null, phase: null, aliveA: null, aliveB: null, remaining: null, clock: null, bomb: null };
let nextId = 1000;

function harness() {
  let now = 1_800_000_000_000;
  let bState = initial;
  let submissions = 0;
  const zg = Object.create(ZeroG.prototype) as InstanceType<typeof ZeroG>;
  Object.defineProperty(zg, "provider", { value: "heuristic" });
  const reader: VisionReader = {
    name: "fixture:independent-reader-b",
    discover: async () => ({ state: bState, ms: 1, requestId: `fixture:b:${now}` }),
    read: async () => ({ state: bState, ms: 1 }),
    readKeys: async () => { throw new Error("Full context verification required"); },
  };
  const row = { slug: `fixture-${nextId}`, title: "Twitch observation fixture", subtitle: "NOT LIVE", kind: "video", platform: "twitch", channel: "emongg", category: "fps", pool_id: hex(1), owner_address: null, owner_nullifier: "0", latency_buffer: 10, vetoed: "[]" } as StreamRow & { platform: string; channel: string; category: string };
  const r = new VideoRunner(row, zg, { a: { ...reader, name: "fixture:reader-a" }, b: reader, independent: "Synthetic independent observations for regression only" }, {
    now: () => now,
    captureB: async (at = now) => ({ at, sha: `fixture-b-${at}`, jpeg: Buffer.alloc(0) }),
    chain: {
      chainNow: async () => Math.floor(now / 1000),
      openMarket: async () => { submissions++; return { id: nextId++, tx: hex(2), subsidy: 50 }; },
      resolveMarket: async (_id, outcome) => ({ tx: hex(3), outcome, blackout: false }),
    },
  });
  r.state.live = true;
  r.state.game = "League of Legends";
  r.slotGranted = true;
  const observe = (at: number, state = initial) => r["timeline"].push({ at, sha: `fixture-a-${at}`, state, requestId: `fixture:a:${at}` });
  observe(now - 4000); observe(now - 1000);
  return { r, zg, observe, now: () => now, time: (t: number) => { now = t; }, b: (s: VideoScene) => { bState = s; }, submissions: () => submissions };
}

test("Reader B must independently see POV/counter/context before any submission", async () => {
  for (const bad of [{ ...initial, counters: [] }, { ...initial, game: "Dota 2" }, { ...initial, mode: "replay" as const }, { ...initial, confidence: 0.1 }]) {
    const h = harness(); h.b(bad);
    assert.equal((await h.r.callMarket(h.zg)).ok, false);
    assert.equal(h.submissions(), 0);
    assert.equal(h.r.diagnostics.last?.code, "READER_B_UNVERIFIABLE");
  }
  const hud = harness();
  const moba = { ...initial, scene: "League of Legends", game: "League of Legends", povAlive: null, povIdentity: null };
  hud.r["timeline"].forEach((r) => { r.state = moba; });
  hud.b({ ...moba, counters: [] });
  assert.equal((await hud.r.callMarket(hud.zg)).ok, false);
  assert.equal(hud.submissions(), 0);
  const h = harness();
  h.r["timeline"].forEach((r) => { r.state = { ...initial, counters: [] }; });
  assert.equal((await h.r.callMarket(h.zg)).ok, false);
  assert.equal(h.submissions(), 0);
});

for (const expected of ["YES", "VOID"] as const) test(`Twitch runner opens → locks → ${expected}, persists evidence and emits existing schema`, async () => {
  const h = harness();
  const phases: string[] = [];
  let receipt: Receipt | undefined;
  h.r.on("market", (m: MarketView) => phases.push(m.phase));
  h.r.on("receipt", (r: Receipt) => { receipt = r; });
  const result = await h.r.callMarket(h.zg);
  assert.equal(result.ok, true);
  const m = h.r["live"][0];
  assert.ok(m.view.lockTime < m.view.windowStart);
  assert.equal((await h.r.callMarket(h.zg)).ok, false);
  assert.equal(h.submissions(), 1);
  h.time(m.view.lockTime * 1000);
  await h.r["tick"]();
  assert.equal(m.view.phase, "locked");
  const start = m.view.windowStart * 1000;
  const end = m.view.windowEnd * 1000;
  for (let t = start; t <= end; t += 5000) {
    h.time(t);
    const reading = t >= start + 10_000 ? { ...initial, counters: [{ key: "team_score", label: "Blue team score", value: 1 }] } : initial;
    h.observe(t, reading);
    h.b(expected === "VOID" && t >= start + 10_000 ? { ...initial, counters: [] } : reading);
    await h.r["tick"]();
    while (m.checking) await setImmediate();
  }
  h.time(end + 12_000);
  await h.r["tick"]();
  while (m.resolving && !receipt) await setImmediate();
  assert.ok(receipt);
  assert.equal(receipt.verdict, expected);
  assert.equal(h.r.active, undefined);
  assert.deepEqual(phases, ["trading", "locked", "window", "resolving", expected === "VOID" ? "void" : "settled"]);
  const saved = await one<{ outcome: string; phase: string }>("SELECT outcome, phase FROM markets WHERE id = ?", [m.view.id]);
  assert.equal(saved?.outcome, expected);
  const bundle = JSON.parse(readFileSync(join(process.env.DATA_DIR!, "evidence", `${receipt.evidenceRoot}.json`), "utf8"));
  assert.match(bundle.readerA.readings[0].requestId, /^fixture:a:/);
  assert.match(bundle.readerB.readings[0].requestId, /^fixture:b:/);
  assert.equal(bundle.verdict, expected);
  assert.equal(h.submissions(), 1);
  // The same counter family becomes eligible again on fresh post-window evidence.
  h.time(end + 61_000);
  h.observe(h.now() - 4000); h.observe(h.now() - 1000); h.b(initial);
  assert.equal((await h.r.callMarket(h.zg)).ok, true);
  assert.equal(h.submissions(), 2);
  h.r.stop();
});


test("discovery rejects overlay numbers and null/boolean/string OCR instead of coercing them to zero", () => {
  const input = [
    { key: "health", label: "Health", value: 500, origin: "game_hud" },
    { key: "happy_pcs_score", label: "HAPPY PCs", value: 109, origin: "overlay" },
    ...[null, false, "", "109"].map((value) => ({ key: "score", label: "Score", value, origin: "game_hud" })),
    { key: "unknown", label: "Unknown", value: 42, origin: "unknown" },
  ];
  assert.deepEqual(gameCounters(input), [{ key: "health", label: "Health", value: 500 }]);
});


test("late independent verification and stopped runners cannot submit", async () => {
  const h = harness();
  h.r["readers"].b.discover = async () => {
    h.time(h.now() + 50_000);
    return { state: initial, ms: 50_000 };
  };
  assert.equal((await h.r.callMarket(h.zg)).ok, false);
  assert.equal(h.r.diagnostics.last?.code, "STALE_FRAME");
  assert.equal(h.submissions(), 0);
  h.r.stop();
  assert.equal((await h.r.callMarket(h.zg)).ok, false);
  assert.equal(h.submissions(), 0);
});

 test("deployment integration preserves the upstream ban on streamer-controlled survival", async () => {
 const h = harness();
 h.r["timeline"].forEach(r => {r.state = {...initial, game:"Overwatch",scene:"Overwatch",povAlive:true,povIdentity:"Sigma",counters:[{key:"health",label:"Health",value:500}]};});
 assert.equal((await h.r.callMarket(h.zg)).ok,false);
 assert.equal(h.submissions(),0);
 h.r.stop();
 });
