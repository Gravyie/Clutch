import { createPublicClient, createWalletClient, decodeEventLog, defineChain, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia, unichainSepolia } from "viem/chains";
import {
  BlackoutGuardHookAbi,
  ClutchHookAbi,
  LPVaultAbi,
  MockSequencerFeedAbi,
  MockUSDCAbi,
  PoolManagerAbi,
  SequencerGuardAbi,
  StreamTokenAbi,
  StreamTokenBytecode,
  fromUsdc,
  toUsdc,
  type ChainState,
} from "@clutch/shared";
import { config, isLocalChain } from "./config";
import { all } from "./db";
import { log } from "./log";

const local = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
});
export const chain = config.chainId === baseSepolia.id ? baseSepolia : config.chainId === unichainSepolia.id ? unichainSepolia : local;

const d = config.deployment;
const transport = http(config.rpcUrl, { retryCount: 3, timeout: 20_000 });
export const publicClient = createPublicClient({ chain, transport, pollingInterval: isLocalChain ? 500 : 1500 });
export const agent = privateKeyToAccount(config.agentKey);
export const owner = privateKeyToAccount(config.ownerKey);
const agentWallet = createWalletClient({ chain, transport, account: agent });
const ownerWallet = createWalletClient({ chain, transport, account: owner });

const PHASES = ["Normal", "Down", "Recovering", "Unknown"] as const;
export const OUTCOME = { YES: 1, NO: 2, VOID: 3 } as const;
const SQRT_PRICE_1_1 = 79228162514264337593543950336n;

// Each key sends its txs one at a time so nonces never collide.
function queue() {
  let q: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = q.then(fn, fn);
    q = next.catch(() => undefined);
    return next;
  };
}
const asAgent = queue();
const asOwner = queue();

async function confirm(hash: Hex) {
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 90_000 });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return r;
}

export interface PoolKeyShape {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/**
 * Creates a stream's market pool: a marker token, a USDC/<stream> v4 pool on ClutchHook, and its registration
 * (streamer payout address, streamer's World ID nullifier, latency buffer). Owner-only on the hook.
 */
export async function createStreamPool(p: { name: string; symbol: string; streamer: `0x${string}`; streamerNullifier: bigint; latencyBuffer: number }) {
  return asOwner(async () => {
    const deployTx = await ownerWallet.deployContract({ abi: StreamTokenAbi, bytecode: StreamTokenBytecode, args: [p.name, p.symbol] });
    const token = (await confirm(deployTx)).contractAddress!;
    const [c0, c1] = token.toLowerCase() < d.usdc.toLowerCase() ? [token, d.usdc] : [d.usdc, token];
    const key: PoolKeyShape = { currency0: c0, currency1: c1, fee: 0, tickSpacing: 60, hooks: d.clutchHook };
    await confirm(await ownerWallet.writeContract({ address: d.poolManager, abi: PoolManagerAbi, functionName: "initialize", args: [key, SQRT_PRICE_1_1] }));
    const reg = await confirm(
      await ownerWallet.writeContract({
        address: d.clutchHook,
        abi: ClutchHookAbi,
        functionName: "registerStream",
        args: [key, p.streamer, p.streamerNullifier, p.latencyBuffer],
      }),
    );
    let poolId: Hex | undefined;
    for (const log of reg.logs) {
      try {
        const ev = decodeEventLog({ abi: ClutchHookAbi, ...log });
        if (ev.eventName === "StreamRegistered") poolId = ev.args.poolId as Hex;
      } catch {}
    }
    if (!poolId) throw new Error("StreamRegistered not found");
    return { token, poolId, key };
  });
}

export async function openMarket(p: { poolId: Hex; ruleHash: Hex; lockTime: number; windowStart: number; windowEnd: number; bUsdc: number; pYes: number }) {
  return asAgent(async () => {
    const tx = await agentWallet.writeContract({
      address: d.clutchHook,
      abi: ClutchHookAbi,
      functionName: "openMarket",
      args: [p.poolId, p.ruleHash, BigInt(p.lockTime), BigInt(p.windowStart), BigInt(p.windowEnd), fromUsdc(p.bUsdc), BigInt(Math.round(p.pYes * 1e6)) * 10n ** 12n],
    });
    const rcpt = await confirm(tx);
    for (const log of rcpt.logs) {
      try {
        const ev = decodeEventLog({ abi: ClutchHookAbi, ...log });
        if (ev.eventName === "MarketOpened") return { id: Number(ev.args.id), tx, subsidy: toUsdc(ev.args.subsidy) };
      } catch {}
    }
    throw new Error("MarketOpened not found");
  });
}

export async function resolveMarket(id: number, outcome: keyof typeof OUTCOME, evidenceRoot: Hex) {
  return asAgent(async () => {
    const tx = await agentWallet.writeContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "resolve", args: [BigInt(id), OUTCOME[outcome], evidenceRoot] });
    const rcpt = await confirm(tx);
    let blackout = false;
    let final: "YES" | "NO" | "VOID" = outcome;
    for (const log of rcpt.logs) {
      try {
        const ev = decodeEventLog({ abi: ClutchHookAbi, ...log });
        if (ev.eventName === "BlackoutVoid") blackout = true;
        if (ev.eventName === "MarketResolved") final = (["NONE", "YES", "NO", "VOID"] as const)[Number(ev.args.outcome)] as typeof final;
      } catch {}
    }
    void payOut(id, final); // winners don't press "collect": the engine pays them (claim is permissionless)
    return { tx, blackout, outcome: final };
  });
}

