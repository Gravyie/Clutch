"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CrownSimpleIcon, InfoIcon, TrophyIcon } from "@phosphor-icons/react";
import type { LeaderRow } from "@clutch/shared";
import { Avatar } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccount } from "@/lib/account";
import { api } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { compactUsd, short, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Sort = "pnl" | "volume" | "winRate";
type Stats = { markets: number; volume: number; traders: number; voids: number };

const SORTS: { k: Sort; label: string }[] = [
  { k: "pnl", label: "Profit" },
  { k: "volume", label: "Volume" },
  { k: "winRate", label: "Win rate" },
];

const signed = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${usd(Math.abs(n))}`;
const name = (r: LeaderRow) => r.name ?? short(r.address, 6);

export default function Leaderboard() {
  const acct = useAccount();
  const openSignIn = useUI((s) => s.openOnboarding);
  const { data, isLoading } = useQuery({ queryKey: ["leaderboard"], queryFn: () => api<LeaderRow[]>("/leaderboard"), refetchInterval: 20_000 });
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats"), refetchInterval: 20_000 });
  const [sort, setSort] = useState<Sort>("pnl");

  const rows = useMemo(() => {
    const list = [...(data ?? [])];
    if (sort !== "pnl") list.sort((a, b) => b[sort] - a[sort] || b.pnl - a.pnl);
    return list.map((r, i) => ({ ...r, place: i + 1 }));
  }, [data, sort]);
  const me = rows.find((r) => r.address.toLowerCase() === acct.address?.toLowerCase());

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="display text-3xl font-bold">Leaderboard</h1>
            <Badge variant="outline" className="rounded-full text-muted-foreground">
              Testnet
            </Badge>
          </div>
          <p className="mt-1.5 max-w-[64ch] text-sm text-muted-foreground">Wallets ranked on settled markets only. Open positions don&apos;t count until they resolve.</p>
        </div>
        <ToggleGroup type="single" variant="outline" value={sort} onValueChange={(v) => v && setSort(v as Sort)} aria-label="Rank by" className="w-full sm:w-auto">
          {SORTS.map((s) => (
            <ToggleGroupItem key={s.k} value={s.k} className="h-9 flex-1 px-4 text-[13px] data-[state=on]:bg-foreground data-[state=on]:text-background sm:flex-none">
              {s.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Ranked wallets" value={data ? String(rows.length) : undefined} />
        <Stat label="Markets settled" value={stats ? stats.markets.toLocaleString() : undefined} />
        <Stat label="Test USDC traded" value={stats ? compactUsd(stats.volume) : undefined} />
        <Stat label="Voided and refunded" value={stats ? stats.voids.toLocaleString() : undefined} />
      </div>

      {acct.address ? (
        me ? (
          <Item variant="outline" className="bg-card shadow-sm">
            <ItemMedia>
              <Avatar name={me.name ?? me.address} size={40} />
            </ItemMedia>
            <ItemContent>
              <ItemTitle>
                Your rank <span className="font-mono tabular">#{me.place}</span>
                <span className="text-muted-foreground">of {rows.length}</span>
              </ItemTitle>
              <ItemDescription>
                {me.markets} {me.markets === 1 ? "market" : "markets"} · {Math.round(me.winRate * 100)}% won · {compactUsd(me.volume)} traded
              </ItemDescription>
            </ItemContent>
            <ItemActions>
              <PnL value={me.pnl} className="text-base" />
            </ItemActions>
          </Item>
        ) : (
          <Item variant="outline" className="border-dashed">
            <ItemContent>
              <ItemTitle>You&apos;re not ranked yet</ItemTitle>
              <ItemDescription className="line-clamp-none">Your wallet appears here after your first market settles.</ItemDescription>
            </ItemContent>
          </Item>
        )
      ) : (
        <Item variant="outline" className="border-dashed">
          <ItemContent>
            <ItemTitle>See where you stand</ItemTitle>
            <ItemDescription className="line-clamp-none">Sign in and back a side on any live market. You&apos;re ranked once it settles.</ItemDescription>
          </ItemContent>
          <ItemActions>
            <Button size="sm" className="rounded-full bg-brand px-4 font-semibold text-brand-foreground hover:bg-brand/90" onClick={() => openSignIn()}>
              Sign in
            </Button>
          </ItemActions>
        </Item>
      )}

      {rows.length >= 3 && <Podium rows={rows.slice(0, 3)} sort={sort} />}

      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="flex flex-row items-center justify-between border-b px-5 py-4 [.border-b]:pb-4">
          <div>
            <CardTitle className="text-sm">Rankings</CardTitle>
            <CardDescription className="text-xs">Sorted by {SORTS.find((s) => s.k === sort)?.label.toLowerCase()}, updates every 20 seconds</CardDescription>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon-sm" className="text-faint" aria-label="How profit is calculated">
                <InfoIcon size={16} />
              </Button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[260px]">Profit is payouts minus stakes on settled markets, in test USDC. Voided markets are refunded and count as zero.</TooltipContent>
          </Tooltip>
        </CardHeader>

        {isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full rounded-lg" />
            ))}
          </div>
        ) : !rows.length ? (
          <Empty className="py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <TrophyIcon />
              </EmptyMedia>
              <EmptyTitle>No settled trades yet</EmptyTitle>
              <EmptyDescription>The first wallet to win a settled market takes the top spot.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-14 pl-5 text-xs">Rank</TableHead>
                <TableHead className="text-xs">Trader</TableHead>
                <TableHead className="hidden text-right text-xs sm:table-cell">Markets</TableHead>
                <TableHead className="hidden w-44 text-xs md:table-cell">Win rate</TableHead>
                <TableHead className="hidden text-right text-xs sm:table-cell">Volume</TableHead>
                <TableHead className="pr-5 text-right text-xs">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const mine = r.address === me?.address;
                return (
                  <TableRow key={r.address} data-state={mine ? "selected" : undefined} className="h-14 data-[state=selected]:bg-brand-soft">
                    <TableCell className="pl-5">
                      <RankMark place={r.place} />
                    </TableCell>
                    <TableCell>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={r.name ?? r.address} size={30} />
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-medium">{name(r)}</span>
                            {mine && <Badge className="h-[18px] rounded-full bg-brand px-1.5 text-[10.5px] text-brand-foreground">You</Badge>}
                          </div>
                          <div className="font-mono text-[11px] text-faint">{short(r.address, 6)}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-sm text-muted-foreground tabular sm:table-cell">{r.markets}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2.5">
                        <Progress value={r.winRate * 100} className="h-1.5 bg-secondary [&>[data-slot=progress-indicator]]:bg-yes" />
                        <span className="w-9 text-right font-mono text-xs text-muted-foreground tabular">{Math.round(r.winRate * 100)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right font-mono text-sm text-muted-foreground tabular sm:table-cell">{compactUsd(r.volume)}</TableCell>
                    <TableCell className="pr-5 text-right">
                      <PnL value={r.pnl} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: string }) {
  return (
    <Card className="gap-1.5 px-4 py-4">
      <CardDescription className="text-xs">{label}</CardDescription>
      {value === undefined ? <Skeleton className="h-7 w-20" /> : <CardTitle className="text-2xl font-semibold tracking-tight tabular">{value}</CardTitle>}
    </Card>
  );
}

function PnL({ value, className }: { value: number; className?: string }) {
  return <span className={cn("font-mono text-sm font-semibold tabular", value > 0 ? "text-yes" : value < 0 ? "text-no" : "text-muted-foreground", className)}>{signed(value)}</span>;
}

function RankMark({ place }: { place: number }) {
  if (place > 3) return <span className="pl-1.5 font-mono text-sm text-faint tabular">{place}</span>;
  return (
    <span
      className={cn(
        "grid size-7 place-items-center rounded-full font-mono text-xs font-bold tabular",
        place === 1 ? "bg-warn-soft text-warn" : place === 2 ? "bg-secondary text-muted-foreground" : "bg-[#c9824a]/15 text-[#c9824a]",
      )}
      aria-label={`Rank ${place}`}
    >
      {place}
    </span>
  );
}

/** Top three, shown only when there are three to show. Order on wide screens: 2, 1, 3. */
function Podium({ rows, sort }: { rows: (LeaderRow & { place: number })[]; sort: Sort }) {
  const order = [rows[1], rows[0], rows[2]];
  return (
    <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
      {order.map((r) => (
        <Card key={r.address} className={cn("gap-3 px-5 py-5", r.place === 1 ? "order-first border-warn/30 sm:order-none sm:pb-7" : "")}>
          <CardContent className="flex items-center gap-3 px-0">
            <div className="relative">
              <Avatar name={r.name ?? r.address} size={r.place === 1 ? 48 : 40} />
              {r.place === 1 && <CrownSimpleIcon weight="fill" size={18} className="absolute -top-3 left-1/2 -translate-x-1/2 text-warn" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{name(r)}</div>
              <div className="text-xs text-faint">
                {r.markets} markets · {Math.round(r.winRate * 100)}% won
              </div>
            </div>
            <RankMark place={r.place} />
          </CardContent>
          <div className="flex items-baseline justify-between border-t pt-3">
            <span className="text-xs text-faint">{sort === "volume" ? "Volume" : sort === "winRate" ? "Win rate" : "Profit"}</span>
            {sort === "volume" ? (
              <span className="font-mono text-lg font-semibold tabular">{compactUsd(r.volume)}</span>
            ) : sort === "winRate" ? (
              <span className="font-mono text-lg font-semibold tabular">{Math.round(r.winRate * 100)}%</span>
            ) : (
              <PnL value={r.pnl} className="text-lg" />
            )}
          </div>
        </Card>
      ))}
    </div>
  );
}
