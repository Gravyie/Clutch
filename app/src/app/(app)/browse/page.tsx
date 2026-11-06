"use client";

import { useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import { Masonry } from "@/components/masonry";
import { ChannelCard, channelCardHeight } from "@/components/stream";
import { MarketCard, isOpen } from "@/components/market";
import { useLive } from "@/lib/live";
import { cn } from "@/lib/utils";
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
    <div className="mx-auto max-w-[1680px] px-4 py-6 sm:px-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="display text-3xl font-bold">Explore</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every channel the AI can read. Live markets first; a channel with no market is still worth a watch.</p>
        </div>
        <label className="flex h-10 w-full items-center gap-2 rounded-xl border border-border bg-raised/60 px-3 text-sm focus-within:border-border-strong sm:w-[280px]">
          <MagnifyingGlassIcon size={16} className="text-faint" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search channel or game" className="w-full bg-transparent outline-none placeholder:text-faint" aria-label="Search channels" />
        </label>
      </div>
      <div className="scrollbar-none mt-5 flex gap-2 overflow-x-auto">
        {FILTERS.map((x) => (
          <button key={x.id} onClick={() => setF(x.id)} className={cn("h-9 shrink-0 rounded-full px-4 text-sm font-medium transition", f === x.id ? "bg-foreground text-background" : "bg-raised text-muted-foreground hover:text-foreground")}>
            {x.label}
            {x.id === "markets" && markets.length > 0 && <span className="ml-1.5 tabular opacity-60">{markets.length}</span>}
          </button>
        ))}
      </div>
      {f === "markets" ? (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {markets.map((m) => (
            <MarketCard key={m.id} m={m} />
          ))}
          {!markets.length && <p className="text-sm text-faint">No markets open this second. They appear as games get tense.</p>}
        </div>
      ) : (
        <>
          <Masonry className="mt-6" items={shown} getKey={(s) => s.slug} estimate={channelCardHeight} render={(s) => <ChannelCard s={s} />} />
          {!shown.length && <p className="mt-6 text-sm text-faint">No channels match. Try another game or clear the search.</p>}
        </>
      )}
    </div>
  );
}
