"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import NumberFlow from "@number-flow/react";
import { ArrowRightIcon, BroadcastIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { Masonry } from "@/components/masonry";
import { ChannelCard, channelCardHeight, StreamStage } from "@/components/stream";
import { MarketCard, ReceiptRow, isOpen } from "@/components/market";
import { RecentRounds, RoundPanel } from "@/components/round";
import { useAccount } from "@/lib/account";
import { api, useChannel, useLive } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { compactUsd } from "@/lib/format";
import { channelRank } from "@/components/shell";
import { LiveDot, Notice, PageHeader, PageShell, Reveal, SectionHeader } from "@/components/page";

export default function Home() {
  const streams = useLive((s) => s.streams);
  const markets = useLive((s) => s.markets);
  const receipts = useLive((s) => s.receipts);
  const list = Object.values(streams).sort(channelRank);
  const liveMarkets = Object.values(markets)
    .filter(isOpen)
    .sort((a, b) => (a.phase === "trading" ? 0 : 1) - (b.phase === "trading" ? 0 : 1) || b.volume - a.volume);
  const featured = list.find((s) => s.market?.phase === "trading" && s.media?.kind === "video") ?? list[0];

  return (
    <PageShell wide className="space-y-20 sm:space-y-24">
      <div>
        <Intro />
        {featured ? <Reveal delay={0.15}><Featured slug={featured.slug} /></Reveal> : <div className="h-[520px] animate-pulse rounded-[20px] bg-secondary" />}
      </div>

      <section>
        <SectionHeader title="Live markets" href="/browse" />
        {liveMarkets.length ? (
          <Reveal>
          <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
            {liveMarkets.map((m) => (
              <div key={m.id} className="w-[300px] shrink-0 snap-start">
                <MarketCard m={m} />
              </div>
            ))}
          </div>
          </Reveal>
        ) : (
          <Notice icon={<BroadcastIcon size={16} />} title="No markets open this second">
            They open the moment a stream gets tense, usually within a minute or two. Pick a channel below and watch.
          </Notice>
        )}
      </section>

      <section>
        <SectionHeader title="Live now" href="/browse" />
        <Reveal>
        <Masonry items={list.filter((s) => s.live).slice(0, 12)} getKey={(s) => s.slug} estimate={channelCardHeight} render={(s) => <ChannelCard s={s} />} />
        </Reveal>
      </section>

      <section>
        <SectionHeader title="Just settled" description="Every result, with the rule that decided it." />
        <Reveal className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="surface h-full p-1.5">
            {receipts.length ? receipts.slice(0, 7).map((r) => <ReceiptRow key={r.marketId} r={r} />) : <p className="px-3 py-6 text-center text-sm text-faint">Results appear here as markets settle.</p>}
          </div>
          <ProofPanel />
        </Reveal>
      </section>
    </PageShell>
  );
}

function Intro() {
  const acct = useAccount();
  const open = useUI((s) => s.openOnboarding);
  const streams = useLive((s) => s.streams);
  const all = Object.values(streams);
  const reading = all.filter((s) => s.reading).length;
  const live = all.filter((s) => s.live).length;
  return (
    <PageHeader
      eyebrow={
        <>
          <LiveDot /> <span className="tabular-nums">{live}</span> streams live · AI reading <span className="tabular-nums">{reading}</span>
        </>
      }
      title="Live now"
      description="Pick a stream, wait for the moment, and call it before it locks."
      actions={
        !acct.onboarded ? (
          <>
            <span className="hidden text-[13.5px] text-muted-foreground lg:inline">Free test funds, one tap per trade</span>
            <Button className="h-11 rounded-full bg-foreground px-5 text-[14.5px] font-medium text-background hover:bg-foreground/90" onClick={() => open()}>
              Start trading <ArrowRightIcon />
            </Button>
          </>
        ) : undefined
      }
    />
  );
}

function Featured({ slug }: { slug: string }) {
  useChannel(`stream:${slug}`);
  const stream = useLive((s) => s.streamStates[slug]);
  const summary = useLive((s) => s.streams[slug]);
  const market = useLive((s) => (summary?.market ? s.markets[summary.market.id] : undefined));
  const { data } = useQuery({ queryKey: ["stream", slug], queryFn: () => api<{ pool: { key: any } }>(`/streams/${slug}`), staleTime: 60_000 });
  return (
    <section className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_400px]">
      <Link href={`/c/${slug}`} className="block min-w-0">
        <StreamStage stream={stream} compact />
      </Link>
      {/* h-0 + min-h-full: the column takes exactly the stream's height, and the results list fits inside it */}
      <div className="flex min-h-0 flex-col gap-3 lg:h-0 lg:min-h-full">
        <Link href={`/c/${slug}`} className="flex h-6 items-center justify-between px-1 text-[13.5px]">
          <span className="font-medium">{summary?.title}</span>
          <span className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            Open channel <ArrowRightIcon size={14} />
          </span>
        </Link>
        <RoundPanel m={market && isOpen(market) ? market : undefined} stream={stream} pool={data?.pool.key} />
        <FeaturedResults slug={slug} />
      </div>
    </section>
  );
}

/** Under the featured market: this channel's recent results, or the latest across Clutch if it has none yet. */
function FeaturedResults({ slug }: { slug: string }) {
  const receipts = useLive((s) => s.receipts);
  const own = receipts.some((r) => r.slug === slug);
  if (own) return <RecentRounds slug={slug} className="hidden min-h-0 flex-1 lg:flex" />;
  if (!receipts.length) return null;
  return (
    <div className="surface hidden min-h-0 flex-1 flex-col overflow-hidden lg:flex">
      <div className="px-4 pb-1 pt-3.5 text-sm font-semibold">Latest results on Clutch</div>
      <div className="min-h-0 flex-1 overflow-hidden p-1.5">
        {receipts.slice(0, 6).map((r) => (
          <ReceiptRow key={r.marketId} r={r} />
        ))}
      </div>
    </div>
  );
}

function ProofPanel() {
  const { data } = useQuery({ queryKey: ["stats"], queryFn: () => api<{ markets: number; volume: number; traders: number; voids: number }>("/stats"), refetchInterval: 15_000 });
  return (
    <div className="surface flex h-full flex-col justify-between overflow-hidden">
      <div className="p-6">
        <ShieldCheckIcon size={26} weight="fill" className="text-info" />
        <h3 className="display mt-4 text-[1.75rem]">Rules first, results second</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Every result is decided by a rule committed onchain before trading opens, and two separate read paths must agree. If they don't, the market voids and stakes are refunded. The streamer can't trade their own markets.
        </p>
      </div>
      <dl className="grid grid-cols-3 border-t border-border">
        {[
          ["Settled", data?.markets ?? 0, false],
          ["Traded", data?.volume ?? 0, true],
          ["Refunded", data?.voids ?? 0, false],
        ].map(([k, v, money]) => (
          <div key={String(k)} className="border-r border-border p-4 last:border-r-0">
            <dt className="text-xs text-faint">{k}</dt>
            <dd className="display mt-1.5 text-[1.9rem] leading-none tabular-nums">{money ? compactUsd(Number(v)) : <NumberFlow value={Number(v)} />}</dd>
          </div>
        ))}
      </dl>
      <Link href="/how-it-works" className="flex items-center justify-between border-t border-border px-5 py-3 text-sm text-muted-foreground hover:text-foreground">
        <span className="flex items-center gap-2">
          <BroadcastIcon size={16} /> How a market works, step by step
        </span>
        <ArrowRightIcon size={14} />
      </Link>
    </div>
  );
}
