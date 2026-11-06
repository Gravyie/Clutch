import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'clutch-pool-slot-'));
process.env.DATABASE_URL = `file:${join(process.env.DATA_DIR, 'test.db')}`;
const { Hub } = await import('./stream/hub');
const { VideoRunner } = await import('./stream/video');
const { ZeroG } = await import('./ai/zeroG');
const { config } = await import('./config');
const { db } = await import('./db');
after(() => db.close());
function runner(pool: string | null, viewers: number) {
  const r = Object.create(VideoRunner.prototype);
  Object.assign(r, { row: { pool_id: pool }, state: { watching: 0, category: 'fps', platformViewers: viewers }, benchedUntil: 0 });
  Object.defineProperties(r, { active: { value: undefined }, wantsVision: { value: true }, unproductive: { value: false } });
  r.setSlot = (granted: boolean) => { r.granted = granted; };
  return r;
}
test('owner-free production reserves vision for provisioned pools; local owner can still provision', () => {
  const owner = config.ownerKey, limit = config.maxVideoStreams, enabled = ZeroG.enabled;
  try {
    config.maxVideoStreams = 1; ZeroG.enabled = true;
    const ready = runner('0x01', 10), missing = runner(null, 10000);
    let provisions = 0;
    const hub = { runners: new Map([['ready', ready], ['missing', missing]]), ensurePool: () => { provisions++; } };
    config.ownerKey = undefined as any;
    Hub.prototype['allocateSlots'].call(hub as any);
    assert.equal(ready.granted, true); assert.equal(missing.granted, false); assert.equal(provisions, 0);
    config.ownerKey = owner;
    Hub.prototype['allocateSlots'].call(hub as any);
    assert.equal(missing.granted, true); assert.equal(provisions, 1);
  } finally { config.ownerKey = owner; config.maxVideoStreams = limit; ZeroG.enabled = enabled; }
});
