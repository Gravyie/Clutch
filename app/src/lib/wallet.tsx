"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { PrivyProvider, useCreateWallet, usePrivy, useWallets } from "@privy-io/react-auth";
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
  /** with Privy on: skip the account and use a browser wallet (also the fallback if Privy can't load) */
  continueAsGuest?(): void;
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
        appearance: { theme: "dark", accentColor: "#ff6a2b", landingHeader: "Sign in to Clutch", showWalletLoginFirst: false },
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
  // Signed in with email or Google but no wallet yet (e.g. the app's auto-create is off): make the embedded one now,
  // so a new viewer never lands signed in with nothing to trade from.
  const { createWallet } = useCreateWallet();
  const creating = useRef(false);
  useEffect(() => {
    if (!ready || !walletsReady || !authenticated || wallets.length || creating.current) return;
    creating.current = true;
    createWallet().catch(() => {}).finally(() => (creating.current = false));
  }, [ready, walletsReady, authenticated, wallets.length, createWallet]);
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
  // A guest wallet chosen on this browser takes over until the viewer signs out of it.
  const guest = useGuestWallet();
  // No guest path in the product when Privy is on. Automated tests (and only they) open the app with ?test-wallet=1,
  // which offers a browser key with the same starter limits as any new wallet.
  const [testWallet, setTestWallet] = useState(false);
  useEffect(() => {
    try {
      if (new URLSearchParams(location.search).get("test-wallet") === "1") sessionStorage.setItem("clutch.test-wallet", "1");
      setTestWallet(sessionStorage.getItem("clutch.test-wallet") === "1");
    } catch {}
  }, []);
  const chosen = useMemo<Wallet>(
    () => (testWallet && guest.address && !authenticated ? guest : { ...value, continueAsGuest: testWallet ? guest.login : undefined }),
    [guest, value, authenticated, testWallet],
  );
  return <Ctx.Provider value={chosen}>{children}</Ctx.Provider>;
}

const GUEST_KEY = "clutch.guest.v2";

function useGuestWallet(): Wallet {
  const [pk, setPk] = useState<`0x${string}` | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setPk(localStorage.getItem(GUEST_KEY) as `0x${string}` | null);
    setReady(true);
  }, []);
  return useMemo<Wallet>(() => {
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
}

function GuestWallet({ children }: { children: React.ReactNode }) {
  const value = useGuestWallet();
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
