import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkProductionDeployment } from './production';
import { config } from './config';

const owner = '0x1111111111111111111111111111111111111111';
const agent = '0x2222222222222222222222222222222222222222';
const pass = '0x3333333333333333333333333333333333333333';
function fixture(changes: Record<string, unknown> = {}) {
  const d = { ...config.deployment, chainId: 84532 };
  const values: Record<string, unknown> = { engine: agent, resolver: agent, owner, signer: pass, usdc: d.usdc, gate: d.humanPassGate, vault: d.lpVault, ...changes };
  let reads = 0;
  const client = {
    getChainId: async () => 84532,
    getCode: async () => '0x6000',
    readContract: async ({ functionName }: { functionName: string }) => { reads++; return values[functionName]; },
  };
  return { args: { client: client as unknown as NonNullable<Parameters<typeof checkProductionDeployment>[0]>['client'], deployment: d, chainId: 84532, agentAddress: agent as `0x${string}`, passAddress: pass as `0x${string}` }, reads: () => reads };
}
test('production preflight accepts separated roles and consistent deployed components using read-only methods', async () => {
  const f = fixture();
  assert.equal((await checkProductionDeployment(f.args)).chainId, 84532);
  assert.equal(f.reads(), 7);
});
test('production preflight rejects a wrong RPC chain or missing contract code', async () => {
  const f = fixture();
  f.args.client = { ...f.args.client, getChainId: async () => 31337 } as typeof f.args.client;
  await assert.rejects(checkProductionDeployment(f.args), /RPC chain/);
  const b = fixture();
  b.args.client = { ...b.args.client, getCode: async () => '0x' } as typeof b.args.client;
  await assert.rejects(checkProductionDeployment(b.args), /Missing deployed contract/);
});
test('production preflight rejects owner reuse, wrong runtime signers and mismatched component addresses', async () => {
  for (const changes of [{ owner: agent }, { signer: owner }, { engine: owner }, { gate: owner }]) {
    await assert.rejects(checkProductionDeployment(fixture(changes).args));
  }
});


test('production configuration permits no owner key and rejects owner keys or a wrong chain', () => {
  const env = {
    PATH: process.env.PATH,
    NODE_ENV: 'production', CHAIN_ID: '84532', RPC_URL: 'https://example.invalid',
    AUTH_SECRET: 'a'.repeat(64), WORLD_APP_ID: 'fixture', WORLD_RP_ID: 'rp_309f1eb9e956b112', WORLD_RP_SIGNING_KEY: 'fixture',
    AGENT_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    PASS_SIGNER_PRIVATE_KEY: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
  };
  const script = `await import(${JSON.stringify(new URL('./config.ts', import.meta.url).href)});`;
  const args = ['--import', 'tsx', '--input-type=module', '-e', script];
  assert.equal(spawnSync(process.execPath, args, { env }).status, 0);
  assert.notEqual(spawnSync(process.execPath, args, { env: { ...env, OWNER_PRIVATE_KEY: env.AGENT_PRIVATE_KEY } }).status, 0);
  assert.notEqual(spawnSync(process.execPath, args, { env: { ...env, CHAIN_ID: '31337' } }).status, 0);
  assert.notEqual(spawnSync(process.execPath, args, { env: { ...env, AUTH_SECRET: 'REPLACE_WITH_RANDOM_64_HEX_CHARACTERS' } }).status, 0);
});


test('production preflight rejects the reported shared owner/agent/pass-signer configuration', async () => {
  const shared = '0x3750134287b3Fa078817ee2bAce1a69b372F3F8C' as const;
  const f = fixture({ engine: shared, resolver: shared, owner: shared, signer: shared });
  f.args.agentAddress = shared;
  f.args.passAddress = shared;
  await assert.rejects(checkProductionDeployment(f.args), /Separate the owner/);
});
