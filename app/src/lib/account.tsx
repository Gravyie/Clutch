"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BaseError, createPublicClient, decodeAbiParameters, decodeErrorResult, http, maxUint256, parseEther, type Hex } from "viem";
import { ClutchHookAbi, ClutchRouterAbi, ERROR_COPY, HumanPassGateAbi, LPVaultAbi, MockUSDCAbi, fromUsdc, toUsdc } from "@clutch/shared";
import { chain } from "./env";
import { api } from "./live";
import { useWallet } from "./wallet";
import { usd } from "./format";

export const publicClient = createPublicClient({ chain, transport: http(undefined, { batch: true }) });

export interface EngineConfig {
  chainId: number;
  explorer: string;
  local: boolean;
  deployment: {
    usdc: `0x${string}`;
    router: `0x${string}`;
    clutchHook: `0x${string}`;
    blackoutGuardHook: `0x${string}`;
    humanPassGate: `0x${string}`;
    lpVault: `0x${string}`;
    sequencerGuard: `0x${string}`;
    ethPool: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number };
  };
  twitchClientId?: string;
  faucet?: { starter: number; humanDaily: number };
  world: { configured: boolean; appId?: `app_${string}`; action: string; environment: "production" | "staging"; agentPass?: boolean; agentPassDev?: boolean };
  zeroG: { provider: "0g" | "heuristic"; model: string; storage: "0g" | "local" };
  lichessClientId: string;
  passDailyCap: number;
}

export const useConfig = () => useQuery({ queryKey: ["config"], queryFn: () => api<EngineConfig>("/config"), staleTime: Infinity, retry: 20, retryDelay: 1500 });

export interface Pass {
  gateData: Hex;
  nullifier: string;
  expiry: number;
  dailyCap: number;
  credential: string;
  dev: boolean;
  /** a wallet-bound starter pass (no World ID): small cap, no agents */
  starter?: boolean;
}

export interface Refusal {
  code: string;
  title: string;
  body: string;
}

export interface PoolKey {
  currency0: `0x${string}`;
  currency1: `0x${string}`;
  fee: number;
  tickSpacing: number;
  hooks: `0x${string}`;
}

/** Turns any revert (including PoolManager's WrappedError around a hook revert) into the rule that blocked it. */
export function explain(e: unknown): Refusal {
  const abi = [...ClutchHookAbi, ...HumanPassGateAbi, ...ClutchRouterAbi] as const;
  const tryDecode = (data?: string): string | undefined => {
    if (!data || data.length < 10) return;
    try {
      return decodeErrorResult({ abi, data: data as Hex }).errorName;
    } catch {}
    if (data.startsWith("0x90bfb865")) {
      try {
        const [, , reason] = decodeAbiParameters([{ type: "address" }, { type: "bytes4" }, { type: "bytes" }, { type: "bytes" }], `0x${data.slice(10)}`);
        return tryDecode(reason as string);
      } catch {}
    }
  };
  let name: string | undefined;
  if (e instanceof BaseError) {
    e.walk((x: any) => {
      name ??= x?.data?.errorName ?? tryDecode(typeof x?.data === "string" ? x.data : x?.raw);
      return false;
    });
    const m = e.message.match(/0x90bfb865[0-9a-fA-F]+/);
    name ??= m ? tryDecode(m[0]) : undefined;
  }
  const copy = name ? ERROR_COPY[name] : undefined;
  if (copy) return { code: name!, ...copy };
  const msg = (e as any)?.shortMessage ?? (e as Error)?.message ?? "Unknown error";
  if (/insufficient funds/i.test(msg)) return { code: "Gas", title: "Not enough gas", body: "Your wallet needs a little ETH for network fees. Use Add funds." };
  if (/user rejected|denied/i.test(msg)) return { code: "Rejected", title: "Cancelled", body: "You cancelled the request." };
  return { code: name ?? "Error", title: "That didn't go through", body: msg.split("\n")[0] };
}

