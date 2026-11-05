"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { ChartLineUpIcon, CircleNotchIcon, HandCoinsIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { Portfolio, Position } from "@clutch/shared";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAccount } from "@/lib/account";
import { api, useLive } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { cents, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function PortfolioPage() {
  const acct = useAccount();
  const open = useUI((s) => s.openOnboarding);
  const qc = useQueryClient();
  const myTrades = useLive((s) => s.trades.filter((t) => t.trader.toLowerCase() === acct.address?.toLowerCase()).length);
  const receipts = useLive((s) => s.receipts.length);
  const { data, isLoading } = useQuery({
    queryKey: ["portfolio", acct.address, myTrades, receipts],
    queryFn: () => api<Portfolio>(`/portfolio/${acct.address}`),
    enabled: !!acct.address,
  });
  const [tab, setTab] = useState<"open" | "settled">("open");
  const [collecting, setCollecting] = useState(false);

  if (!acct.address) {
    return (
      <Center>
        <ChartLineUpIcon size={36} className="text-faint" />
        <h1 className="mt-3 text-xl font-semibold">Your positions live here</h1>
        <p className="mt-1 text-sm text-muted-foreground">Sign in to track open trades, winnings and history.</p>
        <Button className="mt-5 rounded-xl" onClick={open}>
          Sign in
        </Button>
      </Center>
    );
  }

  const positions = data?.positions ?? [];
  const openPos = positions.filter((p) => p.phase !== "settled" && p.phase !== "void");
  const settled = positions.filter((p) => p.phase === "settled" || p.phase === "void");
  const claimable = positions.filter((p) => p.claimable > 0);

  async function collectAll() {
    setCollecting(true);
    let total = 0;
    try {
      for (const p of claimable) total += await acct.claim(p.marketId);
      toast.success(`Collected ${usd(total)}`);
    } catch (e: any) {
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setCollecting(false);
      void qc.invalidateQueries({ queryKey: ["portfolio"] });
    }
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Portfolio</h1>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Cash" value={acct.usdc} money />
        <Stat label="In open markets" value={data?.stats.openValue ?? 0} money />
        <Stat label="All-time P&L" value={data?.stats.realizedPnl ?? 0} money signed />
        <div className="surface flex flex-col justify-between p-4">
          <div className="text-xs text-muted-foreground">Ready to collect</div>
          <div className="mt-1 flex items-end justify-between gap-2">
            <NumberFlow value={data?.stats.claimable ?? 0} format={{ style: "currency", currency: "USD" }} className="text-2xl font-semibold tabular" />
            <Button size="sm" className="rounded-lg" disabled={!claimable.length || collecting} onClick={collectAll}>
              {collecting ? <CircleNotchIcon className="animate-spin" /> : <HandCoinsIcon />} Collect
            </Button>
          </div>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="h-10 rounded-xl bg-raised p-1">
          <TabsTrigger value="open" className="rounded-lg px-3.5">
            Open <span className="ml-1 tabular opacity-60">{openPos.length}</span>
          </TabsTrigger>
          <TabsTrigger value="settled" className="rounded-lg px-3.5">
            Settled <span className="ml-1 tabular opacity-60">{settled.length}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="surface overflow-hidden">
        <div className="hidden grid-cols-[1fr_110px_90px_100px_110px] gap-4 border-b border-border px-4 py-2.5 text-xs text-faint md:grid">
          <span>Market</span>
          <span>Position</span>
          <span className="text-right">Cost</span>
          <span className="text-right">{tab === "open" ? "Value" : "Payout"}</span>
          <span className="text-right">P&L</span>
        </div>
        {isLoading && Array.from({ length: 3 }).map((_, i) => <div key={i} className="shimmer m-3 h-12 rounded-lg bg-raised/50" />)}
        {(tab === "open" ? openPos : settled).map((p) => (
          <PositionRow key={p.marketId} p={p} />
        ))}
        {!isLoading && !(tab === "open" ? openPos : settled).length && (
          <p className="px-4 py-12 text-center text-sm text-faint">
            {tab === "open" ? (
              <>
                No open positions. <Link href="/browse" className="text-foreground underline underline-offset-4">Find a live market</Link>
              </>
            ) : (
              "Nothing settled yet."
            )}
          </p>
        )}
      </div>
    </div>
  );
}

function PositionRow({ p }: { p: Position }) {
  const pnl = p.value - p.cost;
  return (
    <Link href={`/m/${p.marketId}`} className="grid gap-1 border-b border-border px-4 py-3 transition last:border-b-0 hover:bg-raised/40 md:grid-cols-[1fr_110px_90px_100px_110px] md:items-center md:gap-4">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{p.question}</div>
        <div className="text-xs text-faint">
          {p.outcome ? `Resolved ${p.outcome}` : `Now ${cents(p.priceYes)} Yes`}
          {p.claimable > 0 && <span className="ml-2 font-medium text-yes">Ready to collect</span>}
          {p.claimed && <span className="ml-2">Collected</span>}
        </div>
      </div>
      <div className="text-sm tabular">
        {p.yes > 0 && <span className="text-yes">{p.yes.toFixed(1)} Yes</span>}
        {p.yes > 0 && p.no > 0 && " "}
        {p.no > 0 && <span className="text-no">{p.no.toFixed(1)} No</span>}
      </div>
      <div className="text-sm tabular md:text-right">{usd(p.cost)}</div>
      <div className="text-sm tabular md:text-right">{usd(p.value)}</div>
      <div className={cn("text-sm font-medium tabular md:text-right", pnl > 0.005 ? "text-yes" : pnl < -0.005 ? "text-no" : "text-muted-foreground")}>
        {pnl > 0 ? "+" : ""}
        {usd(pnl)}
      </div>
    </Link>
  );
}

function Stat({ label, value, money, signed }: { label: string; value: number; money?: boolean; signed?: boolean }) {
  return (
    <div className="surface p-4">
      <div className="text-xs text-muted-foreground">{label}</div>
      <NumberFlow
        value={value}
        format={money ? { style: "currency", currency: "USD", signDisplay: signed ? "exceptZero" : "auto" } : undefined}
        className={cn("mt-1 text-2xl font-semibold tabular", signed && value > 0 && "text-yes", signed && value < 0 && "text-no")}
      />
    </div>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">{children}</div>;
}
