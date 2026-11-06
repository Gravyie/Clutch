/** Import metadata for an ALREADY registered pool; never deploy or send a transaction. Run with engine stopped. */
import { readFileSync } from 'node:fs';
import { encodeAbiParameters, keccak256, isAddress } from 'viem';
import { ClutchHookAbi } from '@clutch/shared';
import { config } from '../config';
import { publicClient } from '../chain';
import { checkProductionDeployment } from '../production';
import { migrate, run, db } from '../db';
await checkProductionDeployment();
const s = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const kind = s.kind === 'lichess-tv' ? 'lichess-tv' : 'video';
if (!/^[a-z0-9-]{1,40}$/.test(s.slug) || (kind === 'video' && !['twitch', 'kick', 'youtube'].includes(s.platform)) || typeof s.channel !== 'string' || !s.channel || typeof s.title !== 'string') throw new Error('Invalid stream metadata');
for (const field of ['currency0', 'currency1', 'token']) if (!isAddress(s[field])) throw new Error(`Invalid ${field}`);
const key = { currency0: s.currency0, currency1: s.currency1, fee: 0, tickSpacing: 60, hooks: config.deployment.clutchHook };
const poolId = keccak256(encodeAbiParameters([{ type: 'tuple', components: [{ name: 'currency0', type: 'address' }, { name: 'currency1', type: 'address' }, { name: 'fee', type: 'uint24' }, { name: 'tickSpacing', type: 'int24' }, { name: 'hooks', type: 'address' }] }], [key]));
if (poolId.toLowerCase() !== String(s.poolId).toLowerCase()) throw new Error('Pool key does not match poolId');
const usdc = config.deployment.usdc.toLowerCase();
if (![s.currency0.toLowerCase(), s.currency1.toLowerCase()].includes(usdc) || ![s.currency0.toLowerCase(), s.currency1.toLowerCase()].includes(s.token.toLowerCase()) || s.token.toLowerCase() === usdc) throw new Error('Expected deployed USDC/stream token pair');
const state = await publicClient.readContract({ address: config.deployment.clutchHook, abi: ClutchHookAbi, functionName: 'streams', args: [poolId] });
if (!state[0]) throw new Error('Pool is not registered on the existing ClutchHook');
if (state[6] !== 0n) {
  const market = await publicClient.readContract({ address: config.deployment.clutchHook, abi: ClutchHookAbi, functionName: 'market', args: [state[6]] });
  if (Number(market.status) === 1) throw new Error('Pool has an active market; reconcile it before importing');
}
await migrate();
const existing = await db.execute({ sql: 'SELECT pool_id FROM streams WHERE slug = ?', args: [s.slug] });
if (existing.rows[0]?.pool_id && String(existing.rows[0].pool_id).toLowerCase() !== poolId.toLowerCase()) throw new Error('Refusing to replace a different existing stream pool');
await run(`INSERT INTO streams (slug,kind,title,subtitle,platform,channel,lichess_channel,category,pool_id,token,currency0,currency1,owner_address,owner_nullifier,latency_buffer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
ON CONFLICT(slug) DO UPDATE SET kind=excluded.kind,title=excluded.title,subtitle=excluded.subtitle,platform=excluded.platform,channel=excluded.channel,lichess_channel=excluded.lichess_channel,category=excluded.category,pool_id=excluded.pool_id,token=excluded.token,currency0=excluded.currency0,currency1=excluded.currency1,owner_address=excluded.owner_address,owner_nullifier=excluded.owner_nullifier,latency_buffer=excluded.latency_buffer`, [s.slug, kind, s.title, kind === 'lichess-tv' ? 'Lichess TV' : s.platform, kind === 'video' ? s.platform : null, kind === 'video' ? s.channel : null, kind === 'lichess-tv' ? s.channel : null, s.category ?? (kind === 'lichess-tv' ? 'chess' : 'other'), poolId, s.token, s.currency0, s.currency1, state[4], state[5].toString(), Number(state[3]), Date.now()]);
console.log(JSON.stringify({ imported: s.slug, poolId, chainId: 84532, transactionsSent: 0 }));
db.close();
