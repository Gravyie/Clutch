"use client";

import { useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Masonry } from "@/components/masonry";
import { ChannelCard, channelCardHeight } from "@/components/stream";
import { MarketCard, isOpen } from "@/components/market";
import { useLive } from "@/lib/live";
import { LiveDot, PageHeader, PageShell, Segmented } from "@/components/page";
import { channelRank } from "@/components/shell";

const FILTERS = [
  { id: "all", label: "All" },
  { id: "markets", label: "Live markets" },
  { id: "fps", label: "Shooters" },
  { id: "battle-royale", label: "Battle royale" },
  { id: "moba", label: "MOBA" },
  { id: "sports", label: "Sports" },
  { id: "chess", label: "Chess" },
  { id: "irl", label: "IRL" },
] as const;

export default function Browse() {
  const [f, setF] = useState<(typeof FILTERS)[number]["id"]>("all");
  const streams = Object.values(useLive((s) => s.streams)).sort(channelRank);
  const markets = Object.values(useLive((s) => s.markets)).filter(isOpen);
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const shown = streams.filter((s) => (f === "all" || s.category === f) && (!needle || `${s.title} ${s.game ?? ""} ${s.streamTitle ?? ""} ${s.subtitle}`.toLowerCase().includes(needle)));
  return (
    <PageShell wide>
      <PageHeader
        eyebrow={
          <>
            <LiveDot /> <span className="tabular-nums">{streams.filter((x) => x.live).length}</span> channels live right now
          </>
        }
        title="Explore"
        description="Every channel the AI can read. Live markets come first, and a channel with no market is still worth a watch."
        actions={
          <label className="flex h-11 w-full items-center gap-2.5 rounded-full bg-card px-4 text-[14px] shadow-[var(--shadow-card)] ring-1 ring-border transition focus-within:ring-border-strong sm:w-[300px]">
            <MagnifyingGlassIcon size={16} className="shrink-0 text-faint" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channel or game" className="w-full bg-transparent outline-none placeholder:text-faint" aria-label="Search channels" />
          </label>
        }
      />
      <Segmented
        label="Filter channels"
        value={f}
        onChange={setF}
        options={FILTERS.map((x) => ({ value: x.id, label: x.label, count: x.id === "markets" ? markets.length : undefined }))}
        className="mb-8"
      />
      {f === "markets" ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {markets.map((m) => (
            <MarketCard key={m.id} m={m} />
          ))}
          {!markets.length && <p className="text-sm text-faint">No markets open this second. They appear as games get tense.</p>}
        </div>
      ) : (
        <>
          <Masonry items={shown} getKey={(s) => s.slug} estimate={channelCardHeight} render={(s) => <ChannelCard s={s} />} />
          {!shown.length && <p className="text-sm text-faint">No channels match. Try another game or clear the search.</p>}
        </>
      )}
    </PageShell>
  );
}
