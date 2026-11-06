"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRightIcon, CheckCircleIcon, HandTapIcon, ScanIcon, SealCheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useUI } from "@/lib/ui";
import { cn } from "@/lib/utils";

/**
 * The 30-second tour: shown once on a viewer's first visit to the app, and any time from "How it works" in the top
 * bar. Four cards, one idea each, the same words the product uses.
 */

const SEEN = "clutch.tutorial.v1";

const CARDS = [
  {
    icon: ScanIcon,
    tag: "1 · Watch",
    title: "An AI watches the stream",
    body: "It reads the score, the kill feed and every number on screen, and opens a yes-or-no market the moment something is about to happen.",
    demo: (
      <div className="flex flex-wrap gap-2">
        {["Team one score 5", "Team two score 6", "Round 12"].map((t) => (
          <span key={t} className="rounded-full border border-border bg-raised px-3 py-1.5 font-mono text-xs">
            {t}
          </span>
        ))}
      </div>
    ),
  },
  {
    icon: HandTapIcon,
    tag: "2 · Call it",
    title: "Tap Yes or No before it locks",
    body: "Each market lasts 30 to 60 seconds. Pick a stake, tap a side. One tap, no pop-ups. The price moves as people trade.",
    demo: (
      <div className="grid grid-cols-2 gap-2">
        <span className="flex h-12 items-center justify-between rounded-xl bg-yes px-4 font-semibold text-black">
          Yes <span className="font-mono">42¢</span>
        </span>
        <span className="flex h-12 items-center justify-between rounded-xl bg-no px-4 font-semibold text-black">
          No <span className="font-mono">58¢</span>
        </span>
      </div>
    ),
  },
  {
    icon: SealCheckIcon,
    tag: "3 · Get paid",
    title: "Two AIs settle it, and you’re paid",
    body: "A second, different model checks its own frames. If both agree, winnings land in your balance by themselves. If they don’t, everyone is refunded.",
    demo: (
      <div className="flex items-center gap-3 rounded-xl bg-yes-soft px-4 py-3 text-sm font-semibold text-yes">
        <CheckCircleIcon size={20} weight="fill" /> Yes · both readers agreed · +$11.90
      </div>
    ),
  },
  {
    icon: SparkleIcon,
    tag: "4 · Real people",
    title: "Verify once for the good stuff",
    body: "Trading only needs a sign-in. One World ID check gets you free funds every day, a place on the leaderboard and a higher limit.",
    demo: (
      <div className="flex flex-wrap gap-2 text-xs">
        {["Free funds daily", "Leaderboard", "Higher limit"].map((t) => (
          <span key={t} className="rounded-full bg-brand-soft px-3 py-1.5 font-semibold text-brand">
            {t}
          </span>
        ))}
      </div>
    ),
  },
];

export function Tutorial() {
  const { tutorial, setTutorial } = useUI();
  const [i, setI] = useState(0);

  useEffect(() => {
    try {
      if (!localStorage.getItem(SEEN)) setTutorial(true);
    } catch {}
  }, [setTutorial]);
  useEffect(() => {
    if (tutorial) setI(0);
  }, [tutorial]);

  const close = () => {
    try {
      localStorage.setItem(SEEN, "1");
    } catch {}
    setTutorial(false);
  };
  const c = CARDS[i];
  const last = i === CARDS.length - 1;

  return (
    <Dialog open={tutorial} onOpenChange={(o) => !o && close()}>
      <DialogContent className="gap-0 overflow-hidden rounded-[24px] border-border bg-surface p-0 sm:max-w-[460px]">
        <DialogTitle className="sr-only">How Clutch works</DialogTitle>
        <DialogDescription className="sr-only">A four-step tour</DialogDescription>
        <div className="relative overflow-hidden px-7 pb-6 pt-8">
          <div aria-hidden className="absolute -right-20 -top-20 size-56 rounded-full bg-brand/15 blur-3xl" />
          <AnimatePresence mode="wait">
            <motion.div key={i} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }} className="relative">
              <span className="grid size-12 place-items-center rounded-2xl bg-brand-soft text-brand">
                <c.icon size={24} weight="duotone" />
              </span>
              <div className="eyebrow mt-6 text-brand">{c.tag}</div>
              <h2 className="display mt-2 text-[32px] leading-tight">{c.title}</h2>
              <p className="mt-3 text-[15px] leading-relaxed text-muted-foreground">{c.body}</p>
              <div className="mt-6">{c.demo}</div>
            </motion.div>
          </AnimatePresence>
        </div>
        <div className="flex items-center justify-between border-t border-border px-7 py-4">
          <div className="flex gap-1.5" aria-label={`Step ${i + 1} of ${CARDS.length}`}>
            {CARDS.map((_, k) => (
              <button key={k} onClick={() => setI(k)} aria-label={`Step ${k + 1}`} className={cn("h-1.5 rounded-full transition-all", k === i ? "w-6 bg-brand" : "w-1.5 bg-border-strong")} />
            ))}
          </div>
          <div className="flex items-center gap-2">
            {!last && (
              <button onClick={close} className="px-3 text-sm text-faint hover:text-foreground">
                Skip
              </button>
            )}
            <Button onClick={() => (last ? close() : setI(i + 1))} className="h-10 rounded-full bg-foreground px-5 font-medium text-background hover:bg-foreground/90">
              {last ? "Start watching" : "Next"} <ArrowRightIcon weight="bold" />
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
