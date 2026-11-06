"use client";

import { DotType } from "@/components/dot-type";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircleIcon, ClockCounterClockwiseIcon, ListBulletsIcon, EyeIcon, ProhibitIcon, ShareNetworkIcon, ShieldCheckIcon, TimerIcon, TwitchLogoIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { MarketView, Refusal, StreamState } from "@clutch/shared";
import { Avatar, LiveBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlatformIcon, StreamStage, platformUrl } from "@/components/stream";
import { TradeTape, YourPosition } from "@/components/market";
import { PlayingOut, RecentRounds, RoundPanel, VisionPanel } from "@/components/round";
import { TwitchChat } from "@/components/chat";
import { api, useChannel, useLive, useNow } from "@/lib/live";
import { Fragment, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemSeparator, ItemTitle } from "@/components/ui/item";
import { ago, cents, compactUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface ChannelData {
  stream: StreamState;
  market: MarketView | null;
  history: MarketView[];
  refusals: Refusal[];
  pool: { poolId: string; key: { currency0: `0x${string}`; currency1: `0x${string}`; fee: number; tickSpacing: number; hooks: `0x${string}` } };
  latency: { samples: number; p50: number | null; p95: number | null };
}

const SCREEN: Record<string, string> = { menu: "a menu", replay: "a replay", break: "a break screen", camera: "the camera, not the game", other: "something other than gameplay" };

/** Why a channel has no market right now, in plain words. */
function waitingReason(s?: StreamState) {
  if (!s) return undefined;
  if (s.media?.kind !== "video") return s.live ? "A market opens when the game gets genuinely uncertain." : "Waiting for the next game.";
  if (!s.live) return "This channel is offline. Markets open automatically when it goes live.";
  if (s.rerun) return "This is a rerun. The result already happened, so it never gets markets.";
  if (!s.reading) return "Queued for an AI reader. The busiest live channels are read first.";
  const v = s.vision?.state;
  if (!v) return "The AI is starting to read this stream.";
  if (v.mode !== "gameplay") return `The AI sees ${SCREEN[v.mode] ?? "something other than gameplay"}. Markets open during live gameplay.`;
  return "The AI is reading live gameplay and waiting for a moment worth a market.";
}

export default function ChannelPage() {
  const { slug } = useParams<{ slug: string }>();
  useChannel(`stream:${slug}`);
  const { data, error } = useQuery({ queryKey: ["stream", slug], queryFn: () => api<ChannelData>(`/streams/${slug}`), refetchInterval: 20_000 });
  const live = useLive((s) => s.streamStates[slug]);
  const summary = useLive((s) => s.streams[slug]);
  const stream = live ?? data?.stream;
  const marketId = summary?.market?.id ?? data?.market?.id;
  const market = useLive((s) => (marketId ? s.markets[marketId] : undefined)) ?? data?.market ?? undefined;
  const liveRefusals = useLive((s) => s.refusals[slug]);

  if (error) {
    return (
      <div className="grid min-h-[60dvh] place-items-center px-4 text-center">
        <div>
          <DotType as="h1" start speed={34} text="Channel not found" className="display text-[2.2rem]" />
          <p className="mt-1 text-sm text-muted-foreground">It may have been removed or the link is wrong.</p>
          <Button asChild className="mt-4 rounded-xl">
            <Link href="/browse">Browse channels</Link>
          </Button>
        </div>
      </div>
    );
  }

  const isTwitch = stream?.media?.kind === "video" && stream.media.platform === "twitch";
  const isVideo = stream?.media?.kind === "video";

  return (
    <div className="mx-auto max-w-[1560px] px-3 pb-8 pt-3 sm:px-6 sm:pt-5">
      {stream ? <ChannelHeader s={stream} /> : <div className="shimmer mb-4 h-12 w-72 rounded-xl bg-raised/60" />}
      <div className="grid items-start gap-4 sm:gap-5 xl:grid-cols-[minmax(0,1fr)_392px] xl:grid-rows-[auto_1fr] xl:[grid-template-areas:'stage_rail'_'below_rail']">
        <div className="min-w-0 xl:[grid-area:stage]">
          <StreamStage stream={stream} />
        </div>

        {/* The rail: the market on top; on Twitch the chat fills the rest of the column, so nothing sits empty. */}
        <aside
          data-testid="market-aside"
          aria-label="Prediction and chat"
          className="scrollbar-none flex min-w-0 flex-col gap-3 xl:sticky xl:top-[76px] xl:h-[calc(100dvh-92px)] xl:overflow-y-auto xl:[grid-area:rail]"
        >
          <div data-testid="round" id="moment" className="shrink-0 scroll-mt-20">
            <RoundPanel m={market ?? undefined} stream={stream} pool={data?.pool.key} next={waitingReason(stream)} />
          </div>
          {market && (
            <div className="shrink-0">
              <YourPosition m={market} />
            </div>
          )}
          <div className="shrink-0 empty:hidden">
            <PlayingOut slug={slug} exclude={market?.id} />
          </div>
          {isTwitch && stream?.media?.kind === "video" ? (
            <TwitchChat channel={stream.media.channel} slug={slug} className="h-[380px] shrink-0 xl:h-auto xl:min-h-[340px] xl:flex-1" />
          ) : (
            <div className="hidden shrink-0 xl:block">
              <RecentRounds slug={slug} />
            </div>
          )}
        </aside>

        <div className="min-w-0 xl:[grid-area:below]">
          <Tabs defaultValue="activity">
            <TabsList className="scrollbar-none h-10 w-fit max-w-full justify-start gap-0.5 overflow-x-auto rounded-full bg-secondary p-1">
              <Tab v="activity">Activity</Tab>
              {isVideo && <Tab v="vision">AI view</Tab>}
              <Tab v="history">Past markets</Tab>
              <Tab v="integrity">Integrity</Tab>
            </TabsList>
            <TabsContent value="activity" className="mt-4 space-y-4">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[repeat(auto-fit,minmax(340px,1fr))]">
                <Moments s={stream} />
                <div className={cn("empty:hidden", !isTwitch && "xl:hidden")}>
                  <RecentRounds slug={slug} />
                </div>
              </div>
              {market && (
                <Card className="gap-3">
                  <CardHeader className="px-4">
                    <CardTitle className="text-sm">Recent trades</CardTitle>
                  </CardHeader>
                  <CardContent className="px-4">
                    <TradeTape marketId={market.id} />
                  </CardContent>
                </Card>
              )}
            </TabsContent>
            {isVideo && (
              <TabsContent value="vision" className="mt-4">
                <VisionPanel s={stream} />
              </TabsContent>
            )}
            <TabsContent value="history" className="mt-4">
              <History items={data?.history ?? []} />
            </TabsContent>
            <TabsContent value="integrity" className="mt-4">
              <Integrity s={stream} refusals={liveRefusals ?? data?.refusals ?? []} latency={data?.latency} />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      {market?.phase === "trading" && <MobileDock m={market} />}
    </div>
  );
}

/** Phones: while a market trades and its card is off-screen, a slim dock keeps the question and odds in reach. */
function MobileDock({ m }: { m: MarketView }) {
  const now = useNow(500);
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const el = document.getElementById("moment");
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setHidden(e.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const left = Math.max(0, Math.ceil(m.lockTime - now));
  if (left <= 0) return null;
  const jump = () => document.getElementById("moment")?.scrollIntoView({ behavior: "smooth", block: "start" });
  return (
    <div
      className={cn(
        "fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 transition duration-200 xl:hidden",
        hidden ? "pointer-events-none translate-y-3 opacity-0" : "translate-y-0 opacity-100",
      )}
      aria-hidden={hidden}
    >
      <div className="flex items-center gap-2 rounded-2xl border bg-popover/95 p-2 pl-3.5 shadow-float backdrop-blur-xl">
        <button onClick={jump} className="min-w-0 flex-1 text-left" tabIndex={hidden ? -1 : 0}>
          <span className="flex items-center gap-1.5 text-[11px] font-semibold text-live">
            <span className="size-1.5 animate-live rounded-full bg-live" /> Closes in <span className="font-mono tabular">{left}s</span>
          </span>
          <span className="block truncate text-[13px] font-medium">{m.question}</span>
        </button>
        <Button onClick={jump} tabIndex={hidden ? -1 : 0} variant="outline" className="h-11 shrink-0 rounded-xl border-yes/35 bg-yes-soft px-3 font-bold text-yes dark:bg-yes-soft">
          Yes <span className="font-mono tabular">{cents(m.priceYes)}</span>
        </Button>
        <Button onClick={jump} tabIndex={hidden ? -1 : 0} variant="outline" className="h-11 shrink-0 rounded-xl border-no/35 bg-no-soft px-3 font-bold text-no dark:bg-no-soft">
          No <span className="font-mono tabular">{cents(1 - m.priceYes)}</span>
        </Button>
      </div>
    </div>
  );
}

function Tab({ v, children }: { v: string; children: React.ReactNode }) {
  return (
    <TabsTrigger value={v} className="h-8 flex-none shrink-0 rounded-full px-4 text-[13px] data-[state=active]:bg-card data-[state=active]:shadow-sm dark:data-[state=active]:border-transparent dark:data-[state=active]:bg-card">
      {children}
    </TabsTrigger>
  );
}

function ChannelHeader({ s }: { s: StreamState }) {
  const video = s.media?.kind === "video";
  return (
    <div className="mb-3 flex items-center gap-3 sm:mb-4">
      <Avatar name={s.title} size={40} className={cn(!s.live && "grayscale")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-[17px] font-semibold tracking-tight sm:text-xl">{s.title}</h1>
          {s.owner?.verified && <CheckCircleIcon size={17} weight="fill" className="shrink-0 text-info" aria-label="Verified human streamer" />}
          {s.kind === "replay" ? <span className="shrink-0 rounded-[5px] bg-info-soft px-1.5 py-px text-[10.5px] font-bold text-info">REPLAY</span> : s.live ? <LiveBadge className="shrink-0" /> : <span className="shrink-0 rounded-[5px] bg-raised px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">OFFLINE</span>}
        </div>
        <div className="flex min-w-0 items-center gap-x-3 text-[12.5px] text-muted-foreground">
          {video ? (
            <a href={platformUrl(s)} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 hover:text-foreground">
              <PlatformIcon p={s.media?.kind === "video" ? s.media.platform : undefined} /> {s.media?.kind === "video" ? s.media.channel : ""}
            </a>
          ) : (
            <span className="shrink-0">Lichess · {s.subtitle}</span>
          )}
          {video && s.game && <span className="hidden shrink-0 sm:inline">{s.game}</span>}
          {video && s.streamTitle && <span className="hidden min-w-0 truncate text-faint md:inline">{s.streamTitle}</span>}
          <span className="flex shrink-0 items-center gap-1 text-faint">
            <EyeIcon size={13} /> {s.watching} on Clutch
          </span>
          {s.owner?.twitch && !video && (
            <a href={`https://twitch.tv/${s.owner.twitch}`} target="_blank" rel="noreferrer" className="hidden shrink-0 items-center gap-1 hover:text-foreground sm:flex">
              <TwitchLogoIcon size={13} /> {s.owner.twitch}
            </a>
          )}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        className="h-9 shrink-0 rounded-full px-3"
        aria-label="Copy link to this channel"
        onClick={() => {
          void navigator.clipboard.writeText(location.href);
          toast.success("Link copied");
        }}
      >
        <ShareNetworkIcon /> <span className="hidden sm:inline">Share</span>
      </Button>
    </div>
  );
}

function Moments({ s }: { s?: StreamState }) {
  const items = s?.moments ?? [];
  if (!items.length) return <EmptyNote icon={<ListBulletsIcon />} title="No activity yet" text="Moments from the game and its markets will show up here." />;
  return (
    <Card className="gap-0 py-0">
      <CardHeader className="border-b px-4 py-3 [.border-b]:pb-3">
        <CardTitle className="text-sm">Game and market activity</CardTitle>
      </CardHeader>
      <ItemGroup>
        {items.slice(0, 14).map((m, i) => (
          <Fragment key={`${m.at}-${i}`}>
            {i > 0 && <ItemSeparator />}
            <Item size="sm" className="rounded-none py-2.5">
              <ItemMedia>
                <span className={cn("size-2 rounded-full", m.kind === "market" ? "bg-brand" : m.kind === "integrity" ? "bg-warn" : "bg-faint/60")} aria-hidden />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className={cn("block w-full truncate", m.kind === "game" ? "font-normal text-muted-foreground" : "")}>{m.text}</ItemTitle>
              </ItemContent>
              <ItemActions className="text-[11.5px] text-faint tabular">{ago(m.at)}</ItemActions>
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    </Card>
  );
}

function History({ items }: { items: MarketView[] }) {
  if (!items.length) return <EmptyNote icon={<ClockCounterClockwiseIcon />} title="No past markets yet" text="Settled markets on this channel will appear here." />;
  return (
    <Card className="gap-0 py-0">
      <ItemGroup>
        {items.map((m, i) => (
          <Fragment key={m.id}>
            {i > 0 && <ItemSeparator />}
            <Item asChild size="sm" className="rounded-none hover:bg-secondary/50">
              <Link href={`/m/${m.id}`}>
                <ItemMedia>
                  <Badge className={cn("w-12 justify-center rounded-md font-semibold", m.outcome === "YES" ? "bg-yes-soft text-yes" : m.outcome === "NO" ? "bg-no-soft text-no" : "bg-void-soft text-void")}>{m.outcome ?? "…"}</Badge>
                </ItemMedia>
                <ItemContent className="min-w-0">
                  <ItemTitle className="block w-full truncate font-normal">{m.question}</ItemTitle>
                </ItemContent>
                <ItemActions className="gap-4 text-xs text-faint tabular">
                  <span className="hidden sm:inline">opened {cents(m.pYes0)}</span>
                  <span className="w-14 text-right">{compactUsd(m.volume)}</span>
                </ItemActions>
              </Link>
            </Item>
          </Fragment>
        ))}
      </ItemGroup>
    </Card>
  );
}

const REASON: Record<string, string> = {
  steerable: "One person could decide it",
  unsafe: "About a person, not the game",
  "not-uncertain": "Not uncertain enough",
  "not-resolvable": "Sources can't both check it",
  vetoed: "Vetoed by the streamer",
};

function Integrity({ s, refusals, latency }: { s?: StreamState; refusals: Refusal[]; latency?: { samples: number; p95: number | null } }) {
  const unique = refusals.filter((r, i, a) => a.findIndex((x) => x.question === r.question) === i);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Card className="gap-0 py-2">
        <ItemGroup>
          <Fact icon={<TimerIcon />} title={`${s?.latencyBufferSec ?? "…"}s latency buffer`} body={`Every market's window starts at least this long after trading closes, so nobody can trade on something they've already seen.${latency?.p95 ? ` Viewers' p95 delay: ${(latency.p95 / 1000).toFixed(1)}s.` : ""}`} />
          <Fact icon={<ShieldCheckIcon />} title="Two read paths must agree" body="Lichess's live stream and its game export are read separately. Both must report the same moves and result, or the market voids and stakes are refunded." />
          <Fact icon={<ProhibitIcon />} title="Streamer barred from own markets" body="The streamer's verified human ID is blocked from trading their own markets onchain. This limits, but cannot fully rule out, collusion." />
        </ItemGroup>
      </Card>
      <Card className="gap-3">
        <CardHeader className="px-5">
          <CardTitle className="text-sm">Questions the engine refused</CardTitle>
          <CardDescription className="text-xs">Proposed, checked against the rules, and never listed.</CardDescription>
        </CardHeader>
        <CardContent className="px-5">
          <ul className="space-y-2.5">
            {unique.slice(0, 6).map((r, i) => (
              <li key={i}>
                <div className="text-sm text-muted-foreground line-through decoration-faint">{r.question}</div>
                <div className="text-xs text-warn">{REASON[r.reason] ?? r.reason}</div>
              </li>
            ))}
            {!unique.length && <li className="text-sm text-faint">None yet for this game.</li>}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

function Fact({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <Item className="items-start">
      <ItemMedia variant="icon" className="size-9 rounded-lg">
        {icon}
      </ItemMedia>
      <ItemContent>
        <ItemTitle>{title}</ItemTitle>
        <ItemDescription className="line-clamp-none">{body}</ItemDescription>
      </ItemContent>
    </Item>
  );
}

function EmptyNote({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Empty className="border border-dashed py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon">{icon}</EmptyMedia>
        <EmptyTitle className="text-sm">{title}</EmptyTitle>
        <EmptyDescription>{text}</EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
