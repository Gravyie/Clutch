import { createWalletClient, http, parseEther, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { MockUSDCAbi } from "@clutch/shared";
import { config } from "./config";
import { chain, publicClient } from "./chain";

/**
 * Free test funds come from their own small hot wallet (FAUCET_PRIVATE_KEY), not the owner/deployer: test USDC is an
 * open mint, so all this key needs is a little ETH for gas. A production engine can then run without the owner key.
 * Locally it falls back to the owner key. Transactions from one wallet are serialized so nonces never collide.
 */
const key = (process.env.FAUCET_PRIVATE_KEY || config.ownerKey) as Hex | undefined;
const account = key ? privateKeyToAccount(key) : undefined;
const wallet = account ? createWalletClient({ chain, account, transport: http(config.rpcUrl, { retryCount: 3, timeout: 20_000 }) }) : undefined;
const toUnits = (usd: number) => BigInt(Math.round(usd * 1e6));

export const faucetAddress = account?.address;

let queue: Promise<unknown> = Promise.resolve();
const serial = <T>(f: () => Promise<T>) => {
  const p = queue.then(f, f);
  queue = p.catch(() => undefined);
  return p;
};

export async function sendFreeFunds(to: Hex, usdc: number) {
  if (!wallet) throw Object.assign(new Error("Free test funds are off on this server."), { status: 503 });
  return serial(async () => {
    const usdcTx = await wallet.writeContract({ address: config.deployment.usdc, abi: MockUSDCAbi, functionName: "mint", args: [to, toUnits(usdc)] });
    let ethTx: Hex | undefined;
    const gas = parseEther(config.faucetEth);
    if ((await publicClient.getBalance({ address: to })) < gas / 2n) ethTx = await wallet.sendTransaction({ to, value: gas });
    await publicClient.waitForTransactionReceipt({ hash: usdcTx });
    if (ethTx) await publicClient.waitForTransactionReceipt({ hash: ethTx });
    return { usdcTx, ethTx, usdc };
  });
}
