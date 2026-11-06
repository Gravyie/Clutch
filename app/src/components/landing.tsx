"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import NumberFlow from "@number-flow/react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ArrowCounterClockwiseIcon,
  BroadcastIcon,
  CheckCircleIcon,
  CodeIcon,
  CubeIcon,
  EyeIcon,
  FingerprintIcon,
  HandTapIcon,
  ProhibitIcon,
  ScanIcon,
  SealCheckIcon,
  SparkleIcon,
  XCircleIcon,
} from "@phosphor-icons/react";
import type { AgentState, ChainState, MarketView, Receipt, StreamSummary } from "@clutch/shared";
import { Logo } from "@/components/brand";
import { channelRank } from "@/components/shell";
import { frameUrl } from "@/components/stream";
import { isOpen } from "@/components/market";
import { api, useLive, useNow } from "@/lib/live";
import { REPO } from "@/lib/env";
import { compact, compactUsd, short } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The public front door. Every number and card on it is live engine state (streams being read right now, the open
 * market, the last receipt, 0G spend, the Blackout Guard fee); nothing is mocked. When the engine is unreachable
 * the cards show skeletons rather than invented data.
 */

type Stats = { markets: number; volume: number; traders: number; voids: number; agent: AgentState; chain: ChainState };

const ease = [0.2, 0.8, 0.2, 1] as const;
const reveal = { initial: { opacity: 0, y: 24 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: "-80px" }, transition: { duration: 0.7, ease } };

