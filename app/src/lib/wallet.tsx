"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { PrivyProvider, usePrivy, useWallets } from "@privy-io/react-auth";
import { createWalletClient, custom, http, type WalletClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { CHAIN_ID, PRIVY_APP_ID, chain } from "./env";

/**
 * One wallet interface for the app, two implementations:
 *  - Privy: sign in with email or Google; an embedded wallet is created on login and signs headlessly, so a trade is
 *    one tap with no wallet pop-up. Used whenever NEXT_PUBLIC_PRIVY_APP_ID is set.
 *  - Guest: a key kept in this browser. For local development and for trying Clutch without an account.
 */
export interface Wallet {
  kind: "privy" | "guest";
  ready: boolean;
  address?: `0x${string}`;
  label?: string;
  login(): void;
  logout(): Promise<void>;
  client(): Promise<WalletClient>;
}

const Ctx = createContext<Wallet | null>(null);
export const useWallet = () => {
  const w = useContext(Ctx);
  if (!w) throw new Error("WalletProvider missing");
  return w;
};

export function WalletProvider({ children }: { children: React.ReactNode }) {
  if (!PRIVY_APP_ID) return <GuestWallet>{children}</GuestWallet>;
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "google", "wallet"],
        appearance: { theme: "dark", accentColor: "#22d391", landingHeader: "Sign in to Clutch", showWalletLoginFirst: false },
        embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
        defaultChain: chain,
        supportedChains: [chain],
      }}
    >
      <PrivyBridge>{children}</PrivyBridge>
    </PrivyProvider>
  );
}

function PrivyBridge({ children }: { children: React.ReactNode }) {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const w = wallets.find((x) => x.walletClientType === "privy") ?? wallets[0];
  const client = useCallback(async () => {
    if (!w) throw new Error("No wallet yet");
    if (Number(w.chainId.split(":")[1]) !== CHAIN_ID) await w.switchChain(CHAIN_ID);
    const provider = await w.getEthereumProvider();
    return createWalletClient({ account: w.address as `0x${string}`, chain, transport: custom(provider) });
  }, [w]);
  const value = useMemo<Wallet>(
    () => ({
      kind: "privy",
      ready: ready && walletsReady,
      address: authenticated ? (w?.address as `0x${string}` | undefined) : undefined,
      label: user?.email?.address ?? user?.google?.email ?? undefined,
      login,
      logout,
      client,
    }),
    [ready, walletsReady, authenticated, w, user, login, logout, client],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const GUEST_KEY = "clutch.guest.v2";

function GuestWallet({ children }: { children: React.ReactNode }) {
  const [pk, setPk] = useState<`0x${string}` | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setPk(localStorage.getItem(GUEST_KEY) as `0x${string}` | null);
    setReady(true);
  }, []);
  const value = useMemo<Wallet>(() => {
    const account = pk ? privateKeyToAccount(pk) : undefined;
    return {
      kind: "guest",
      ready,
      address: account?.address,
      label: account ? "Guest wallet on this browser" : undefined,
      login() {
        const k = generatePrivateKey();
        localStorage.setItem(GUEST_KEY, k);
        setPk(k);
      },
      async logout() {
        localStorage.removeItem(GUEST_KEY);
        setPk(null);
      },
      async client() {
        if (!account) throw new Error("Sign in first");
        return createWalletClient({ account, chain, transport: http() });
      },
    };
  }, [pk, ready]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
