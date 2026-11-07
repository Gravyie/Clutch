import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeWorldRpId } from "./world-config";

test("World RP IDs use the same canonical identifier for request creation and server verification", () => {
  const hex = "309f1eb9e956b112";
  assert.equal(normalizeWorldRpId(`0x${hex}`), `rp_${hex}`);
  assert.equal(normalizeWorldRpId(`rp_${hex}`), `rp_${hex}`);
  assert.equal(normalizeWorldRpId("  rp_309f1eb9e956b112  "), "rp_309f1eb9e956b112");
  assert.equal(normalizeWorldRpId(""), undefined);
  assert.equal(normalizeWorldRpId(undefined), undefined);
  assert.throws(() => normalizeWorldRpId("not-an-rp-id"), /WORLD_RP_ID/);
  assert.throws(() => normalizeWorldRpId("0xb0d68c6394da6947a09bc358e36e9e61297bee8a94014a759b74166eb20dd364"), /64-bit/);
});
