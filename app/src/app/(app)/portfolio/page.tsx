"use client";

import { DotType } from "@/components/dot-type";
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
  const setWallet = useUI((s) => s.setWallet);
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
        <DotType as="h1" start speed={34} text="Your positions live here" className="display mt-4 text-[2.2rem]" />
        <p className="mt-1 text-sm text-muted-foreground">Sign in to track open trades, winnings and history.</p>
        <Button className="mt-5 rounded-xl" onClick={() => open()}>
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

  const total = acct.spendable + (data?.stats.openValue ?? 0);
  const pnl = data?.stats.realizedPnl ?? 0;
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 sm:px-6">
      <section className="surface relative overflow-hidden p-6 sm:p-8">
        <div aria-hidden className="absolute -right-24 -top-24 size-72 rounded-full bg-brand/15 blur-3xl" />
        <div className="relative flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="text-sm text-muted-foreground">Total value</div>
            <NumberFlow value={total} format={{ style: "currency", currency: "USD" }} className="display mt-1 text-[3.4rem] tabular sm:text-[4rem]" />
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className={cn("font-medium tabular", pnl > 0.005 ? "text-yes" : pnl < -0.005 ? "text-no" : "text-muted-foreground")}>
                {pnl > 0 ? "+" : ""}
                {usd(pnl)} all time
              </span>
              <span className="text-faint">{usd(acct.spendable)} available · {usd(data?.stats.openValue ?? 0)} in live markets</span>
            </div>
          </div>
          <div className="flex gap-2">
            <Button className="h-11 rounded-full bg-foreground px-6 font-medium text-background hover:bg-foreground/90" onClick={() => setWallet("deposit")}>
              Deposit
            </Button>
            <Button variant="secondary" className="h-11 rounded-full px-6 font-semibold" onClick={() => setWallet("withdraw")}>
              Withdraw
            </Button>
          </div>
        </div>
        {claimable.length > 0 && (
          <div className="relative mt-6 flex items-center justify-between rounded-xl bg-yes-soft px-4 py-3 text-sm">
            <span className="text-yes">
              {usd(data?.stats.claimable ?? 0)} on its way to your balance. Winnings are paid automatically at settlement.
            </span>
            <Button size="sm" variant="ghost" className="rounded-full text-yes" disabled={collecting} onClick={collectAll}>
              {collecting ? <CircleNotchIcon className="animate-spin" /> : <HandCoinsIcon />} Collect now
            </Button>
          </div>
        )}
      </section>

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


function Center({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">{children}</div>;
}
