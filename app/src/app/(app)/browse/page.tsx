"use client";

import { useState } from "react";
import { ChannelCard } from "@/components/stream";
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
  const shown = streams.filter((s) => f === "all" || s.category === f);
  return (
    <div className="mx-auto max-w-[1480px] px-4 py-6 sm:px-6">
      <h1 className="display text-3xl font-bold">Browse</h1>
      <div className="scrollbar-none mt-5 flex gap-2 overflow-x-auto">
        {FILTERS.map((x) => (
          <button key={x.id} onClick={() => setF(x.id)} className={cn("h-9 shrink-0 rounded-full px-4 text-sm font-medium transition", f === x.id ? "bg-foreground text-background" : "bg-raised text-muted-foreground hover:text-foreground")}>
            {x.label}
            {x.id === "markets" && markets.length > 0 && <span className="ml-1.5 tabular opacity-60">{markets.length}</span>}
          </button>
        ))}
      </div>
      {f === "markets" ? (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {markets.map((m) => (
            <MarketCard key={m.id} m={m} />
          ))}
          {!markets.length && <p className="text-sm text-faint">No markets open this second. They appear as games get tense.</p>}
        </div>
      ) : (
        <div className="mt-6 grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
          {shown.map((s) => (
            <ChannelCard key={s.slug} s={s} />
          ))}
          {!shown.length && <p className="text-sm text-faint">No channels here yet.</p>}
        </div>
      )}
    </div>
  );
}