interface Account {
  address?: `0x${string}`;
  ready: boolean;
  usdc: number;
  eth: number;
  approved: boolean;
  pass?: Pass;
  /** verified with World ID (or the labelled dev verifier), not just a starter pass */
  verified: boolean;
  stakedToday: number;
  excludedUntil: number;
  vault: { shares: number; assets: number };
  token?: string;
  onboarded: boolean;
  refresh(): Promise<void>;
  fund(): Promise<void>;
  approve(): Promise<void>;
  setPass(p: Pass | undefined): void;
  signIn(): Promise<string>;
  back(p: { marketId: number; pool: PoolKey; yes: boolean; amount: number }): Promise<{ shares: number; tx: Hex; paidWith: "usdc" | "eth" }>;
  /** what the wallet can stake right now, in USD: USDC plus ETH at the onramp pool's price */
  spendable: number;
  ethUsd: number;
  /** withdraw: send USDC or ETH from the Clutch wallet to any address on this chain */
  send(p: { to: Hex; asset: "usdc" | "eth"; amount: number }): Promise<Hex>;
  quote(marketId: number, yes: boolean, amount: number): Promise<{ shares: number; priceYesAfter: number }>;
  claim(marketId: number): Promise<number>;
  selfExclude(days: number): Promise<void>;
  deposit(amount: number): Promise<void>;
  withdraw(amount: number): Promise<void>;
  topUpEth(eth: number): Promise<number>;
}

const Ctx = createContext<Account | null>(null);
export const useAccount = () => {
  const a = useContext(Ctx);
  if (!a) throw new Error("AccountProvider missing");
  return a;
};

const passKey = (a: string) => `clutch.pass.${a.toLowerCase()}`;
const tokenKey = (a: string) => `clutch.token.${a.toLowerCase()}`;

