// Integration check: a wallet holding only ETH bets on a live market in one transaction through both hooks.
// Usage: npx tsx --env-file=.env src/scripts/eth-bet.ts
import { createWalletClient, http, parseEther, formatEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { ClutchRouterAbi, MockUSDCAbi, ClutchHookAbi, toUsdc } from "@clutch/shared";
import { config } from "../config";
import { publicClient, chain, owner } from "../chain";

const d = config.deployment;
const ENGINE = `http://localhost:${process.env.PORT ?? 8787}`;
const me = privateKeyToAccount(generatePrivateKey());
const wallet = createWalletClient({ account: me, chain, transport: http(config.rpcUrl) });
const ownerWallet = createWalletClient({ account: owner, chain, transport: http(config.rpcUrl) });

// gas money only: no USDC, no approvals
await publicClient.waitForTransactionReceipt({ hash: await ownerWallet.sendTransaction({ to: me.address, value: parseEther("0.004") }) });
const pass = await (await fetch(`${ENGINE}/pass/dev`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: "bob", wallet: me.address }) })).json();

let market: any;
for (let i = 0; i < 120 && !market; i++) {
  const streams = (await (await fetch(`${ENGINE}/streams`)).json()) as any[];
  const s = streams.find((x) => x.market?.phase === "trading" && x.market.lockTime - Date.now() / 1000 > 8);
  if (s) market = { id: s.market.id, slug: s.slug, q: s.market.question };
  else await new Promise((r) => setTimeout(r, 1000));
}
if (!market) throw new Error("no trading market");
const { pool } = (await (await fetch(`${ENGINE}/streams/${market.slug}`)).json()) as any;

const before = await publicClient.getBalance({ address: me.address });
const ethKey = { ...d.ethPool, hooks: d.blackoutGuardHook };
const { request, result } = await publicClient.simulateContract({
  account: me, address: d.router, abi: ClutchRouterAbi, functionName: "backWithEth",
  args: [ethKey, pool.key, BigInt(market.id), true, 0n, 0n, pass.gateData], value: parseEther("0.002"),
});
const hash = await wallet.writeContract(request);
const r = await publicClient.waitForTransactionReceipt({ hash });
const usdcBal = await publicClient.readContract({ address: d.usdc, abi: MockUSDCAbi, functionName: "balanceOf", args: [me.address] });
const pos = await publicClient.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "positions", args: [BigInt(market.id), me.address] });
console.log(JSON.stringify({
  market: `#${market.id} ${market.q}`, tx: hash, status: r.status, gasUsed: r.gasUsed.toString(),
  usdcIn: toUsdc(result[0]), shares: toUsdc(result[1]), positionYes: toUsdc(pos[0]),
  ethSpent: formatEther(before - (await publicClient.getBalance({ address: me.address }))), usdcHeld: toUsdc(usdcBal),
}, null, 2));
process.exit(0);
