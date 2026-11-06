import Link from "next/link";
import type { Metadata } from "next";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = { title: "How it works" };

const LIFECYCLE = [
  { t: "A moment", d: "A vision model on 0G reads the live stream every few seconds: the score, the kill feed, players left, any number on the HUD. When something is about to happen, it opens a market of a fixed kind (goes up, reaches, drops below, comes first, survives) on one of those numbers and sets the opening odds. The wording can be natural; the rule it settles on is structured." },
  { t: "Rules locked in", d: "Before anyone can trade, the market's exact rule and timing are fingerprinted onchain. Nobody can change what counts as a win afterwards." },
  { t: "One tap", d: "Back Yes or No. Prices move with demand on a market-maker curve inside a Uniswap v4 hook, so there's always someone to trade with." },
  { t: "A safety gap", d: "Trading closes, then a gap at least as long as the stream's delay passes before anything counts. Nobody can bet on something they've already seen." },
  { t: "Two witnesses", d: "Two independent readers, using different frames over separate connections, must see the same result on screen. Chess uses two separate Lichess feeds. If they disagree, or one can't see it, the market is voided and everyone is refunded." },
  { t: "A receipt", d: "Every result comes with the committed rule, both readers' verdicts and frames, and the 0G request IDs. The evidence bundle is Merkle-hashed with the 0G Storage SDK (and uploaded to 0G Storage when that's enabled), and its root is written onchain with the verdict. Anyone can check it." },
];

const RULES = [
  ["The streamer can't trade", "Their verified human ID is blocked from their own markets by the contract. They're paid on volume, never outcomes."],
  ["One person, one account", "World ID proves you're a unique adult without sharing who you are. Limits and breaks follow the person, not the wallet."],
  ["Nothing one person controls", "Questions a streamer could decide for free (saying a word, ending the stream, castling) are refused before they're listed, and reruns of finished matches never get markets."],
  ["Chain outages can't be exploited", "If the network stalls, trading pauses, and any market that traded through the outage is voided."],
];

export default function HowItWorks() {
  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
      <h1 className="display max-w-[18ch] text-4xl font-bold sm:text-5xl">Fair markets on live moments</h1>
      <p className="mt-4 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">Clutch turns tense moments into short markets that settle in seconds. Here's what happens to every single one.</p>

      <ol className="mt-12 grid gap-px overflow-hidden rounded-2xl border border-border bg-border md:grid-cols-2">
        {LIFECYCLE.map((s, i) => (
          <li key={s.t} className="bg-surface p-6">
            <span className="font-mono text-xs text-yes">{String(i + 1).padStart(2, "0")}</span>
            <h2 className="mt-2 text-lg font-semibold tracking-tight">{s.t}</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{s.d}</p>
          </li>
        ))}
      </ol>

      <h2 className="mt-16 text-2xl font-semibold tracking-tight">The rules that keep it fair</h2>
      <dl className="mt-6 space-y-6">
        {RULES.map(([t, d]) => (
          <div key={t} className="grid gap-1 border-t border-border pt-5 sm:grid-cols-[260px_1fr] sm:gap-8">
            <dt className="font-semibold">{t}</dt>
            <dd className="text-muted-foreground">{d}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-16 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-border bg-surface p-6">
        <div>
          <h2 className="text-lg font-semibold">See it live</h2>
          <p className="text-sm text-muted-foreground">Markets are opening on live streams right now.</p>
        </div>
        <Button asChild className="h-11 rounded-xl px-5 font-semibold">
          <Link href="/browse">Browse channels</Link>
        </Button>
      </div>
    </div>
  );
}
