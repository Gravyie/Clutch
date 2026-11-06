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
if (!/^[a-z0-9-]{1,40}$/.test(s.slug) || !['twitch', 'kick', 'youtube'].includes(s.platform) || typeof s.channel !== 'string' || !s.channel || typeof s.title !== 'string') throw new Error('Invalid stream metadata');
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
await run(`INSERT INTO streams (slug,kind,title,subtitle,platform,channel,category,pool_id,token,currency0,currency1,owner_address,owner_nullifier,latency_buffer,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`, [s.slug, 'video', s.title, s.platform, s.platform, s.channel, s.category ?? 'other', poolId, s.token, s.currency0, s.currency1, state[4], state[5].toString(), Number(state[3]), Date.now()]);
console.log(JSON.stringify({ imported: s.slug, poolId, chainId: 84532, transactionsSent: 0 }));
db.close();
