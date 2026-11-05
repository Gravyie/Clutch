"use client";

import { useState } from "react";
import NumberFlow from "@number-flow/react";
import { Area, AreaChart, ReferenceDot, ResponsiveContainer, XAxis, YAxis } from "recharts";
import { CircleNotchIcon, ShieldWarningIcon, VaultIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useEnsureReady } from "@/components/onboarding";
import { useAccount, useConfig } from "@/lib/account";
import { api, useLive } from "@/lib/live";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

// Mirrors the deployed BlackoutGuardHook (pips) and SequencerGuard.recoveryBlocks.
const BASE = 3_000;
const START = 150_000;
const N = 40;
const curve = Array.from({ length: N + 10 }, (_, b) => ({ b, fee: (b >= N ? BASE : START - ((START - BASE) * b) / N) / 10_000 }));

export default function VaultPage() {
  const chain = useLive((s) => s.chain);
  const v = chain?.vault;
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Liquidity vault</h1>
        <p className="mt-1 max-w-[65ch] text-muted-foreground">One USDC vault backs every market. You earn 1% of all volume plus whatever the market curve doesn't pay out. Your worst case is capped and shown live.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Total in vault" value={v?.totalAssets ?? 0} />
        <Stat label="At risk right now" value={v?.outstanding ?? 0} hint="Sum of open markets' worst cases" />
        <Stat label="Realized P&L" value={v?.realizedPnl ?? 0} signed />
        <div className="surface p-4">
          <div className="text-xs text-muted-foreground">Markets backed</div>
          <NumberFlow value={v?.marketsFunded ?? 0} className="mt-1 text-2xl font-semibold tabular" />
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
        <Position />
        <Blackout />
      </div>
    </div>
  );
}

function Stat({ label, value, hint, signed }: { label: string; value: number; hint?: string; signed?: boolean }) {
  return (
    <div className="surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <NumberFlow value={value} format={{ style: "currency", currency: "USD", maximumFractionDigits: value > 999 ? 0 : 2, signDisplay: signed ? "exceptZero" : "auto" }} className={cn("mt-1 text-2xl font-semibold tabular", signed && value > 0 && "text-yes", signed && value < 0 && "text-no")} />
      {hint && <div className="mt-0.5 text-[11px] text-faint">{hint}</div>}
    </div>
  );
}

