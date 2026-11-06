/** Public-address preflight. Does not load wallet keys, config.ts, World secrets or a signing client. */
import { readFileSync } from 'node:fs';
import { createPublicClient, http, isAddress } from 'viem';
import { ClutchHookAbi, HumanPassGateAbi } from '@clutch/shared';

try {
  const d = JSON.parse(readFileSync(new URL('../../contracts/deployments/84532.json', import.meta.url), 'utf8'));
  const { RPC_URL: rpc, CLUTCH_EXPECTED_HOOK: hook, CLUTCH_EXPECTED_AGENT: agent, CLUTCH_EXPECTED_PASS_SIGNER: signer } = process.env;
  if (!rpc?.startsWith('https://') || !hook || !agent || !signer || !isAddress(hook) || !isAddress(agent) || !isAddress(signer)) throw new Error('Missing approved public deployment configuration');
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (d.chainId !== 84532 || !eq(d.clutchHook, hook)) throw new Error('Canonical manifest mismatch');
  const client = createPublicClient({ transport: http(rpc, { retryCount: 1, timeout: 15_000 }) });
  if (await client.getChainId() !== 84532) throw new Error('Wrong chain');
  const [owner, engine, resolver, gate] = await Promise.all([
    client.readContract({ address: hook, abi: ClutchHookAbi, functionName: 'owner' }),
    client.readContract({ address: hook, abi: ClutchHookAbi, functionName: 'engine' }),
    client.readContract({ address: hook, abi: ClutchHookAbi, functionName: 'resolver' }),
    client.readContract({ address: hook, abi: ClutchHookAbi, functionName: 'gate' }),
  ]);
  if (!eq(gate, d.humanPassGate)) throw new Error('Gate mismatch');
  const actualSigner = await client.readContract({ address: gate, abi: HumanPassGateAbi, functionName: 'signer' });
  if (!eq(engine, agent) || !eq(resolver, agent) || !eq(actualSigner, signer)) throw new Error('Roles have not been authorized');
  if (eq(agent, owner) || eq(signer, owner) || eq(agent, signer)) throw new Error('Owner must remain separate');
  console.log(JSON.stringify({ ok: true, chainId: 84532, hook, agent, passSigner: signer, transactionsSent: 0 }));
} catch {
  console.error('Public role check failed: confirm the canonical manifest and authorize separate runtime addresses on-chain before retrieving any private keys. No transaction was sent.');
  process.exitCode = 1;
}