export function AccountProvider({ children }: { children: React.ReactNode }) {
  const wallet = useWallet();
  const { data: cfg } = useConfig();
  const qc = useQueryClient();
  const address = wallet.address;
  const [pass, setPassState] = useState<Pass>();
  const [token, setToken] = useState<string>();
  const [ethUsd, setEthUsd] = useState(0);
  const [bal, setBal] = useState({ usdc: 0, eth: 0, allowance: 0n, stakedToday: 0, excludedUntil: 0, shares: 0, assets: 0, loaded: false });

  useEffect(() => {
    if (!address) {
      setPassState(undefined);
      setToken(undefined);
      return;
    }
    const p = localStorage.getItem(passKey(address));
    const parsed = p ? (JSON.parse(p) as Pass) : undefined;
    setPassState(parsed && parsed.expiry > Date.now() / 1000 + 60 ? parsed : undefined);
    setToken(localStorage.getItem(tokenKey(address)) ?? undefined);
  }, [address]);

  // ETH's price on the onramp pool (the Blackout Guard ETH/USDC pool), quoted by simulating a 0.01 ETH swap. The rate
  // includes the pool fee, so it is what a bet paid in ETH actually gets.
  useEffect(() => {
    if (!cfg) return;
    const d = cfg.deployment;
    const quote = async () => {
      const value = parseEther("0.01");
      const who = "0x000000000000000000000000000000000000dEaD" as const;
      const { result } = await publicClient.simulateContract({
        account: who,
        address: d.router,
        abi: ClutchRouterAbi,
        functionName: "swapExactIn",
        args: [{ ...d.ethPool, hooks: d.blackoutGuardHook }, true, value, 0n, who],
        value,
        stateOverride: [{ address: who, balance: parseEther("1") }],
      });
      setEthUsd(toUsdc(result) / 0.01);
    };
    void quote().catch(() => {});
    const t = setInterval(() => void quote().catch(() => {}), 30_000);
    return () => clearInterval(t);
  }, [cfg]);

  const ethFor = useCallback(
    async (usdAmount: number) => {
      if (!ethUsd) throw { code: "NoQuote", title: "Can't price ETH right now", body: "The ETH/USDC pool didn't answer. Try again in a moment." } satisfies Refusal;
      return parseEther((usdAmount / ethUsd).toFixed(18));
    },
    [ethUsd],
  );

  const refresh = useCallback(async () => {
    if (!address || !cfg) return;
    const d = cfg.deployment;
    const [usdc, eth, allowance, shares] = await Promise.all([
      publicClient.readContract({ address: d.usdc, abi: MockUSDCAbi, functionName: "balanceOf", args: [address] }),
      publicClient.getBalance({ address }),
      publicClient.readContract({ address: d.usdc, abi: MockUSDCAbi, functionName: "allowance", args: [address, d.router] }),
      publicClient.readContract({ address: d.lpVault, abi: LPVaultAbi, functionName: "balanceOf", args: [address] }),
    ]);
    const assets = shares > 0n ? await publicClient.readContract({ address: d.lpVault, abi: LPVaultAbi, functionName: "convertToAssets", args: [shares] }) : 0n;
    let stakedToday = 0;
    let excludedUntil = 0;
    if (pass) {
      const n = BigInt(pass.nullifier);
      const [s, x] = await Promise.all([
        publicClient.readContract({ address: d.humanPassGate, abi: HumanPassGateAbi, functionName: "stakedToday", args: [n] }),
        publicClient.readContract({ address: d.humanPassGate, abi: HumanPassGateAbi, functionName: "excludedUntil", args: [n] }),
      ]);
      stakedToday = toUsdc(s);
      excludedUntil = Number(x);
    }
    setBal({ usdc: toUsdc(usdc), eth: Number(eth) / 1e18, allowance, stakedToday, excludedUntil, shares: Number(shares) / 1e6, assets: toUsdc(assets), loaded: true });
  }, [address, cfg, pass]);

  useEffect(() => {
    void refresh().catch(() => {});
    const t = setInterval(() => void refresh().catch(() => {}), 5000);
    return () => clearInterval(t);
  }, [refresh]);

  const send = useCallback(
    async (req: any) => {
      const c = await wallet.client();
      const hash = await c.writeContract({ chain, account: c.account!, ...req });
      const r = await publicClient.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error("Transaction reverted");
      return hash;
    },
    [wallet],
  );

  const value = useMemo<Account>(() => {
    const d = cfg?.deployment;
    const need = () => {
      if (!d || !address) throw new Error("Sign in first");
      return d;
    };
    return {
      address,
      ready: wallet.ready && Boolean(cfg),
      usdc: bal.usdc,
      eth: bal.eth,
      approved: bal.allowance > 10n ** 30n,
      pass,
      verified: Boolean(pass && !pass.starter),
      stakedToday: bal.stakedToday,
      excludedUntil: bal.excludedUntil,
      vault: { shares: bal.shares, assets: bal.assets },
      token,
      // Ready = verified and this wallet can pay. (The day's spend is per person, so it says nothing about this wallet.)
      onboarded: Boolean(address && pass && bal.usdc + Math.max(0, bal.eth - 0.0002) * ethUsd >= 1),
      spendable: bal.usdc + Math.max(0, bal.eth - 0.0002) * ethUsd,
      ethUsd,

      async send({ to, asset, amount }) {
        const d = need();
        const tx =
          asset === "usdc"
            ? await send({ address: d.usdc, abi: MockUSDCAbi, functionName: "transfer", args: [to, fromUsdc(amount)] })
            : await (async () => {
                const c = await wallet.client();
                const hash = await c.sendTransaction({ chain, account: c.account!, to, value: parseEther(amount.toFixed(18)) });
                await publicClient.waitForTransactionReceipt({ hash });
                return hash;
              })();
        await refresh();
        return tx;
      },
      refresh,

      async fund() {
        if (!address) throw new Error("Sign in first");
        await api("/faucet", { body: { address } });
        await refresh();
      },

      async approve() {
        const d = need();
        await send({ address: d.usdc, abi: MockUSDCAbi, functionName: "approve", args: [d.router, maxUint256] });
        await send({ address: d.usdc, abi: MockUSDCAbi, functionName: "approve", args: [d.lpVault, maxUint256] });
        await refresh();
      },

      setPass(p) {
        if (!address) return;
        if (p) localStorage.setItem(passKey(address), JSON.stringify(p));
        else localStorage.removeItem(passKey(address));
        setPassState(p);
      },

      async signIn() {
        if (!address) throw new Error("Sign in first");
        if (token) return token;
        const { nonce } = await api<{ nonce: string }>("/auth/nonce", { body: { address } });
        const { message } = await api<{ message: string }>("/auth/message", { body: { address, nonce } });
        const c = await wallet.client();
        const signature = await c.signMessage({ account: c.account!, message });
        const { token: t } = await api<{ token: string }>("/auth/verify", { body: { address, nonce, signature } });
        localStorage.setItem(tokenKey(address), t);
        setToken(t);
        return t;
      },

      async quote(marketId, yes, amount) {
        const d = need();
        const [shares, p] = await publicClient.readContract({ address: d.clutchHook, abi: ClutchHookAbi, functionName: "quote", args: [BigInt(marketId), yes, fromUsdc(amount)] });
        return { shares: toUsdc(shares), priceYesAfter: Number(p) / 1e18 };
      },

      async back({ marketId, pool, yes, amount }) {
        const d = need();
        if (!pass) throw { code: "NoPass", title: "Verify you're human first", body: "One check per session keeps limits fair for everyone." } satisfies Refusal;
        try {
          await publicClient.readContract({ address: d.humanPassGate, abi: HumanPassGateAbi, functionName: "preflight", args: [address!, fromUsdc(amount), 0n, pass.gateData] });
        } catch (e) {
          throw explain(e);
        }
        try {
          const c = await wallet.client();
          let shares: bigint;
          let tx: Hex;
          let paidWith: "usdc" | "eth";
          if (bal.usdc >= amount) {
            // USDC path. The approval happens once, automatically, the first time it's needed.
            if (bal.allowance < fromUsdc(amount)) await send({ address: d.usdc, abi: MockUSDCAbi, functionName: "approve", args: [d.router, maxUint256] });
            const sim = await publicClient.simulateContract({ account: c.account!, address: d.router, abi: ClutchRouterAbi, functionName: "back", args: [pool, BigInt(marketId), yes, fromUsdc(amount), 0n, pass.gateData] });
            tx = await send(sim.request);
            shares = sim.result;
            paidWith = "usdc";
          } else {
            // ETH path: one transaction swaps ETH → USDC on the Blackout Guard pool and backs the side on the market
            // pool, inside a single PoolManager unlock. No USDC balance or approval needed.
            const ethKey = { ...d.ethPool, hooks: d.blackoutGuardHook };
            const value = await ethFor(amount);
            if (value > parseEther(String(bal.eth)) - parseEther("0.0002")) throw { code: "NoFunds", title: "Not enough balance", body: `You need about ${usd(amount)} in USDC or ETH. Top up from the account menu.` } satisfies Refusal;
            const sim = await publicClient.simulateContract({ account: c.account!, address: d.router, abi: ClutchRouterAbi, functionName: "backWithEth", args: [ethKey, pool, BigInt(marketId), yes, fromUsdc(amount * 0.97), 0n, pass.gateData], value });
            tx = await send(sim.request);
            shares = sim.result[1];
            paidWith = "eth";
          }
          void refresh();
          void qc.invalidateQueries({ queryKey: ["portfolio"] });
          return { shares: toUsdc(shares), tx, paidWith };
        } catch (e) {
          throw (e as Refusal)?.title ? e : explain(e);
        }
      },

      async claim(marketId) {
        const d = need();
        const c = await wallet.client();
        const sim = await publicClient.simulateContract({ account: c.account!, address: d.clutchHook, abi: ClutchHookAbi, functionName: "claim", args: [BigInt(marketId), address!] });
        await send(sim.request);
        void refresh();
        void qc.invalidateQueries({ queryKey: ["portfolio"] });
        return toUsdc(sim.result);
      },

      async selfExclude(days) {
        const d = need();
        if (!pass) return;
        const [p, sig] = decodeAbiParameters(
          [{ type: "tuple", components: [{ name: "trader", type: "address" }, { name: "nullifier", type: "uint256" }, { name: "expiry", type: "uint64" }, { name: "dailyCap", type: "uint128" }] }, { type: "bytes" }],
          pass.gateData,
        );
        await send({ address: d.humanPassGate, abi: HumanPassGateAbi, functionName: "selfExclude", args: [p, sig, BigInt(days * 86400)] });
        await refresh();
      },

      async deposit(amount) {
        const d = need();
        await send({ address: d.lpVault, abi: LPVaultAbi, functionName: "deposit", args: [fromUsdc(amount), address!] });
        await refresh();
      },

      async withdraw(amount) {
        const d = need();
        await send({ address: d.lpVault, abi: LPVaultAbi, functionName: "withdraw", args: [fromUsdc(amount), address!, address!] });
        await refresh();
      },

      async topUpEth(eth) {
        const d = need();
        const key = { ...d.ethPool, hooks: d.blackoutGuardHook };
        const value = parseEther(String(eth));
        const c = await wallet.client();
        const sim = await publicClient.simulateContract({ account: c.account!, address: d.router, abi: ClutchRouterAbi, functionName: "swapExactIn", args: [key, true, value, 0n, address!], value });
        await send(sim.request);
        await refresh();
        return toUsdc(sim.result);
      },
    };
  }, [address, cfg, bal, pass, token, refresh, send, wallet, qc, ethUsd, ethFor]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
