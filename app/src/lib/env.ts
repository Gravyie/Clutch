import { defineChain } from "viem";
import { baseSepolia, unichainSepolia } from "viem/chains";

export const ENGINE_URL = process.env.NEXT_PUBLIC_ENGINE_URL ?? "http://localhost:8787";
export const PRIVY_APP_ID = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL;

export const chain =
  CHAIN_ID === baseSepolia.id
    ? { ...baseSepolia, rpcUrls: RPC_URL ? { default: { http: [RPC_URL] } } : baseSepolia.rpcUrls }
    : CHAIN_ID === unichainSepolia.id
      ? { ...unichainSepolia, rpcUrls: RPC_URL ? { default: { http: [RPC_URL] } } : unichainSepolia.rpcUrls }
      : defineChain({
          id: 31337,
          name: "Clutch Local",
          nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
          rpcUrls: { default: { http: [RPC_URL ?? "http://127.0.0.1:8545"] } },
          testnet: true,
        });

export const explorerTx = (hash?: string) => (hash && chain.blockExplorers ? `${chain.blockExplorers.default.url}/tx/${hash}` : undefined);
export const explorerAddress = (a?: string) => (a && chain.blockExplorers ? `${chain.blockExplorers.default.url}/address/${a}` : undefined);
