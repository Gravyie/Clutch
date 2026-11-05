"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ArrowRightIcon, BroadcastIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { Button } from "@/components/ui/button";
import { ChannelCard, StreamStage } from "@/components/stream";
import { MarketCard, MarketPanel, ReceiptRow, isOpen } from "@/components/market";
import { useAccount } from "@/lib/account";
import { api, useChannel, useLive } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { compactUsd } from "@/lib/format";

export default function Home() {
  const streams = useLive((s) => s.streams);
  const markets = useLive((s) => s.markets);
  const receipts = useLive((s) => s.receipts);
  const list = Object.values(streams);
  const liveMarkets = Object.values(markets)
    .filter(isOpen)
    .sort((a, b) => (a.phase === "trading" ? 0 : 1) - (b.phase === "trading" ? 0 : 1) || b.volume - a.volume);
  const featured =
    list.find((s) => s.market?.phase === "trading" && s.live) ?? list.filter((s) => s.live).sort((a, b) => b.watching - a.watching)[0] ?? list[0];

  return (
    <div className="mx-auto max-w-[1480px] space-y-12 px-4 py-6 sm:px-6">
      <Intro />
      {featured ? <Featured slug={featured.slug} /> : <div className="shimmer h-[520px] rounded-2xl bg-surface" />}

      <section>
        <SectionHead title="Live markets" href="/browse" />
        {liveMarkets.length ? (
          <div className="scrollbar-none -mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2 sm:-mx-6 sm:px-6">
            {liveMarkets.map((m) => (
              <div key={m.id} className="w-[300px] shrink-0 snap-start">
                <MarketCard m={m} />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-faint">Markets open as moments happen. Pick a channel and watch.</p>
        )}
      </section>

      <section>
        <SectionHead title="Channels" href="/browse" />
        <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
          {list.map((s) => (
            <ChannelCard key={s.slug} s={s} />
          ))}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div>
          <SectionHead title="Just settled" />
          <div className="surface p-1.5">
            {receipts.length ? receipts.slice(0, 7).map((r) => <ReceiptRow key={r.marketId} r={r} />) : <p className="px-3 py-6 text-center text-sm text-faint">Results appear here as markets settle.</p>}
          </div>
        </div>
        <ProofPanel />
      </section>
    </div>
  );
}

function Intro() {
  const acct = useAccount();
  const open = useUI((s) => s.openOnboarding);
  if (acct.onboarded) return null;
  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5 pt-2 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-4xl font-semibold tracking-tighter sm:text-5xl">Every moment is a market.</h1>
        <p className="mt-3 max-w-[56ch] text-base leading-relaxed text-muted-foreground">
          Trade on what happens next in the stream. Markets open when the game gets tense and settle in seconds, with a public receipt.
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="lg" className="h-11 rounded-xl px-5 font-semibold" onClick={open}>
          Start trading
        </Button>
        <Button size="lg" variant="secondary" className="h-11 rounded-xl px-5 font-semibold" asChild>
          <Link href="/how-it-works">How it works</Link>
        </Button>
      </div>
    </motion.section>
  );
}

function Featured({ slug }: { slug: string }) {
  useChannel(`stream:${slug}`);
  const stream = useLive((s) => s.streamStates[slug]);
  const summary = useLive((s) => s.streams[slug]);
  const market = useLive((s) => (summary?.market ? s.markets[summary.market.id] : undefined));
  const { data } = useQuery({ queryKey: ["stream", slug], queryFn: () => api<{ pool: { key: any } }>(`/streams/${slug}`), staleTime: 60_000 });
  return (
    <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
      <Link href={`/c/${slug}`} className="block min-w-0">
        <StreamStage stream={stream} compact />
      </Link>
      <div className="space-y-3">
        <Link href={`/c/${slug}`} className="flex items-center justify-between rounded-xl px-1 text-sm">
          <span className="font-semibold">{summary?.title}</span>
          <span className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
            Open channel <ArrowRightIcon size={14} />
          </span>
        </Link>
        <MarketPanel m={market && isOpen(market) ? market : undefined} pool={data?.pool.key} />
      </div>
    </section>
  );
}

function SectionHead({ title, href }: { title: string; href?: string }) {
  return (
    <div className="mb-4 flex items-center justify-between">
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      {href && (
        <Link href={href} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          See all <ArrowRightIcon size={14} />
        </Link>
      )}
    </div>
  );
}

function ProofPanel() {
  const { data } = useQuery({ queryKey: ["stats"], queryFn: () => api<{ markets: number; volume: number; traders: number; voids: number }>("/stats"), refetchInterval: 15_000 });
  return (
    <div className="surface flex flex-col justify-between overflow-hidden">
      <div className="p-5">
        <ShieldCheckIcon size={28} weight="fill" className="text-yes" />
        <h3 className="mt-3 text-lg font-semibold tracking-tight">Nobody decides who wins</h3>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          Two independent sources must agree on every result. If they don't, the market voids and everyone gets their money back. The streamer can't trade their own markets.
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
            <dd className="mt-1 text-xl font-semibold tabular">{money ? compactUsd(Number(v)) : <NumberFlow value={Number(v)} />}</dd>
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