const twitchPreview = (s: StreamSummary) => (s.media?.kind === "video" && s.media.platform === "twitch" ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.media.channel}-1280x720.jpg` : undefined);
const preview = (s: StreamSummary) => frameUrl(s) ?? twitchPreview(s);

/** The engine's last frame, falling back to the platform's own live thumbnail if the frame isn't there. */
function StreamImage({ s, alt = "", className }: { s: StreamSummary; alt?: string; className?: string }) {
  const [failed, setFailed] = useState<string | undefined>();
  const first = preview(s);
  const src = failed === first ? twitchPreview(s) : first;
  if (!src) return <div className={cn("shimmer bg-raised", className)} />;
  return <img key={src} src={src} alt={alt} onError={() => setFailed(src)} className={className} />;
}

function useLanding() {
  const streams = useLive((s) => s.streams);
  const markets = useLive((s) => s.markets);
  const receipts = useLive((s) => s.receipts);
  const agentLive = useLive((s) => s.agent);
  const { data: stats } = useQuery({ queryKey: ["stats"], queryFn: () => api<Stats>("/stats"), refetchInterval: 10_000 });
  const list = Object.values(streams).sort(channelRank);
  const video = list.filter((s) => s.media?.kind === "video" && s.live && !s.rerun);
  const featured = video.find((s) => s.market?.phase === "trading") ?? video.find((s) => s.reading && s.frameAt) ?? video[0];
  const open = Object.values(markets).filter(isOpen);
  // The hero card always belongs to the stream on screen; never a chess market over a Fortnite frame.
  const market = open.find((m) => m.slug === featured?.slug);
  const visionReceipt = receipts.find((r) => r.rule.adapter === "vision" && r.verdict !== "VOID") ?? receipts.find((r) => r.verdict !== "VOID");
  return { list, video, featured, market, receipts, visionReceipt, stats, agent: agentLive ?? stats?.agent, reading: list.filter((s) => s.reading).length };
}

export function Landing() {
  const d = useLanding();
  return (
    <div className="relative min-h-dvh overflow-x-clip bg-background text-foreground">
      <SiteNav />
      <Hero d={d} />
      <Ticker receipts={d.receipts} />
      <HowItWorks r={d.visionReceipt} />
      <Pillars d={d} />
      <Streamers featured={d.video.find((s) => s.slug === d.market?.slug) ?? d.featured} />
      <Faq />
      <Closing count={d.video.length} />
      <Footer />
    </div>
  );
}

/* ───────────────────────────────── nav ───────────────────────────────── */

function SiteNav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto mt-3 flex h-14 max-w-[1240px] items-center gap-6 rounded-full border border-border bg-background/70 pl-5 pr-2 backdrop-blur-xl max-[1272px]:mx-4">
        <Link href="/" aria-label="Clutch">
          <Logo />
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#how" className="transition hover:text-foreground">How it works</a>
          <a href="#stack" className="transition hover:text-foreground">Under the hood</a>
          <a href="#streamers" className="transition hover:text-foreground">Streamers</a>
          <a href="#faq" className="transition hover:text-foreground">FAQ</a>
        </nav>
        <Link
          href="/live"
          className="ml-auto inline-flex h-10 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-brand-foreground transition hover:brightness-110 active:scale-[0.98]"
        >
          Open app <ArrowRightIcon size={15} weight="bold" />
        </Link>
      </div>
    </header>
  );
}

/* ───────────────────────────────── hero ──────────────────────────────── */

function Hero({ d }: { d: ReturnType<typeof useLanding> }) {
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const onMove = (e: React.PointerEvent) => {
    if (reduce || e.pointerType !== "mouse" || !ref.current) return;
    const b = ref.current.getBoundingClientRect();
    mx.set((e.clientX - b.left) / b.width - 0.5);
    my.set((e.clientY - b.top) / b.height - 0.5);
  };
  const st = d.stats;
  return (
    <section ref={ref} onPointerMove={onMove} className="relative isolate min-h-[100dvh] pt-28 pb-16">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="bg-dots mask-fade-b absolute inset-0 opacity-60" />
        <div className="absolute -top-40 right-[-10%] size-[720px] rounded-full bg-brand/20 blur-[140px]" />
        <div className="absolute bottom-0 left-[-15%] size-[520px] rounded-full bg-yes/10 blur-[140px]" />
      </div>

      <div className="mx-auto grid max-w-[1240px] items-center gap-14 px-4 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-10">
        <div>
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }} className="inline-flex items-center gap-2 rounded-full border border-border bg-surface/70 py-1 pl-1.5 pr-3 text-xs text-muted-foreground backdrop-blur">
            <span className="flex items-center gap-1.5 rounded-full bg-live/15 px-2 py-0.5 font-mono text-[10.5px] font-semibold tracking-wider text-live">
              <span className="size-1.5 animate-live rounded-full bg-live" /> LIVE
            </span>
            {d.reading ? (
              <span>
                AI is watching <span className="font-medium text-foreground tabular">{d.reading}</span> stream{d.reading === 1 ? "" : "s"} right now
              </span>
            ) : (
              <span>Connecting to the live engine…</span>
            )}
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease, delay: 0.05 }}
            className="display mt-6 text-[clamp(2.9rem,5.5vw,5.4rem)] font-bold leading-[0.95]"
          >
            Every moment
            <br />
            is a <span className="text-brand">market.</span>
          </motion.h1>
          <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.15 }} className="mt-6 max-w-[46ch] text-lg leading-relaxed text-muted-foreground">
            An AI watches live streams and opens a yes-or-no market the moment something is about to happen. You call it with one tap.
            Two independent readers settle it in seconds, and every result gets a public receipt.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease, delay: 0.25 }} className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href={d.featured ? `/c/${d.featured.slug}` : "/live"}
              className="group inline-flex h-13 items-center gap-2.5 rounded-full bg-brand pl-6 pr-2 text-[15px] font-semibold text-brand-foreground shadow-[0_10px_40px_-10px_var(--brand)] transition hover:brightness-110 active:scale-[0.98]"
            >
              Watch live
              <span className="grid size-9 place-items-center rounded-full bg-black/15 transition group-hover:translate-x-0.5">
                <ArrowRightIcon size={16} weight="bold" />
              </span>
            </Link>
            <a href="#how" className="inline-flex h-13 items-center rounded-full border border-border-strong px-6 text-[15px] font-medium transition hover:bg-raised">
              How it settles
            </a>
          </motion.div>

          <motion.dl initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8, delay: 0.4 }} className="mt-12 grid max-w-[520px] grid-cols-3 divide-x divide-border border-y border-border">
            <Stat label="Markets settled" value={st ? <NumberFlow value={st.markets} /> : null} />
            <Stat label="Refunded, not guessed" value={st ? <NumberFlow value={st.voids} /> : null} />
            <Stat label="Live streams" value={d.list.length ? <NumberFlow value={d.video.length} /> : null} />
          </motion.dl>
        </div>

        <motion.div initial={{ opacity: 0, scale: 0.94 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 1.1, ease, delay: 0.1 }}>
          <Stage d={d} mx={mx} my={my} />
        </motion.div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="px-4 py-4 first:pl-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-1 font-mono text-xl font-medium tabular">{value ?? <span className="shimmer inline-block h-6 w-14 rounded bg-raised" />}</dd>
    </div>
  );
}

/** The 3D stage: the real frame the AI last read, with the live market and the latest receipt floating in front of it. */
function Stage({ d, mx, my }: { d: ReturnType<typeof useLanding>; mx: ReturnType<typeof useMotionValue<number>>; my: ReturnType<typeof useMotionValue<number>> }) {
  const spring = { stiffness: 90, damping: 18, mass: 0.6 };
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-24, -8]), spring);
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [12, 2]), spring);
  const s = d.featured;
  const counters = s?.vision?.state.counters?.slice(0, 3) ?? [];
  return (
    <div className="relative mx-auto w-full max-w-[680px] [perspective:1800px]">
      <motion.div style={{ rotateY, rotateX, transformStyle: "preserve-3d" }} initial={{ rotateY: -16, rotateX: 7 }} className="relative aspect-[16/11] w-full">
        {/* back plate */}
        <div aria-hidden className="absolute inset-[6%] rounded-[28px] bg-brand/25 blur-3xl" style={{ transform: "translateZ(-160px)" }} />

        {/* broadcast */}
        <div className="grain absolute inset-x-0 top-0 aspect-video overflow-hidden rounded-[22px] border border-white/10 bg-sunk shadow-float" style={{ transform: "translateZ(0)" }}>
          {s ? <StreamImage s={s} alt={`What the AI is reading on ${s.title}`} className="absolute inset-0 size-full object-cover" /> : <div className="shimmer absolute inset-0 bg-raised" />}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30" />
          <div className="absolute inset-x-0 top-0 h-16 animate-scan bg-gradient-to-b from-transparent via-brand/25 to-transparent" />
          <div className="absolute left-4 top-4 flex items-center gap-2">
            <span className="rounded-[5px] bg-live px-1.5 py-px text-[10.5px] font-semibold tracking-wide text-white">LIVE</span>
            {s && <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">{s.title}{s.game ? ` · ${s.game}` : ""}</span>}
          </div>
          {s?.platformViewers ? <span className="absolute right-4 top-4 rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-white/80 backdrop-blur">{compact(s.platformViewers)} watching</span> : null}
          <div className="absolute inset-x-4 bottom-4 flex flex-wrap items-end justify-end gap-2 pl-[40%]">
            <span className="flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              <ScanIcon size={13} className="text-brand" weight="bold" />
              {s?.vision ? `0G · ${s.vision.reader.replace(/^0g:/, "")} · ${(s.vision.ms / 1000).toFixed(1)}s` : "0G vision"}
            </span>
            {counters.map((c) => (
              <span key={c.key} className="rounded-full border border-white/15 bg-black/50 px-2.5 py-1 font-mono text-[11px] text-white backdrop-blur">
                {c.label} <b className="text-brand">{c.value}</b>
              </span>
            ))}
          </div>
        </div>

        {/* live market */}
        <div className="absolute -bottom-3 -left-6 w-[58%] min-w-[250px] max-sm:-left-1" style={{ transform: "translateZ(110px)" }}>
          <HeroMarket m={d.market} s={d.featured} />
        </div>

        {/* latest receipt */}
        <div className="absolute -right-8 -top-10 w-[42%] min-w-[210px] max-sm:-right-1 max-sm:-top-6" style={{ transform: "translateZ(170px)" }}>
          <HeroReceipt r={d.visionReceipt ?? d.receipts[0]} />
        </div>
      </motion.div>
    </div>
  );
}

function HeroMarket({ m, s }: { m?: MarketView; s?: StreamSummary }) {
  const now = useNow(250);
  if (!m)
    return (
      <Link href={s ? `/c/${s.slug}` : "/live"} className="block rounded-[18px] border border-border-strong bg-surface/90 p-4 shadow-float backdrop-blur-xl transition hover:border-brand/50">
        <div className="flex items-center justify-between">
          <span className="eyebrow">AI is reading</span>
          {s?.vision && <span className="font-mono text-[11px] text-faint">{s.vision.state.mode}</span>}
        </div>
        <div className="mt-2 line-clamp-2 text-sm leading-snug text-muted-foreground">
          {s?.vision?.state.summary ?? "Waiting for the next frame…"}
        </div>
        <div className="mt-3 flex h-10 items-center justify-center gap-2 rounded-xl bg-raised text-xs font-medium text-muted-foreground">
          <span className="size-1.5 animate-live rounded-full bg-brand" /> Next market opens when a moment builds
        </div>
      </Link>
    );
  const left = Math.max(0, m.lockTime - now);
  const total = Math.max(1, m.lockTime - m.openedAt);
  return (
    <Link href={`/c/${m.slug}`} className="block rounded-[18px] border border-border-strong bg-surface/90 p-4 shadow-float backdrop-blur-xl transition hover:border-brand/50">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-live">
          <span className="size-1.5 animate-live rounded-full bg-live" /> LIVE MARKET
        </span>
        <span className="font-mono text-[11px] text-faint tabular">{m.phase === "trading" ? `${Math.ceil(left)}s to call it` : m.phase}</span>
      </div>
      <div className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug">{m.question}</div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <span className="flex h-10 items-center justify-between rounded-xl bg-yes px-3 text-sm font-semibold text-black">
          Yes <span className="font-mono">{Math.round(m.priceYes * 100)}¢</span>
        </span>
        <span className="flex h-10 items-center justify-between rounded-xl bg-no px-3 text-sm font-semibold text-black">
          No <span className="font-mono">{100 - Math.round(m.priceYes * 100)}¢</span>
        </span>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-brand transition-[width] duration-300 ease-linear" style={{ width: `${m.phase === "trading" ? (left / total) * 100 : 0}%` }} />
      </div>
    </Link>
  );
}

function Verdict({ v, className }: { v: Receipt["verdict"]; className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-1.5 py-0.5 font-mono text-[10.5px] font-semibold",
        v === "YES" ? "bg-yes-soft text-yes" : v === "NO" ? "bg-no-soft text-no" : "bg-void-soft text-void",
        className,
      )}
    >
      {v}
    </span>
  );
}

function HeroReceipt({ r }: { r?: Receipt }) {
  if (!r)
    return (
      <div className="rounded-[18px] border border-border-strong bg-surface/90 p-4 shadow-float backdrop-blur-xl">
        <div className="eyebrow">Receipt</div>
        <div className="shimmer mt-3 h-16 rounded-xl bg-raised" />
      </div>
    );
  return (
    <Link href={`/m/${r.marketId}`} className="block rounded-[18px] border border-border-strong bg-surface/90 p-4 shadow-float backdrop-blur-xl transition hover:border-brand/50">
      <div className="flex items-center justify-between">
        <span className="eyebrow">Receipt #{r.marketId}</span>
        <Verdict v={r.verdict} />
      </div>
      <div className="mt-2 line-clamp-2 text-[13px] font-medium leading-snug">{r.question}</div>
      <ul className="mt-3 space-y-1.5">
        {r.readings.map((x, i) => (
          <li key={i} className="flex items-center gap-2 text-[11px] text-muted-foreground">
            {x.evaluation === r.verdict ? <CheckCircleIcon size={13} weight="fill" className="text-yes" /> : <XCircleIcon size={13} weight="fill" className="text-void" />}
            <span className="truncate">{x.source.replace(/^0g:/, "0G · ")}</span>
            <span className="ml-auto font-mono">{x.evaluation}</span>
          </li>
        ))}
      </ul>
      <div className="mt-3 truncate border-t border-border pt-2 font-mono text-[10px] text-faint">rule {short(r.ruleHash, 10)}</div>
    </Link>
  );
}

/* ──────────────────────────────── ticker ─────────────────────────────── */

function Ticker({ receipts }: { receipts: Receipt[] }) {
  const items = receipts.slice(0, 18);
  if (!items.length) return <div className="h-14 border-y border-border" />;
  return (
    <div className="mask-fade-x overflow-hidden border-y border-border bg-surface/40 py-3.5">
      <div className="flex w-max animate-marquee gap-10 pr-10 hover:[animation-play-state:paused]">
        {[...items, ...items].map((r, i) => (
          <Link key={i} href={`/m/${r.marketId}`} className="flex shrink-0 items-center gap-2.5 text-sm text-muted-foreground transition hover:text-foreground" aria-hidden={i >= items.length}>
            <Verdict v={r.verdict} />
            <span className="max-w-[360px] truncate">{r.question}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

/* ───────────────────────────── how it works ──────────────────────────── */

function SectionHead({ eyebrow, title, body, id }: { eyebrow: string; title: React.ReactNode; body?: string; id?: string }) {
  return (
    <motion.div {...reveal} id={id} className="max-w-[760px] scroll-mt-28">
      <div className="eyebrow text-brand">{eyebrow}</div>
      <h2 className="display mt-4 text-[clamp(2.2rem,4.6vw,3.8rem)] font-bold leading-[1]">{title}</h2>
      {body && <p className="mt-5 max-w-[60ch] text-lg leading-relaxed text-muted-foreground">{body}</p>}
    </motion.div>
  );
}

function HowItWorks({ r }: { r?: Receipt }) {
  const steps = [
    {
      icon: EyeIcon,
      title: "The AI watches",
      body: "A vision model on 0G reads the live frame every few seconds: the score, the kill feed, players left, whatever numbers are on screen.",
      proof: r?.ai.model ? `${r.ai.provider === "0g" ? "0G" : "local"} · ${r.ai.model}` : undefined,
    },
    {
      icon: SparkleIcon,
      title: "It opens a market",
      body: "When a moment is building it writes one question and a machine-checkable rule, and commits the rule's hash onchain before anyone can trade.",
      proof: r ? `rule ${short(r.ruleHash, 10)}` : undefined,
    },
    {
      icon: HandTapIcon,
      title: "You call it",
      body: "One tap on Yes or No. Prices move with every trade, and trading locks a few seconds before the window so nobody trades on what they've already seen.",
      proof: "Uniswap v4 · ClutchHook",
    },
    {
      icon: SealCheckIcon,
      title: "Two readers settle it",
      body: "A second, different model reads its own frames. If both agree, winners are paid. If they disagree, or a frame is missing, everyone is refunded.",
      proof: r ? `${r.verdict} · ${r.readings.map((x) => x.evaluation).join(" / ")}` : undefined,
    },
  ];
  return (
    <section className="mx-auto max-w-[1240px] px-4 py-28 sm:px-6 sm:py-36">
      <SectionHead
        id="how"
        eyebrow="How it works"
        title={
          <>
            From a frame to a payout
            <br className="max-sm:hidden" /> in about a minute.
          </>
        }
      />
      <ol className="mt-16 grid gap-px overflow-hidden rounded-[22px] border border-border bg-border md:grid-cols-2 lg:grid-cols-4">
        {steps.map((s, i) => (
          <motion.li key={s.title} {...reveal} transition={{ ...reveal.transition, delay: i * 0.08 }} className="flex flex-col bg-background p-7">
            <div className="flex items-center justify-between">
              <span className="grid size-11 place-items-center rounded-2xl bg-raised text-brand">
                <s.icon size={22} weight="duotone" />
              </span>
              <span className="font-mono text-xs text-faint">0{i + 1}</span>
            </div>
            <h3 className="mt-10 text-xl font-semibold tracking-tight">{s.title}</h3>
            <p className="mt-2.5 text-[15px] leading-relaxed text-muted-foreground">{s.body}</p>
            <div className="mt-auto pt-8">
              {s.proof ? (
                <span className="inline-flex max-w-full items-center gap-1.5 truncate rounded-full border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground">
                  <span className="size-1.5 shrink-0 rounded-full bg-yes" />
                  <span className="truncate">{s.proof}</span>
                </span>
              ) : (
                <span className="shimmer inline-block h-6 w-32 rounded-full bg-raised" />
              )}
            </div>
          </motion.li>
        ))}
      </ol>
      {r && (
        <motion.div {...reveal} className="mt-6 flex flex-col gap-4 rounded-[22px] border border-border bg-surface p-6 md:flex-row md:items-center">
          <div className="eyebrow shrink-0">Latest real receipt</div>
          <p className="min-w-0 flex-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">{r.question}</span> <span className="text-faint">{r.rule.resolution}</span>
          </p>
          <Link href={`/m/${r.marketId}`} className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            Open receipt <ArrowUpRightIcon size={14} />
          </Link>
        </motion.div>
      )}
    </section>
  );
}

/* ──────────────────────────── the three pillars ──────────────────────── */

function Pillars({ d }: { d: ReturnType<typeof useLanding> }) {
  const chain = d.stats?.chain;
  const agent = d.agent;
  const feePct = chain ? chain.blackoutFeePips / 10_000 : undefined;
  return (
    <section className="border-t border-border bg-surface/30">
      <div className="mx-auto max-w-[1240px] px-4 py-28 sm:px-6 sm:py-36">
        <SectionHead
          id="stack"
          eyebrow="Under the hood"
          title="Three things have to be true for this to be fair."
          body="The AI has to actually see the stream, the market has to be a real market, and one person can't pretend to be many. Each one runs on infrastructure built for it."
        />

        <div className="mt-16 grid gap-4 lg:grid-cols-6">
          {/* 0G */}
          <Pillar
            className="lg:col-span-6"
            wide
            tag="0G Private Computer"
            icon={<CubeIcon size={20} weight="duotone" />}
            title="The AI is the market maker."
            body="Reader A (claude-haiku-5.5) watches the stream and proposes markets. Reader B (0gm-1.0) is a different model that settles them from its own frames. Both run on 0G, every call has a request ID on the receipt, and viewers can spend their own 0G credits to call a market on demand."
            breaks="Without 0G no market ever opens, and none can settle."
            code={`${REPO}/blob/main/engine/src/video/perceive.ts`}
          >
            <div className="grid gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
              <Metric label="Inference calls today" value={agent ? <NumberFlow value={agent.requestsToday} /> : undefined} />
              <Metric label="Spent today" value={agent ? <NumberFlow value={agent.spentTodayUsd} format={{ style: "currency", currency: "USD", maximumFractionDigits: 4 }} /> : undefined} />
              <Metric label="Hard daily cap" value={agent ? `$${agent.capTodayUsd.toFixed(2)}` : undefined} />
              <Metric label="Mode" value={agent ? <span className={agent.mode === "full" ? "text-yes" : "text-warn"}>{agent.mode === "full" ? "Live" : agent.mode}</span> : undefined} />
            </div>
            <div className="mt-3 truncate rounded-xl bg-sunk px-3 py-2.5 font-mono text-[11.5px] text-muted-foreground">
              <span className="text-faint">last request</span> {agent?.lastRequestId ?? "…"}
            </div>
          </Pillar>

          {/* Uniswap */}
          <Pillar
            className="lg:col-span-4"
            tag="Uniswap v4"
            icon={<CodeIcon size={20} weight="duotone" />}
            title="Every market is a v4 pool."
            body="ClutchHook replaces the AMM curve with an LMSR in beforeSwap, so odds always exist even with no one on the other side. Liquidity comes from a public vault. Blackout Guard, our sequencer-aware fee hook, pauses trading during an L2 outage and voids any market it overlapped."
            breaks="Without the hook there is no price, no pool, and no payout."
            code={`${REPO}/blob/main/contracts/src/clutch/ClutchHook.sol#L376`}
          >
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-border bg-border sm:grid-cols-4">
              <Metric
                label="Sequencer"
                value={chain ? <span className={chain.sequencerPhase === "Normal" ? "text-yes" : "text-warn"}>{chain.sequencerPhase}</span> : undefined}
              />
              <Metric label="Blackout fee" value={feePct !== undefined ? `${feePct.toFixed(2)}%` : undefined} />
              <Metric label="Vault liquidity" value={chain ? compactUsd(chain.vault.totalAssets) : undefined} />
              <Metric label="Markets funded" value={chain ? <NumberFlow value={chain.vault.marketsFunded} /> : undefined} />
            </div>
          </Pillar>

          {/* World */}
          <Pillar
            className="lg:col-span-2"
            tag="World ID"
            icon={<FingerprintIcon size={20} weight="duotone" />}
            title="One person, one limit."
            body="One Proof of Human check gives you a pass that the contract checks on every trade. Your daily cap follows you, not your wallet, and streamers can't trade their own markets."
            breaks="Without it, a second wallet resets every limit."
            code={`${REPO}/blob/main/contracts/src/clutch/HumanPassGate.sol#L117`}
          >
            <ul className="space-y-2 text-sm">
              {["Daily cap per human", "Self-exclusion that sticks", "Streamer can't bet on themselves"].map((t) => (
                <li key={t} className="flex items-center gap-2 text-muted-foreground">
                  <CheckCircleIcon size={16} weight="fill" className="text-yes" /> {t}
                </li>
              ))}
            </ul>
          </Pillar>
        </div>

        <motion.div {...reveal} className="mt-4 grid gap-4 md:grid-cols-3">
          {[
            { icon: ArrowCounterClockwiseIcon, t: "Refund, never guess", b: "If the two readers disagree, the market voids and every stake is returned in full, fees included." },
            { icon: ProhibitIcon, t: "No trading on the past", b: "Trading locks before the window opens, with a buffer for stream delay. Reruns never get markets." },
            { icon: SealCheckIcon, t: "Rules before money", b: "The rule's hash is onchain before the first trade. Anyone can recompute the verdict from the evidence." },
          ].map(({ icon: Icon, t, b }) => (
            <div key={t} className="rounded-[22px] border border-border p-6">
              <Icon size={22} className="text-brand" weight="duotone" />
              <div className="mt-4 font-semibold">{t}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{b}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

function Pillar({ className, wide, tag, icon, title, body, breaks, code, children }: { className?: string; wide?: boolean; tag: string; icon: React.ReactNode; title: string; body: string; breaks: string; code: string; children: React.ReactNode }) {
  return (
    <motion.article {...reveal} className={cn("flex flex-col rounded-[22px] border border-border bg-background p-7 sm:p-8", className)}>
      <div className="flex items-center justify-between">
        <span className="inline-flex items-center gap-2 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand">
          {icon} {tag}
        </span>
        <a href={code} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-faint transition hover:text-foreground">
          Code <ArrowUpRightIcon size={12} />
        </a>
      </div>
      <div className={cn("mt-6 grid flex-1 gap-8", wide ? "lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:items-end" : "content-between")}>
        <div>
          <h3 className="display text-[1.9rem] font-bold leading-[1.05]">{title}</h3>
          <p className="mt-3 max-w-[58ch] text-[15px] leading-relaxed text-muted-foreground">{body}</p>
          <p className="mt-4 text-sm font-medium text-foreground/80">{breaks}</p>
        </div>
        <div>{children}</div>
      </div>
    </motion.article>
  );
}

function Metric({ label, value }: { label: string; value?: React.ReactNode }) {
  return (
    <div className="bg-surface p-4">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="mt-1 font-mono text-lg font-medium tabular">{value ?? <span className="shimmer inline-block h-6 w-12 rounded bg-raised" />}</div>
    </div>
  );
}

/* ─────────────────────────────── streamers ───────────────────────────── */

function Streamers({ featured }: { featured?: StreamSummary }) {
  return (
    <section id="streamers" className="mx-auto grid max-w-[1240px] scroll-mt-24 items-center gap-14 px-4 py-28 sm:px-6 sm:py-36 lg:grid-cols-2">
      <div>
        <SectionHead eyebrow="For streamers" title="Your chat, now with stakes." />
        <motion.ul {...reveal} className="mt-8 space-y-5">
          {[
            ["Claim in one minute", "Put a code in your stream title. That proves the channel is yours, with no OAuth and no extension."],
            ["Drop in an OBS overlay", "One browser source shows the live market and the result on stream, so chat plays along."],
            ["Stay in control", "Veto any market or pause them all. You can never trade your own markets, and the contract enforces it."],
          ].map(([t, b]) => (
            <li key={t} className="flex gap-4">
              <CheckCircleIcon size={22} weight="fill" className="mt-0.5 shrink-0 text-brand" />
              <div>
                <div className="font-semibold">{t}</div>
                <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{b}</p>
              </div>
            </li>
          ))}
        </motion.ul>
        <motion.div {...reveal} className="mt-10">
          <Link href="/studio" className="inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-6 text-[15px] font-semibold text-background transition hover:opacity-90 active:scale-[0.98]">
            <BroadcastIcon size={18} weight="fill" /> Open creator studio
          </Link>
        </motion.div>
      </div>
      <motion.div {...reveal} className="relative">
        <div className="grain relative aspect-video overflow-hidden rounded-[22px] border border-border bg-sunk shadow-float">
          {featured && <StreamImage s={featured} className="absolute inset-0 size-full object-cover" />}
          {featured && <ScaledOverlay slug={featured.slug} />}
        </div>
        <div className="mt-3 flex items-center justify-between font-mono text-[11px] text-faint">
          <span>OBS browser source · /overlay/{featured?.slug ?? "your-channel"}</span>
          <span>live preview</span>
        </div>
      </motion.div>
    </section>
  );
}

/** The real OBS overlay route, rendered at its native 1920×1080 and scaled to fit, exactly as OBS would show it. */
function ScaledOverlay({ slug }: { slug: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setScale(e.contentRect.width / 1920));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className="absolute inset-0">
      {scale > 0 && (
        <iframe
          src={`/overlay/${slug}`}
          title="Clutch OBS overlay"
          tabIndex={-1}
          className="pointer-events-none absolute left-0 top-0 origin-top-left border-0"
          style={{ width: 1920, height: 1080, transform: `scale(${scale})` }}
        />
      )}
    </div>
  );
}

/* ────────────────────────────────── faq ──────────────────────────────── */

const FAQ = [
  ["Is this real money?", "Not yet. Clutch runs on a testnet with test USDC from the built-in faucet, so you can try everything for free. The contracts, the AI and the settlement are the same ones that would run on mainnet."],
  ["Who decides the result?", "Nobody. Two different AI models read the stream independently, on their own frames, against a rule that was locked onchain before trading opened. If they don't agree, the market is voided and everyone is refunded."],
  ["Which streams work?", "Any live stream with something on screen that changes: scores, kill feeds, players left, rounds. Clutch reads Twitch, Kick and YouTube, plus Lichess games move by move."],
  ["Why do I need World ID?", "Limits only work if one person can't open ten wallets. One Proof of Human check gives you an anonymous pass. We never see your name, face or documents."],
  ["What does “call a market” mean?", "Connect your own 0G account and you can ask the AI to open a market on the stream you're watching right now. The inference is billed to your 0G credits, and you can see the request on your 0G activity page."],
  ["What if the chain goes down mid-market?", "Blackout Guard watches the L2 sequencer. During an outage trading stops, and any market whose window overlapped the outage is voided and refunded."],
];

function Faq() {
  return (
    <section id="faq" className="scroll-mt-24 border-t border-border">
      <div className="mx-auto grid max-w-[1240px] gap-12 px-4 py-28 sm:px-6 sm:py-36 lg:grid-cols-[0.8fr_1.2fr]">
        <SectionHead eyebrow="FAQ" title="Questions, answered." />
        <motion.div {...reveal} className="divide-y divide-border border-y border-border">
          {FAQ.map(([q, a]) => (
            <details key={q} className="group py-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-lg font-medium">
                {q}
                <span className="grid size-8 shrink-0 place-items-center rounded-full border border-border text-faint transition group-open:rotate-45 group-open:border-brand group-open:text-brand">+</span>
              </summary>
              <p className="mt-3 max-w-[62ch] leading-relaxed text-muted-foreground">{a}</p>
            </details>
          ))}
        </motion.div>
      </div>
    </section>
  );
}

/* ──────────────────────────────── closing ────────────────────────────── */

function Closing({ count }: { count: number }) {
  return (
    <section className="px-4 pb-24 sm:px-6">
      <motion.div {...reveal} className="grain relative mx-auto max-w-[1240px] overflow-hidden rounded-[28px] bg-brand px-8 py-20 text-brand-foreground sm:px-14 sm:py-24">
        <div aria-hidden className="absolute -right-24 -top-24 size-[420px] rounded-full bg-white/20 blur-[90px]" />
        <div className="relative flex flex-col gap-10 md:flex-row md:items-end md:justify-between">
          <h2 className="display max-w-[14ch] text-[clamp(2.6rem,6vw,5rem)] font-bold leading-[0.95]">The next moment is already loading.</h2>
          <div className="flex flex-col items-start gap-3">
            <Link href="/live" className="inline-flex h-13 items-center gap-2 rounded-full bg-black px-7 text-[15px] font-semibold text-white transition hover:bg-black/85 active:scale-[0.98]">
              Start watching <ArrowRightIcon size={16} weight="bold" />
            </Link>
            <span className="text-sm font-medium opacity-75">{count ? `${count} live streams right now · free test funds` : "Free test funds, no card needed"}</span>
          </div>
        </div>
      </motion.div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex max-w-[1240px] flex-col gap-6 px-4 py-10 text-sm text-faint sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-4">
          <Logo />
          <span>Built at ETHGlobal Mumbai</span>
        </div>
        <nav className="flex flex-wrap gap-x-6 gap-y-2">
          <Link href="/live" className="hover:text-foreground">App</Link>
          <Link href="/how-it-works" className="hover:text-foreground">Settlement rules</Link>
          <Link href="/vault" className="hover:text-foreground">Liquidity vault</Link>
          <Link href="/responsible-play" className="hover:text-foreground">Responsible play</Link>
          <a href={REPO} target="_blank" rel="noreferrer" className="hover:text-foreground">GitHub</a>
        </nav>
      </div>
    </footer>
  );
}