/**
 * Push winnings (or refunds, on VOID) into every trader's wallet right after settlement. `claim(id, trader)` can be
 * called by anyone and always pays the trader, so this only spends the agent's gas. A trader can still claim
 * themselves; anything already claimed is skipped.
 */
async function payOut(id: number, outcome: "YES" | "NO" | "VOID") {
  const traders = await all<{ trader: string }>(`SELECT DISTINCT trader FROM trades WHERE market_id = ?`, [id]);
  let paid = 0;
  for (const { trader } of traders) {
    try {
      const [yes, no, cost, claimed] = await publicClient.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "positions", args: [BigInt(id), trader as Hex] });
      const owed = outcome === "VOID" ? cost > 0n : outcome === "YES" ? yes > 0n : no > 0n;
      if (!owed || claimed) continue;
      await asAgent(async () => confirm(await agentWallet.writeContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "claim", args: [BigInt(id), trader as Hex] })));
      paid++;
    } catch (e: any) {
      log.warn(`payout #${id} → ${trader}`, e.shortMessage ?? e.message);
    }
  }
  if (paid) log.info(`#${id}: paid ${paid} trader${paid === 1 ? "" : "s"} automatically`);
}

export async function setLatencyBuffer(poolId: Hex, sec: number) {
  return asAgent(async () => {
    await confirm(await agentWallet.writeContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "setLatencyBuffer", args: [poolId, sec] }));
  });
}

/** House channels are owned by the protocol, so the owner key pauses them. Streamers pause their own from the studio. */
export async function setPausedAsOwner(poolId: Hex, paused: boolean) {
  return asOwner(async () => confirm(await ownerWallet.writeContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "setPaused", args: [poolId, paused] })));
}

export async function readStream(poolId: Hex) {
  const s = await publicClient.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "streams", args: [poolId] });
  return { registered: s[0], paused: s[1], latencyBuffer: Number(s[3]), streamer: s[4], liveMarket: Number(s[6]), volume: toUsdc(s[7]) };
}

export async function marketOnchain(id: number) {
  const m = await publicClient.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "market", args: [BigInt(id)] });
  return { status: Number(m.status), outcome: Number(m.outcome), lockTime: Number(m.lockTime), windowEnd: Number(m.windowEnd) };
}

export async function expireMarket(id: number) {
  return asAgent(async () => confirm(await agentWallet.writeContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "expire", args: [BigInt(id)] })));
}

