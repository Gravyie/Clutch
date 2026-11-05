"use client";

import { useQuery } from "@tanstack/react-query";
import { TrophyIcon } from "@phosphor-icons/react";
import type { LeaderRow } from "@clutch/shared";
import { Avatar } from "@/components/brand";
import { useAccount } from "@/lib/account";
import { api } from "@/lib/live";
import { compactUsd, short, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function Leaderboard() {
  const acct = useAccount();
  const { data, isLoading } = useQuery({ queryKey: ["leaderboard"], queryFn: () => api<LeaderRow[]>("/leaderboard"), refetchInterval: 20_000 });
  const rows = data ?? [];
  return (
    <div className="mx-auto max-w-[900px] space-y-6 px-4 py-6 sm:px-6">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Leaderboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">Ranked by realized profit on settled markets. One row per wallet.</p>
      </div>
      {rows.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {rows.slice(0, 3).map((r) => (
            <div key={r.address} className={cn("surface relative overflow-hidden p-5", r.rank === 1 && "sm:-translate-y-2")}>
              <TrophyIcon size={20} weight="fill" className={cn("absolute right-4 top-4", r.rank === 1 ? "text-warn" : "text-faint")} />
              <Avatar name={r.name ?? r.address} size={44} />
              <div className="mt-3 truncate font-semibold">{r.name ?? short(r.address, 6)}</div>
              <div className={cn("mt-1 text-2xl font-semibold tabular", r.pnl >= 0 ? "text-yes" : "text-no")}>
                {r.pnl >= 0 ? "+" : ""}
                {usd(r.pnl)}
              </div>
              <div className="mt-1 text-xs text-faint">
                {r.markets} markets · {Math.round(r.winRate * 100)}% won
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="surface overflow-hidden">
        <div className="grid grid-cols-[48px_1fr_100px_90px_80px] gap-3 border-b border-border px-4 py-2.5 text-xs text-faint">
          <span>#</span>
          <span>Trader</span>
          <span className="text-right">P&L</span>
          <span className="text-right">Volume</span>
          <span className="text-right">Won</span>
        </div>
        {isLoading && Array.from({ length: 5 }).map((_, i) => <div key={i} className="shimmer m-3 h-9 rounded-lg bg-raised/50" />)}
        {rows.map((r) => {
          const me = r.address.toLowerCase() === acct.address?.toLowerCase();
          return (
            <div key={r.address} className={cn("grid grid-cols-[48px_1fr_100px_90px_80px] items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0", me && "bg-yes-soft")}>
              <span className="text-sm text-faint tabular">{r.rank}</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <Avatar name={r.name ?? r.address} size={26} />
                <span className="truncate text-sm font-medium">{r.name ?? short(r.address, 6)}</span>
                {me && <span className="text-xs text-yes">You</span>}
              </span>
              <span className={cn("text-right text-sm font-medium tabular", r.pnl >= 0 ? "text-yes" : "text-no")}>{usd(r.pnl)}</span>
              <span className="text-right text-sm text-muted-foreground tabular">{compactUsd(r.volume)}</span>
              <span className="text-right text-sm text-muted-foreground tabular">{Math.round(r.winRate * 100)}%</span>
            </div>
          );
        })}
        {!isLoading && !rows.length && <p className="px-4 py-12 text-center text-sm text-faint">No settled trades yet. The first winner takes the top spot.</p>}
      </div>
    </div>
  );
}
