import { privateKeyToAccount } from 'viem/accounts';
import { ClutchHookAbi, HumanPassGateAbi } from '@clutch/shared';
import { config } from './config';
import { publicClient, agent } from './chain';

/** Read-only: fail before any runner can submit a transaction on a misconfigured deployment. */
export async function checkProductionDeployment(input = {
  client: publicClient,
  deployment: config.deployment,
  chainId: config.chainId,
  agentAddress: agent.address,
  passAddress: privateKeyToAccount(config.passSignerKey).address,
}) {
  const { client, deployment: d, agentAddress, passAddress: pass } = input;
  if (input.chainId !== 84532 || d.chainId !== 84532) throw new Error('Expected Base Sepolia 84532');
  if (await client.getChainId() !== 84532) throw new Error('RPC chain ID does not match Base Sepolia');
  for (const field of ['poolManager', 'usdc', 'sequencerFeed', 'sequencerGuard', 'humanPassGate', 'lpVault', 'router', 'clutchHook', 'blackoutGuardHook'] as const) {
    const code = await client.getCode({ address: d[field] });
    if (!code || code === '0x') throw new Error(`Missing deployed contract: ${field}`);
  }
  const [engine, resolver, owner, signer, usdc, gate, vault] = await Promise.all([
    client.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: 'engine' }),
    client.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: 'resolver' }),
    client.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: 'owner' }),
    client.readContract({ address: d.humanPassGate, abi: HumanPassGateAbi, functionName: 'signer' }),
    client.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: 'usdc' }),
    client.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: 'gate' }),
    client.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: 'vault' }),
  ]);
  const eq = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  if (!eq(engine, agentAddress) || !eq(resolver, agentAddress)) throw new Error('Agent key must match both engine and resolver roles');
  if (!eq(signer, pass)) throw new Error('Pass key does not match deployed gate signer');
  if (eq(agentAddress, owner) || eq(pass, owner) || eq(agentAddress, pass)) throw new Error('Separate the owner, agent and pass-signer roles before production startup');
  if (!eq(usdc, d.usdc) || !eq(gate, d.humanPassGate) || !eq(vault, d.lpVault)) throw new Error('Deployment component addresses disagree with the hook');
  return { chainId: 84532, hook: d.clutchHook, agent: agentAddress, passSigner: pass };
}
