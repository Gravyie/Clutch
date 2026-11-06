"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CrownSimpleIcon, InfoIcon, SealCheckIcon, TrophyIcon } from "@phosphor-icons/react";
import type { LeaderRow } from "@clutch/shared";
import { Avatar } from "@/components/brand";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccount } from "@/lib/account";
import { api } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { compactUsd, short, usd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LiveDot, Notice, PageHeader, PageShell, Reveal, Segmented, StatStrip } from "@/components/page";

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
  const verify = useUI((s) => s.openVerify);
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
    <PageShell>
      <PageHeader
        eyebrow={
          <>
            <LiveDot tone="yes" /> Testnet · real people only
          </>
        }
        title="Leaderboard"
        description="Ranked on settled markets. All of a person's wallets count as one, and open positions don't count until they resolve."
        actions={
          !acct.verified ? (
            <Button className="h-11 rounded-full bg-foreground px-5 text-[14.5px] font-medium text-background hover:bg-foreground/90" onClick={() => verify()}>
              <SealCheckIcon weight="fill" /> Verify to get ranked
            </Button>
          ) : undefined
        }
      />

      <div className="space-y-4">
        <StatStrip
          items={[
            { label: "Ranked people", value: data ? rows.length : undefined },
            { label: "Markets settled", value: stats ? stats.markets.toLocaleString() : undefined },
            { label: "Test USDC traded", value: stats ? compactUsd(stats.volume) : undefined },
            { label: "Voided and refunded", value: stats ? stats.voids.toLocaleString() : undefined },
          ]}
        />

        {acct.address ? (
          me ? (
            <Notice
              icon={<Avatar name={me.name ?? me.address} size={36} />}
              title={
                <>
                  You&apos;re <span className="tabular-nums">#{me.place}</span> <span className="text-muted-foreground">of {rows.length}</span>
                </>
              }
              action={<PnL value={me.pnl} className="text-lg" />}
            >
              {me.markets} {me.markets === 1 ? "market" : "markets"} · {Math.round(me.winRate * 100)}% won · {compactUsd(me.volume)} traded
            </Notice>
          ) : (
            <Notice icon={<TrophyIcon size={16} />} title="You're not ranked yet">
              {acct.verified ? "You appear here after your first market settles." : "Verify you're a real person, then your first settled market puts you on the board."}
            </Notice>
          )
        ) : (
          <Notice
            icon={<TrophyIcon size={16} />}
            title="See where you stand"
            action={
              <Button className="h-10 rounded-full bg-foreground px-5 font-medium text-background hover:bg-foreground/90" onClick={() => openSignIn()}>
                Sign in
              </Button>
            }
          >
            Back a side on any live market. You&apos;re ranked once it settles.
          </Notice>
        )}

        {rows.length >= 3 && <Podium rows={rows.slice(0, 3)} sort={sort} />}

        <Reveal delay={0.1}>
      <Card className="gap-0 overflow-hidden py-0">
        <CardHeader className="flex flex-col gap-4 border-b px-5 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 [.border-b]:pb-5">
          <div>
            <CardTitle className="flex items-center gap-1.5 text-[15px]">
              Rankings
              <Tooltip>
                <TooltipTrigger asChild>
                  <button className="text-faint transition-colors hover:text-foreground" aria-label="How profit is calculated">
                    <InfoIcon size={15} />
                  </button>
                </TooltipTrigger>
                <TooltipContent className="max-w-[260px]">Profit is payouts minus stakes on settled markets, in test USDC. Voided markets are refunded and count as zero.</TooltipContent>
              </Tooltip>
            </CardTitle>
            <CardDescription className="mt-0.5 text-[12.5px]">Updates every 20 seconds</CardDescription>
          </div>
          <Segmented label="Rank by" value={sort} onChange={setSort} options={SORTS.map((x) => ({ value: x.k, label: x.label }))} />
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
                <TableHead className="w-14 pl-6 text-xs font-normal text-faint">Rank</TableHead>
                <TableHead className="text-xs font-normal text-faint">Trader</TableHead>
                <TableHead className="hidden text-right text-xs font-normal text-faint sm:table-cell">Markets</TableHead>
                <TableHead className="hidden w-44 text-xs font-normal text-faint md:table-cell">Win rate</TableHead>
                <TableHead className="hidden text-right text-xs font-normal text-faint sm:table-cell">Volume</TableHead>
                <TableHead className="pr-6 text-right text-xs font-normal text-faint">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => {
                const mine = r.address === me?.address;
                return (
                  <TableRow key={r.address} data-state={mine ? "selected" : undefined} className="h-16 border-border data-[state=selected]:bg-brand-soft">
                    <TableCell className="pl-6">
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
                          <div className="text-[11.5px] text-faint tabular-nums">{short(r.address, 6)}</div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums sm:table-cell">{r.markets}</TableCell>
                    <TableCell className="hidden md:table-cell">
                      <div className="flex items-center gap-2.5">
                        <Progress value={r.winRate * 100} className="h-1.5 bg-secondary [&>[data-slot=progress-indicator]]:bg-yes" />
                        <span className="w-9 text-right text-xs text-muted-foreground tabular-nums">{Math.round(r.winRate * 100)}%</span>
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-right text-sm text-muted-foreground tabular-nums sm:table-cell">{compactUsd(r.volume)}</TableCell>
                    <TableCell className="pr-6 text-right">
                      <PnL value={r.pnl} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </Card>
        </Reveal>
      </div>
    </PageShell>
  );
}


function PnL({ value, className }: { value: number; className?: string }) {
  return <span className={cn("text-sm font-semibold tabular-nums", value > 0 ? "text-yes" : value < 0 ? "text-no" : "text-muted-foreground", className)}>{signed(value)}</span>;
}

function RankMark({ place }: { place: number }) {
  if (place > 3) return <span className="pl-2 text-sm text-faint tabular-nums">{place}</span>;
  return (
    <span
      className={cn(
        "grid size-7 place-items-center rounded-full text-xs font-semibold tabular-nums",
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