function Position() {
  const acct = useAccount();
  const ensure = useEnsureReady();
  const [mode, setMode] = useState<"deposit" | "withdraw">("deposit");
  const [amt, setAmt] = useState("100");
  const [busy, setBusy] = useState(false);
  const n = Number(amt) || 0;
  return (
    <section className="surface p-5">
      <div className="flex items-center gap-2">
        <VaultIcon size={20} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">Your position</h2>
      </div>
      <NumberFlow value={acct.vault.assets} format={{ style: "currency", currency: "USD" }} className="mt-3 text-3xl font-semibold tabular" />
      <div className="text-xs text-faint">{acct.vault.shares.toFixed(2)} clLP shares</div>
      <Tabs value={mode} onValueChange={(x) => setMode(x as any)} className="mt-5">
        <TabsList className="h-9 w-full rounded-xl bg-raised p-1">
          <TabsTrigger value="deposit" className="flex-1 rounded-lg">Deposit</TabsTrigger>
          <TabsTrigger value="withdraw" className="flex-1 rounded-lg">Withdraw</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-4 flex h-12 items-center rounded-xl border border-border bg-sunk px-3">
        <span className="text-lg text-faint">$</span>
        <Input value={amt} onChange={(e) => setAmt(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" aria-label="Amount" className="h-full border-0 bg-transparent text-lg font-semibold shadow-none focus-visible:ring-0" />
        <button className="text-xs font-medium text-muted-foreground hover:text-foreground" onClick={() => setAmt(String(Math.floor((mode === "deposit" ? acct.usdc : acct.vault.assets) * 100) / 100))}>
          Max
        </button>
      </div>
      <Button
        className="mt-3 h-11 w-full rounded-xl font-semibold"
        disabled={busy || n <= 0}
        onClick={async () => {
          if (!ensure()) return;
          setBusy(true);
          try {
            if (mode === "deposit") await acct.deposit(n);
            else await acct.withdraw(n);
            toast.success(mode === "deposit" ? `Deposited ${usd(n)}` : `Withdrew ${usd(n)}`);
          } catch (e: any) {
            toast.error(e.shortMessage ?? e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy && <CircleNotchIcon className="animate-spin" />} {mode === "deposit" ? "Deposit" : "Withdraw"}
      </Button>
      <p className="mt-3 text-xs text-faint">Withdrawals come from idle funds. Money backing an open market comes back when it settles, usually within minutes.</p>
    </section>
  );
}

function Blackout() {
  const chain = useLive((s) => s.chain);
  const { data: cfg } = useConfig();
  const acct = useAccount();
  const [eth, setEth] = useState("0.01");
  const [busy, setBusy] = useState<string | null>(null);
  const k = chain?.sequencerPhase === "Recovering" ? chain.blocksIntoRecovery : chain?.sequencerPhase === "Normal" ? N + 5 : 0;
  const fee = (chain?.blackoutFeePips ?? BASE) / 10_000;
  return (
    <section className="surface p-5">
      <div className="flex items-center gap-2">
        <ShieldWarningIcon size={20} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">Blackout Guard</h2>
        <span className={cn("ml-auto rounded-full px-2 py-0.5 text-xs font-medium", chain?.sequencerPhase === "Normal" ? "bg-yes-soft text-yes" : "bg-warn-soft text-warn")}>{chain?.sequencerPhase ?? "…"}</span>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
        If the network's sequencer goes down, prices go stale and catch-up blocks can carry old timestamps. Clutch pauses trading and voids any market that traded through the outage, and the ETH/USDC pool you top up through prices the recovery as a falling-fee auction, so liquidity providers keep the arbitrage instead of losing it.
      </p>
      <div className="mt-4 h-36">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={curve} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
            <XAxis dataKey="b" tick={{ fontSize: 10, fill: "var(--faint)" }} tickLine={false} axisLine={false} ticks={[0, 10, 20, 30, 40]} />
            <YAxis tick={{ fontSize: 10, fill: "var(--faint)" }} tickLine={false} axisLine={false} tickFormatter={(x) => `${x}%`} width={40} />
            <Area type="linear" dataKey="fee" stroke="var(--warn)" strokeWidth={2} fill="var(--warn-soft)" isAnimationActive={false} />
            {chain?.sequencerPhase === "Recovering" && <ReferenceDot x={Math.min(k, N + 9)} y={fee} r={5} fill="var(--warn)" stroke="var(--background)" />}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex justify-between text-xs text-faint">
        <span>Fee by blocks since recovery</span>
        <span>
          Now <span className="font-medium text-foreground">{fee.toFixed(2)}%</span>
        </span>
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <div className="text-sm font-medium">Top up with ETH</div>
        <div className="mt-2 flex gap-2">
          <Input value={eth} onChange={(e) => setEth(e.target.value.replace(/[^0-9.]/g, ""))} className="h-10 rounded-lg" aria-label="ETH amount" />
          <Button
            variant="secondary"
            className="h-10 rounded-lg"
            disabled={busy !== null || !acct.address}
            onClick={async () => {
              setBusy("swap");
              try {
                toast.success(`Received ${usd(await acct.topUpEth(Number(eth)))} USDC`);
              } catch (e: any) {
                toast.error(e.shortMessage ?? e.message);
              } finally {
                setBusy(null);
              }
            }}
          >
            {busy === "swap" && <CircleNotchIcon className="animate-spin" />} Swap to USDC
          </Button>
        </div>
      </div>
      {cfg?.local && (
        <Button
          variant="ghost"
          className="mt-3 w-full rounded-lg text-xs text-muted-foreground"
          disabled={busy !== null}
          onClick={async () => {
            setBusy("outage");
            try {
              await api("/demo/outage", { body: { seconds: 45 } });
              toast("Simulated a 45s sequencer outage");
            } finally {
              setBusy(null);
            }
          }}
        >
          Simulate a sequencer outage (local network only)
        </Button>
      )}
    </section>
  );
}
