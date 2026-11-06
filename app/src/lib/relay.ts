"use client";

import { createWalletClient, custom, type Hex } from "viem";
import { chain } from "./env";

/**
 * Relay (relay.link): move money from any chain into the viewer's Clutch wallet in one step. A solver fills on the
 * destination in seconds, so a viewer with ETH on Ethereum or Arbitrum can fund Clutch without a bridge UI or an
 * exchange. Testnets: Ethereum Sepolia ↔ Base Sepolia. Mainnet covers Ethereum, Base, Arbitrum, Optimism, Unichain,
 * World Chain and more.
 */

export const RELAY_API = chain.testnet ? "https://api.testnets.relay.link" : "https://api.relay.link";

/** Relay can only deliver to chains it fills on; a local devnet isn't one of them. */
export const relayDestination = [84532, 8453, 130].includes(chain.id as number);

export const ORIGINS = chain.testnet
  ? [{ id: 11155111, name: "Ethereum Sepolia" }]
  : [
      { id: 1, name: "Ethereum" },
      { id: 42161, name: "Arbitrum" },
      { id: 10, name: "Optimism" },
      { id: 480, name: "World Chain" },
      { id: 8453, name: "Base" },
      { id: 130, name: "Unichain" },
    ].filter((c) => c.id !== chain.id);

export type RelayQuote = {
  steps: { id: string; requestId?: string; items: { data: { to: Hex; data: Hex; value: string; chainId: number } }[] }[];
  details?: { currencyOut?: { amountFormatted: string; amountUsd?: string }; timeEstimate?: number };
  fees?: { relayer?: { amountUsd?: string } };
};

export async function relayQuote(p: { user: Hex; recipient: Hex; originChainId: number; amountWei: bigint }): Promise<RelayQuote> {
  const r = await fetch(`${RELAY_API}/quote`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      user: p.user,
      recipient: p.recipient,
      originChainId: p.originChainId,
      destinationChainId: chain.id,
      originCurrency: "0x0000000000000000000000000000000000000000",
      destinationCurrency: "0x0000000000000000000000000000000000000000",
      amount: p.amountWei.toString(),
      tradeType: "EXACT_INPUT",
    }),
  });
  const body: any = await r.json();
  if (!r.ok) throw new Error(body.message ?? "Relay couldn't quote that");
  return body;
}

export async function relayStatus(requestId: string): Promise<"waiting" | "pending" | "success" | "failure" | "refund"> {
  const r = await fetch(`${RELAY_API}/intents/status/v2?requestId=${requestId}`);
  const body: any = await r.json().catch(() => ({}));
  return body.status ?? "waiting";
}

/** The viewer's browser wallet (MetaMask, Rabby…) signs the one deposit transaction on the origin chain. */
export async function sendWithBrowserWallet(step: RelayQuote["steps"][number]) {
  const eth = (window as any).ethereum;
  if (!eth) throw new Error("No browser wallet found. Install one, or send to your Clutch address instead.");
  const [from] = (await eth.request({ method: "eth_requestAccounts" })) as Hex[];
  const item = step.items[0].data;
  await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: `0x${item.chainId.toString(16)}` }] }).catch(() => {});
  const w = createWalletClient({ account: from, transport: custom(eth) });
  return w.sendTransaction({ account: from, chain: null, to: item.to, data: item.data, value: BigInt(item.value) });
}

export async function browserWalletAddress(): Promise<Hex | undefined> {
  const eth = (window as any).ethereum;
  if (!eth) return undefined;
  const [a] = (await eth.request({ method: "eth_requestAccounts" })) as Hex[];
  return a;
}