export async function agentEarnings(): Promise<number> {
  return toUsdc(await publicClient.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "owed", args: [agent.address] }));
}

export async function readChainState(): Promise<ChainState> {
  const [block, peek, fee, total, idle, outstanding, pnl, funded] = await Promise.all([
    publicClient.getBlockNumber(),
    publicClient.readContract({ address: d.sequencerGuard, abi: SequencerGuardAbi, functionName: "peek" }),
    publicClient.readContract({ address: d.blackoutGuardHook, abi: BlackoutGuardHookAbi, functionName: "currentFee" }),
    publicClient.readContract({ address: d.lpVault, abi: LPVaultAbi, functionName: "totalAssets" }),
    publicClient.readContract({ address: d.lpVault, abi: LPVaultAbi, functionName: "idle" }),
    publicClient.readContract({ address: d.lpVault, abi: LPVaultAbi, functionName: "outstanding" }),
    publicClient.readContract({ address: d.lpVault, abi: LPVaultAbi, functionName: "realizedPnl" }),
    publicClient.readContract({ address: d.lpVault, abi: LPVaultAbi, functionName: "marketsFunded" }),
  ]);
  return {
    chainId: config.chainId,
    block: Number(block),
    sequencerPhase: PHASES[Number(peek[0])],
    blocksIntoRecovery: Number(peek[1]),
    blackoutFeePips: Number(fee),
    vault: { totalAssets: toUsdc(total), idle: toUsdc(idle), outstanding: toUsdc(outstanding), realizedPnl: Number(pnl) / 1e6, marketsFunded: Number(funded) },
  };
}

/** Testnet faucet: test USDC (open mint) plus a little gas. */
export async function faucet(to: `0x${string}`, usdc: number) {
  return asOwner(async () => {
    const usdcTx = await ownerWallet.writeContract({ address: d.usdc, abi: MockUSDCAbi, functionName: "mint", args: [to, fromUsdc(usdc)] });
    const bal = await publicClient.getBalance({ address: to });
    let ethTx: Hex | undefined;
    if (bal < parseEther(config.faucetEth) / 2n) ethTx = await ownerWallet.sendTransaction({ to, value: parseEther(config.faucetEth) });
    await confirm(usdcTx);
    if (ethTx) await confirm(ethTx);
    return { usdcTx, ethTx, usdc };
  });
}

/** Demo control for the mock sequencer feed (local only): an outage that ended just now. */
export async function simulateOutage(downSec: number) {
  if (!isLocalChain) throw new Error("outage simulation is local-only");
  return asOwner(async () => {
    const t = Number((await publicClient.getBlock()).timestamp);
    await confirm(await ownerWallet.writeContract({ address: d.sequencerFeed, abi: MockSequencerFeedAbi, functionName: "setStatus", args: [true, BigInt(t - downSec)] }));
    await confirm(await ownerWallet.writeContract({ address: d.sequencerFeed, abi: MockSequencerFeedAbi, functionName: "setStatus", args: [false, BigInt(t)] }));
    return { outageStart: t - downSec, outageEnd: t };
  });
}

/**
 * Keeper: record any sequencer status change the guard hasn't seen yet. Anyone may call `observe()`. Without it, a
 * quiet chain never anchors the recovery, because a reverting resolve rolls back its own observe.
 */
export async function pokeGuardIfStale() {
  const [st, feed] = await Promise.all([
    publicClient.readContract({ address: d.sequencerGuard, abi: SequencerGuardAbi, functionName: "state" }),
    publicClient.readContract({ address: d.sequencerFeed, abi: MockSequencerFeedAbi, functionName: "latestRoundData" }).catch(() => undefined),
  ]);
  if (!feed || BigInt(st.lastStatusChange) === feed[2]) return;
  return asAgent(async () => confirm(await agentWallet.writeContract({ address: d.sequencerGuard, abi: SequencerGuardAbi, functionName: "observe" })));
}

export const chainNow = async () => Number((await publicClient.getBlock()).timestamp);
