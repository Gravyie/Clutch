"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { CheckCircleIcon, EyeIcon, ProhibitIcon, ShareNetworkIcon, ShieldCheckIcon, TimerIcon, TwitchLogoIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { MarketView, Refusal, StreamState } from "@clutch/shared";
import { Avatar, LiveBadge } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PlatformIcon, StreamStage, platformUrl } from "@/components/stream";
import { TradeTape } from "@/components/market";
import { PlayingOut, RecentRounds, RoundPanel, VisionPanel } from "@/components/round";
import { TwitchChat } from "@/components/chat";
import { api, useChannel, useLive } from "@/lib/live";
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
          <h1 className="text-xl font-semibold">Channel not found</h1>
          <p className="mt-1 text-sm text-muted-foreground">It may have been removed or the link is wrong.</p>
          <Button asChild className="mt-4 rounded-xl">
            <Link href="/browse">Browse channels</Link>
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-[1600px] gap-5 px-4 py-5 sm:px-6 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0 space-y-5">
        <StreamStage stream={stream} />
        <div data-testid="round">
          <RoundPanel m={market ?? undefined} stream={stream} pool={data?.pool.key} next={waitingReason(stream)} />
        </div>
        {stream && <ChannelHeader s={stream} />}
        <div className="space-y-4 xl:hidden">
          {stream?.media?.kind === "video" && stream.media.platform === "twitch" && <TwitchChat channel={stream.media.channel} slug={slug} className="h-[380px]" />}
          <VisionPanel s={stream} />
          <PlayingOut slug={slug} exclude={market?.id} />
          <RecentRounds slug={slug} />
        </div>
        <Tabs defaultValue="moments">
          <TabsList className="h-10 rounded-xl bg-raised p-1">
            <TabsTrigger value="moments" className="rounded-lg px-3.5">
              Moments
            </TabsTrigger>
            <TabsTrigger value="history" className="rounded-lg px-3.5">
              Past markets
            </TabsTrigger>
            <TabsTrigger value="integrity" className="rounded-lg px-3.5">
              Integrity
            </TabsTrigger>
          </TabsList>
          <TabsContent value="moments" className="mt-4">
            <Moments s={stream} />
          </TabsContent>
          <TabsContent value="history" className="mt-4">
            <History items={data?.history ?? []} />
          </TabsContent>
          <TabsContent value="integrity" className="mt-4">
            <Integrity s={stream} refusals={liveRefusals ?? data?.refusals ?? []} latency={data?.latency} />
          </TabsContent>
        </Tabs>
      </div>

      <aside data-testid="market-aside" className="hidden space-y-4 xl:sticky xl:top-[4.5rem] xl:block xl:h-fit">
        {stream?.media?.kind === "video" && stream.media.platform === "twitch" && <TwitchChat channel={stream.media.channel} slug={slug} className="h-[460px]" />}
        <VisionPanel s={stream} />
        <PlayingOut slug={slug} exclude={market?.id} />
        <RecentRounds slug={slug} />
        {market && (
          <section className="surface p-4">
            <h3 className="mb-3 text-sm font-semibold">Recent trades</h3>
            <TradeTape marketId={market.id} />
          </section>
        )}
      </aside>
    </div>
  );
}

function ChannelHeader({ s }: { s: StreamState }) {
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar name={s.title} size={52} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h1 className="truncate text-xl font-semibold tracking-tight">{s.title}</h1>
          {s.owner?.verified && (
            <CheckCircleIcon size={18} weight="fill" className="text-yes" aria-label="Verified human streamer" />
          )}
          {s.live && <LiveBadge />}
        </div>
        {s.streamTitle && s.media?.kind === "video" && <p className="mt-0.5 line-clamp-1 text-sm">{s.streamTitle}</p>}
        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {s.media?.kind === "video" ? (
            <a href={platformUrl(s)} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
              <PlatformIcon p={s.media.platform} /> {s.media.channel}
            </a>
          ) : (
            <span>{s.subtitle}</span>
          )}
          {s.game && s.media?.kind === "video" && <span>{s.game}</span>}
          <span className="flex items-center gap-1">
            <EyeIcon size={14} /> {s.watching} watching
          </span>
          {s.owner?.lichess && (
            <a href={`https://lichess.org/@/${s.owner.lichess}`} target="_blank" rel="noreferrer" className="hover:text-foreground">
              lichess.org/@/{s.owner.lichess}
            </a>
          )}
          {s.owner?.twitch && (
            <a href={`https://twitch.tv/${s.owner.twitch}`} target="_blank" rel="noreferrer" className="flex items-center gap-1 hover:text-foreground">
              <TwitchLogoIcon size={14} /> {s.owner.twitch}
            </a>
          )}
        </div>
      </div>
      <Button
        variant="secondary"
        className="rounded-xl"
        onClick={() => {
          void navigator.clipboard.writeText(location.href);
          toast.success("Link copied");
        }}
      >
        <ShareNetworkIcon /> Share
      </Button>
    </div>
  );
}

function Moments({ s }: { s?: StreamState }) {
  const items = s?.moments ?? [];
  if (!items.length) return <Empty text="Moments from the game and its markets will show up here." />;
  return (
    <ol className="relative space-y-0 border-l border-border pl-5">
      {items.slice(0, 20).map((m, i) => (
        <li key={`${m.at}-${i}`} className="relative pb-4">
          <span className={cn("absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-background", m.kind === "market" ? "bg-yes" : m.kind === "integrity" ? "bg-warn" : "bg-faint")} />
          <div className="text-sm">{m.text}</div>
          <div className="text-xs text-faint">{ago(m.at)}</div>
        </li>
      ))}
    </ol>
  );
}

function History({ items }: { items: MarketView[] }) {
  if (!items.length) return <Empty text="Settled markets on this channel will appear here." />;
  return (
    <div className="surface divide-y divide-border">
      {items.map((m) => (
        <Link key={m.id} href={`/m/${m.id}`} className="flex items-center gap-3 px-4 py-3 transition hover:bg-raised/50">
          <span className={cn("w-12 shrink-0 rounded-md py-0.5 text-center text-[11px] font-semibold", m.outcome === "YES" ? "bg-yes-soft text-yes" : m.outcome === "NO" ? "bg-no-soft text-no" : "bg-void-soft text-void")}>
            {m.outcome ?? "…"}
          </span>
          <span className="min-w-0 flex-1 truncate text-sm">{m.question}</span>
          <span className="hidden text-xs text-faint sm:inline">opened {cents(m.pYes0)}</span>
          <span className="w-16 text-right text-xs text-faint tabular">{compactUsd(m.volume)}</span>
        </Link>
      ))}
    </div>
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
      <div className="surface space-y-4 p-4">
        <Fact icon={<TimerIcon size={18} />} title={`${s?.latencyBufferSec ?? "…"}s latency buffer`} body={`Every market's window starts at least this long after trading closes, so nobody can trade on something they've already seen.${latency?.p95 ? ` Viewers' p95 delay: ${(latency.p95 / 1000).toFixed(1)}s.` : ""}`} />
        <Fact icon={<ShieldCheckIcon size={18} />} title="Two independent sources" body="Lichess's live stream and its game export are read separately. Both must report the same moves and result, or the market voids." />
        <Fact icon={<ProhibitIcon size={18} />} title="No insider trading" body="The streamer's verified human ID is blocked from their own markets onchain. They earn from volume, never from outcomes." />
      </div>
      <div className="surface p-4">
        <h3 className="text-sm font-semibold">Questions the engine refused</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">Proposed, checked against the rules, and never listed.</p>
        <ul className="mt-3 space-y-2.5">
          {unique.slice(0, 6).map((r, i) => (
            <li key={i}>
              <div className="text-sm text-muted-foreground line-through decoration-faint">{r.question}</div>
              <div className="text-xs text-warn">{REASON[r.reason] ?? r.reason}</div>
            </li>
          ))}
          {!unique.length && <li className="text-sm text-faint">None yet for this game.</li>}
        </ul>
      </div>
    </div>
  );
}

function Fact({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="flex gap-3">
      <div className="grid size-9 shrink-0 place-items-center rounded-lg bg-raised text-muted-foreground">{icon}</div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <p className="mt-0.5 text-sm leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="rounded-2xl border border-dashed border-border px-4 py-10 text-center text-sm text-faint">{text}</div>;
}
