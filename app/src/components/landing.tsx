"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import NumberFlow from "@number-flow/react";
import {
  ArrowRightIcon,
  ArrowUpRightIcon,
  ArrowsClockwiseIcon,
  BroadcastIcon,
  CheckIcon,
  EyeIcon,
  FingerprintIcon,
  LightningIcon,
  LockSimpleIcon,
  ProhibitIcon,
  ScanIcon,
  SealCheckIcon,
  ShieldCheckIcon,
  SlidersHorizontalIcon,
  TimerIcon,
} from "@phosphor-icons/react";
import type { AgentState, ChainState, MarketView, Receipt, StreamSummary } from "@clutch/shared";
import { DotType } from "@/components/dot-type";
import { LogoMark, Wordmark } from "@/components/brand";
import { channelRank } from "@/components/shell";
import { LiveBoard, PlatformIcon, frameUrl } from "@/components/stream";
import { isOpen } from "@/components/market";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { BlurFade } from "@/components/ui/blur-fade";
import { Marquee } from "@/components/ui/marquee";
import { TextReveal } from "@/components/ui/text-reveal";
import { api, useLive, useNow } from "@/lib/live";
import { REPO } from "@/lib/env";
import { ago, compact, short } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The public front door. An editorial page in alternating paper and night sections, with headlines that type
 * themselves in. Every number, question and receipt on it is live engine state; when the engine is unreachable the
 * cards fall back to skeletons, never to invented data.
 */

type Stats = { markets: number; volume: number; traders: number; voids: number; agent: AgentState; chain: ChainState };

const twitchPreview = (s: StreamSummary, big = false) =>
  s.media?.kind === "video" && s.media.platform === "twitch" ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.media.channel}-${big ? "1280x720" : "640x360"}.jpg` : undefined;

/** The engine's last frame, falling back to the platform's own live thumbnail. */
function StreamImage({ s, alt = "", className, quiet, priority }: { s: StreamSummary; alt?: string; className?: string; quiet?: boolean; priority?: boolean }) {
  const [failed, setFailed] = useState<string | undefined>();
  const first = frameUrl(s) ?? twitchPreview(s, priority);
  const src = failed === first ? twitchPreview(s, priority) : first;
  if (!src || failed === src) return quiet ? null : <div className={cn("bg-[var(--l-night-2)]", className)} />;
  return <img key={src} src={src} alt={alt} onError={() => setFailed(src)} className={className} loading={priority ? "eager" : "lazy"} decoding="async" fetchPriority={priority ? "high" : "auto"} />;
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
  // the hero market always belongs to the stream on screen
  const market = open.find((m) => m.slug === featured?.slug);
  const settled = receipts.filter((r) => r.verdict !== "VOID");
  const proof = settled.find((r) => r.rule.adapter === "vision") ?? settled[0] ?? receipts[0];
  // The hero plays real gameplay a market could be opened on: shooters and battle royale first, never chat or reruns.
  const GAMEPLAY: Record<string, number> = { fps: 3, "battle-royale": 3, moba: 2, sports: 2 };
  const twitch = video.filter((s) => s.media?.kind === "video" && s.media.platform === "twitch" && GAMEPLAY[s.category ?? ""]);
  const score = (s: StreamSummary) => (s.market?.phase === "trading" ? 100 : 0) + (s.vision?.state.mode === "gameplay" ? 50 : 0) + GAMEPLAY[s.category ?? ""] * 10;
  const playable = [...twitch].sort((a, b) => score(b) - score(a))[0] ?? featured;
  return { list, video, open, playable, live: list.filter((s) => s.live), featured, market, receipts, proof, stats, agent: agentLive ?? stats?.agent, reading: list.filter((s) => s.reading).length };
}
type D = ReturnType<typeof useLanding>;

export function Landing() {
  const d = useLanding();
  return (
    <div className="landing relative min-h-dvh overflow-x-clip bg-[var(--l-paper)] text-[var(--l-ink)]">
      <SiteNav />
      <Hero d={d} />
      <LiveBand d={d} />
      <Features d={d} />
      <SeeIt d={d} />
      <Integrity d={d} />
      <Steps d={d} />
      <Streamers d={d} />
      <Manifesto />
      <Faq />
      <Closing d={d} />
      <Receipts d={d} />
      <Footer d={d} />
    </div>
  );
}

/* ───────────────────────────────── shared ───────────────────────────────── */

const Container = ({ className, children }: { className?: string; children: React.ReactNode }) => <div className={cn("mx-auto w-full max-w-[1180px] px-5 sm:px-8", className)}>{children}</div>;

function Pill({ href, children, tone = "ink", className }: { href: string; children: React.ReactNode; tone?: "ink" | "snow" | "lime"; className?: string }) {
  return (
    <Link
      href={href}
      className={cn(
        "group inline-flex h-11 items-center gap-2 rounded-full px-5 text-[14.5px] font-medium transition-all duration-200 active:scale-[0.98]",
        tone === "ink" && "bg-[var(--l-ink)] text-[var(--l-paper)] hover:bg-black",
        tone === "snow" && "bg-[var(--l-snow)] text-[var(--l-ink)] hover:bg-white",
        tone === "lime" && "bg-[var(--l-lime)] text-[#101808] hover:brightness-105",
        className,
      )}
    >
      {children}
    </Link>
  );
}

/* ─────────────────────────────────── nav ────────────────────────────────── */

/** Which tone of section sits under the nav: the nav inverts over night sections. */
function useNavTone() {
  const [tone, setTone] = useState<"paper" | "night">("paper");
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const check = () => {
      const el = document.elementFromPoint(window.innerWidth / 2, 36)?.closest<HTMLElement>("[data-tone]");
      setTone(el?.dataset.tone === "night" ? "night" : "paper");
      setScrolled(window.scrollY > 40);
    };
    check();
    window.addEventListener("scroll", check, { passive: true });
    window.addEventListener("resize", check);
    return () => {
      window.removeEventListener("scroll", check);
      window.removeEventListener("resize", check);
    };
  }, []);
  return { tone, scrolled };
}

function SiteNav() {
  const { tone, scrolled } = useNavTone();
  const night = tone === "night";
  const links = [
    ["How it works", "#how"],
    ["Fair by design", "#integrity"],
    ["Streamers", "#streamers"],
    ["FAQ", "#faq"],
  ];
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex h-[72px] max-w-[1280px] items-center justify-between px-5 sm:px-8">
        <Link href="/" aria-label="Clutch home" className={cn("pointer-events-auto flex items-center gap-2.5 transition-colors duration-300", night ? "text-[var(--l-snow)]" : "text-[var(--l-ink)]")}>
          <LogoMark className="size-[24px]" accent={night ? "#b8f36b" : "#5d8f17"} />
          <Wordmark className={cn("text-[15px] transition-all duration-300", scrolled && "pointer-events-none -translate-x-1 opacity-0")} />
        </Link>
        <nav
          aria-label="Landing"
          className={cn(
            "pointer-events-auto flex items-center gap-1 rounded-full p-1 pl-2 backdrop-blur-xl transition-colors duration-300",
            night ? "bg-[#22211f]/85 ring-1 ring-white/10" : "bg-[#e9e8e2]/85 ring-1 ring-[var(--l-line)]",
          )}
        >
          <div className="hidden items-center md:flex">
            {links.map(([label, href]) => (
              <a key={href} href={href} className={cn("rounded-full px-3.5 py-2 text-[13.5px] transition-colors", night ? "text-[var(--l-snow-2)] hover:text-[var(--l-snow)]" : "text-[var(--l-ink-2)] hover:text-[var(--l-ink)]")}>
                {label}
              </a>
            ))}
          </div>
          <Link
            href="/live"
            className={cn(
              "inline-flex h-9 items-center gap-1.5 rounded-full px-4 text-[13.5px] font-medium transition-colors duration-300",
              night ? "bg-[var(--l-snow)] text-[var(--l-ink)] hover:bg-white" : "bg-[var(--l-ink)] text-[var(--l-paper)] hover:bg-black",
            )}
          >
            Open app
          </Link>
        </nav>
      </div>
    </header>
  );
}

/* ─────────────────────────────────── hero ───────────────────────────────── */

function Hero({ d }: { d: D }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, -60]);
  const scale = useTransform(scrollYProgress, [0, 0.6], [1, 1.02]);
  return (
    <section ref={ref} data-tone="paper" className="relative overflow-hidden pt-[132px] sm:pt-[156px]">
      <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(rgb(23_22_20/0.14)_0.9px,transparent_1.2px)] [background-size:22px_22px] [mask-image:radial-gradient(70%_60%_at_50%_30%,#000_40%,transparent_100%)]" />
      <Container className="relative flex flex-col items-center text-center">
        <BlurFade delay={0.05} inView={false}>
          <span className="inline-flex items-center gap-2 rounded-full bg-[var(--l-card)] px-3 py-1.5 text-[12.5px] text-[var(--l-ink-2)] shadow-[0_1px_0_rgb(255_255_255/0.8)_inset] ring-1 ring-[var(--l-line)]">
            <span className="relative flex size-1.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[#e2482f] opacity-60" />
              <span className="relative inline-flex size-1.5 rounded-full bg-[#e2482f]" />
            </span>
            {d.agent && (d.agent.mode !== "full" || d.agent.outOfCredits) ? (
              "Live markets on the moments of a stream"
            ) : d.reading ? (
              <>
                AI is reading <span className="font-medium text-[var(--l-ink)] tabular-nums">{d.reading}</span> live {d.reading === 1 ? "stream" : "streams"} right now
              </>
            ) : (
              "Live markets on the moments of a stream"
            )}
          </span>
        </BlurFade>
        <DotType as="h1" start delay={250} speed={42} text="Every moment is a market." className="serif mt-7 max-w-[12ch] text-[clamp(3rem,7.6vw,6.4rem)] leading-[0.98]" />
        <BlurFade delay={0.9} inView={false}>
          <p className="mx-auto mt-7 max-w-[46ch] text-[17px] leading-relaxed text-[var(--l-ink-2)] sm:text-lg">
            The last-second save. The 1v3. The final round. You can feel what&apos;s coming. Clutch spots that moment on a live stream, asks one yes-or-no question, and gives you a few seconds to call it.
          </p>
        </BlurFade>
        <BlurFade delay={1.05} inView={false}>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Pill href={d.featured ? `/c/${d.featured.slug}` : "/live"}>
              Make your first call <ArrowRightIcon size={15} className="transition-transform group-hover:translate-x-0.5" />
            </Pill>
            <a href="#how" className="inline-flex h-11 items-center rounded-full px-5 text-[14.5px] font-medium text-[var(--l-ink-2)] transition-colors hover:text-[var(--l-ink)]">
              See how it works
            </a>
          </div>
        </BlurFade>
      </Container>

      <Container className="relative mt-16 sm:mt-20">
        <motion.div style={reduce ? undefined : { y, scale }} initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 1.1, ease: [0.2, 0.75, 0.25, 1] }}>
          <ProductWindow d={d} />
        </motion.div>
      </Container>
      <div aria-hidden className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-[var(--l-paper)]" />
    </section>
  );
}

/** A real Clutch watch screen in miniature: the stream on the left, its live market on the right. */
function ProductWindow({ d }: { d: D }) {
  // Pin one channel: rankings shift every few seconds, and a moving pick would reload the video each time.
  const [pin, setPin] = useState<string>();
  const pinned = pin ? d.list.find((x) => x.slug === pin) : undefined;
  const next = d.playable?.slug;
  // Move on if the pinned channel goes offline, or the AI sees it leave gameplay (menu, lobby, break) while another
  // channel is confirmed in gameplay. A still image can switch freely; it never reloads anything.
  const leftGameplay = !!pinned?.vision && pinned.vision.state.mode !== "gameplay" && d.playable?.vision?.state.mode === "gameplay";
  useEffect(() => {
    if ((!pinned || !pinned.live || leftGameplay) && next && next !== pin) setPin(next);
  }, [pinned, next, pin, leftGameplay]);
  const s = pinned ?? d.playable;
  const m = d.open.find((x) => x.slug === s?.slug);
  const paused = !!d.agent && (d.agent.mode !== "full" || !!d.agent.outOfCredits);
  return (
    <div className="overflow-hidden rounded-[22px] bg-[var(--l-card)] p-2 shadow-[0_40px_120px_-40px_rgb(40_30_20/0.35),0_0_0_1px_var(--l-line)]">
      <div className="flex items-center gap-2 px-3 pb-2 pt-1">
        <span className="flex gap-1.5">
          {["#e8e5de", "#e8e5de", "#e8e5de"].map((c, i) => (
            <span key={i} className="size-2.5 rounded-full" style={{ background: c }} />
          ))}
        </span>
        <span className="mx-auto truncate rounded-md bg-[var(--l-paper)] px-3 py-1 font-mono text-[11px] text-[var(--l-ink-3)]">clutch / c / {s?.slug ?? "…"}</span>
        <span className="w-10" />
      </div>
      <div className="grid grid-cols-1 gap-2 rounded-[16px] bg-[var(--l-paper)] p-2 md:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-[12px] bg-[var(--l-night)]">
          <div className="relative aspect-video">
            {s ? <HeroShot key={s.slug} s={s} /> : <div className="absolute inset-0 animate-pulse bg-[var(--l-night-2)]" />}
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5">
              <span className="rounded-[5px] bg-[#ff755f] px-1.5 py-px text-[10.5px] font-bold text-[#1a0703]">LIVE</span>
              {s && <span className="rounded-full bg-black/55 px-2 py-0.5 text-[11px] text-white/90 backdrop-blur">{s.title}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 border-t border-white/10 px-3.5 py-2.5 text-[11.5px] text-white/60">
            <ScanIcon size={14} className="shrink-0 text-[var(--l-yes)]" />
            <span className="shrink-0 font-medium text-white/80">AI vision</span>
            <span className="min-w-0 flex-1 truncate">{s?.vision?.state.summary ?? (paused ? "AI engine is paused, so no frames are being read right now" : s ? "Reading the latest frame…" : "Connecting to the engine…")}</span>
          </div>
        </div>
        <HeroMarket m={m} s={s} receipts={d.receipts} />
      </div>
    </div>
  );
}

/**
 * The hero's picture: Twitch's own full-resolution live thumbnail of the pinned gameplay channel, fetched once and held
 * steady (no flicker), so it reads like a crisp screenshot. Falls back to the engine's last frame if Twitch has none.
 */
function HeroShot({ s }: { s: StreamSummary }) {
  const channel = s.media?.kind === "video" && s.media.platform === "twitch" ? s.media.channel : undefined;
  const [stamp] = useState(() => Math.floor(Date.now() / 300_000)); // Twitch refreshes previews every few minutes
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const src = channel && !failed ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${channel}-1920x1080.jpg?t=${stamp}` : undefined;
  return (
    <>
      {src ? (
        <img
          src={src}
          alt={`${s.title} live${s.game ? `, playing ${s.game}` : ""}`}
          loading="eager"
          decoding="async"
          fetchPriority="high"
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
          className={cn("absolute inset-0 size-full object-cover transition-opacity duration-500", loaded ? "opacity-100" : "opacity-0")}
        />
      ) : (
        <StreamImage s={s} priority className="absolute inset-0 size-full object-cover" />
      )}
      {src && !loaded && <div className="absolute inset-0 animate-pulse bg-[var(--l-night-2)]" />}
    </>
  );
}

function HeroMarket({ m, s, receipts }: { m?: MarketView; s?: StreamSummary; receipts: Receipt[] }) {
  const now = useNow(250);
  if (!m) {
    const recent = receipts.slice(0, 4);
    return (
      <div className="flex flex-col rounded-[12px] bg-[var(--l-card)] p-5 text-left ring-1 ring-[var(--l-line)]">
        <div className="flex items-center gap-1.5 text-[12px] font-medium text-[var(--l-ink-3)]">
          <ScanIcon size={13} /> Watching for the next moment
        </div>
        <p className="mt-2.5 text-[15px] leading-snug text-[var(--l-ink-2)]">{s ? `The AI is reading ${s.title}. A market opens the moment the action gets uncertain.` : "Markets open when the action on a live stream gets uncertain."}</p>
        <div className="mt-5 text-[11px] font-medium text-[var(--l-ink-3)]">Recent results</div>
        <ul className="mt-2 space-y-1.5">
          {(recent.length ? recent : Array.from({ length: 3 }, () => undefined)).map((r, i) =>
            r ? (
              <li key={r.marketId}>
                <Link href={`/m/${r.marketId}`} className="flex items-center gap-2.5 rounded-lg bg-[var(--l-paper)] px-3 py-2 ring-1 ring-[var(--l-line)] transition hover:ring-[var(--l-ink-3)]">
                  <VerdictChip v={r.verdict} className="shrink-0" short />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{r.question}</span>
                </Link>
              </li>
            ) : (
              <li key={i} className="h-9 animate-pulse rounded-lg bg-[var(--l-paper)]" />
            ),
          )}
        </ul>
      </div>
    );
  }
  const left = Math.max(0, m.lockTime - now);
  const frac = Math.min(1, left / Math.max(1, m.lockTime - m.openedAt));
  const trading = m.phase === "trading" && left > 0;
  return (
    <div className="relative flex flex-col overflow-hidden rounded-[12px] bg-[var(--l-card)] p-5 text-left ring-1 ring-[var(--l-line)]">
      {trading && (
        <div className="absolute inset-x-0 top-0 h-[3px] bg-[var(--l-paper-2)]">
          <div className="h-full bg-[#7fb13a] transition-[width] duration-300 ease-linear" style={{ width: `${frac * 100}%` }} />
        </div>
      )}
      <div className="flex items-center justify-between text-[12px]">
        <span className={cn("flex items-center gap-1.5 font-medium", trading ? "text-[#d8432f]" : "text-[#a8700d]")}>
          <span className={cn("size-1.5 rounded-full", trading ? "animate-pulse bg-[#d8432f]" : "bg-[#a8700d]")} />
          {trading ? "Live · closes in" : "Trading closed"}
        </span>
        {trading && <span className="rounded-md bg-[var(--l-paper)] px-2 py-0.5 font-mono font-semibold tabular-nums">0:{String(Math.ceil(left)).padStart(2, "0")}</span>}
      </div>
      <div className="mt-3 text-[18px] font-semibold leading-snug tracking-[-0.015em]">{m.question}</div>
      <div className="mt-4 flex items-baseline gap-2">
        <NumberFlow value={Math.round(m.priceYes * 100)} suffix="%" className="text-[26px] font-semibold leading-none tracking-tight tabular-nums" />
        <span className="text-[12.5px] text-[var(--l-ink-3)]">chance of Yes</span>
      </div>
      <div className="mt-4 grid grid-cols-4 gap-0 rounded-lg bg-[var(--l-paper)] p-1 text-center text-[12.5px] font-semibold tabular-nums text-[var(--l-ink-3)]">
        {[1, 5, 10, 25].map((v) => (
          <span key={v} className={cn("rounded-md py-1.5", v === 5 && "bg-[var(--l-card)] text-[var(--l-ink)] shadow-sm")}>
            ${v}
          </span>
        ))}
      </div>
      <Link href={`/c/${m.slug}`} className="mt-2.5 grid grid-cols-2 gap-2">
        <span className="flex h-14 flex-col items-center justify-center rounded-xl bg-[#0c9a76] text-white transition hover:brightness-105">
          <span className="text-[15px] font-semibold">Yes {Math.round(m.priceYes * 100)}¢</span>
        </span>
        <span className="flex h-14 flex-col items-center justify-center rounded-xl bg-[#d8434a] text-white transition hover:brightness-105">
          <span className="text-[15px] font-semibold">No {100 - Math.round(m.priceYes * 100)}¢</span>
        </span>
      </Link>
      <p className="mt-auto pt-3 text-center text-[11.5px] text-[var(--l-ink-3)]">Live market on {m.streamTitle} · test USDC</p>
    </div>
  );
}

function VerdictChip({ v, className, short: brief }: { v: Receipt["verdict"]; className?: string; short?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full px-2 py-0.5 font-mono text-[10.5px] font-semibold",
        v === "YES" ? "bg-[#0c9a76]/12 text-[#0c7a5e]" : v === "NO" ? "bg-[#d8434a]/12 text-[#b8323a]" : "bg-[rgb(23_22_20/0.07)] text-[var(--l-ink-2)]",
        className,
      )}
    >
      {v === "VOID" ? (brief ? "VOID" : "VOID · refunded") : v}
    </span>
  );
}

/* ─────────────────────────────── live band ─────────────────────────────── */

function LiveBand({ d }: { d: D }) {
  const live = d.live.slice(0, 18);
  return (
    <section data-tone="night" className="bg-[var(--l-night)] text-[var(--l-snow)]">
      <div className="border-b border-[var(--l-night-line)] py-12 sm:py-14">
        <p className="text-center text-[13px] text-[var(--l-snow-3)]">Reading live streams right now</p>
        <div className="relative mt-6">
          {live.length ? (
            <Marquee pauseOnHover className="[--duration:48s] [--gap:3rem]">
              {live.map((s) => (
                <Link key={s.slug} href={`/c/${s.slug}`} className="flex items-center gap-2.5 text-[17px] font-medium tracking-tight text-[var(--l-snow-2)] transition-colors hover:text-[var(--l-snow)]">
                  <PlatformIcon p={s.media?.kind === "video" ? s.media.platform : undefined} size={16} />
                  {s.title}
                  {s.game && <span className="text-[13px] font-normal text-[var(--l-snow-3)]">{s.game}</span>}
                </Link>
              ))}
            </Marquee>
          ) : (
            <div className="mx-auto h-6 max-w-xl animate-pulse rounded bg-[var(--l-night-2)]" />
          )}
          <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-1/5 bg-gradient-to-r from-[var(--l-night)]" />
          <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-1/5 bg-gradient-to-l from-[var(--l-night)]" />
        </div>
      </div>
      <Container className="py-24 sm:py-32">
        <DotType
          as="h2"
          speed={22}
          text="Chat calls every play. “He's dead.” “Easy clutch.” “No way he wins this.” For years those calls vanished the second they were typed. Clutch is where they finally count."
          className="serif max-w-[24ch] text-[clamp(2rem,4.2vw,3.5rem)] leading-[1.08] [--l-dot:#8fa6ba]"
        />
        <BlurFade inView delay={0.2}>
          <p className="mt-10 max-w-[44ch] text-[16px] leading-relaxed text-[var(--l-snow-2)]">Here is everything that happens between a moment on screen and the receipt that settles it.</p>
        </BlurFade>
      </Container>
    </section>
  );
}

/* ──────────────────────────────── features ─────────────────────────────── */

function Features({ d }: { d: D }) {
  const s = d.video.find((x) => x.vision?.state.counters?.length) ?? d.video.find((x) => x.vision) ?? d.featured;
  const rows: { title: string; body: React.ReactNode; panel: React.ReactNode; glow: string }[] = [
    {
      title: "It sees what you see.",
      body: (
        <>
          A vision model on 0G reads the stream every few seconds: the score, the kill feed, who is still standing. No insider feed, no hidden data. What&apos;s on screen is the <b className="font-medium text-[var(--l-snow)]">only thing</b> a market can ever be about.
        </>
      ),
      glow: "glow-indigo",
      panel: <VisionPanel s={s} paused={!!d.agent && (d.agent.mode !== "full" || !!d.agent.outOfCredits)} />,
    },
    {
      title: "It asks what chat is already shouting.",
      body: (
        <>
          When tension builds, the AI turns it into one plain question with a countdown. Before a single trade, the exact rule for deciding it is <b className="font-medium text-[var(--l-snow)]">locked onchain</b>, so the goalposts can never move.
        </>
      ),
      glow: "glow-mint",
      panel: <QuestionsPanel receipts={d.receipts} />,
    },
    {
      title: "It settles by the rule, not by vibes.",
      body: (
        <>
          When the window closes, a second, different model checks its own frames against that rule. Both agree, winners get paid. Any doubt at all, and <b className="font-medium text-[var(--l-snow)]">everyone gets their stake back</b>.
        </>
      ),
      glow: "glow-coral",
      panel: <ReceiptPanel r={d.proof} />,
    },
  ];
  return (
    <section id="how" data-tone="night" className="scroll-mt-20 bg-[var(--l-night)] pb-28 text-[var(--l-snow)] sm:pb-36">
      <Container className="space-y-4">
        {rows.map((r, i) => (
          <div key={r.title} className="grid grid-cols-1 gap-4 lg:grid-cols-[0.82fr_1.18fr]">
            <BlurFade inView delay={0.05} className={cn("flex flex-col justify-end rounded-[20px] bg-[var(--l-night-2)] p-7 ring-1 ring-[var(--l-night-line)] sm:p-9", i % 2 === 1 && "lg:order-2")}>
              <span className="font-mono text-[11px] text-[var(--l-snow-3)]">0{i + 1}</span>
              <DotType as="h3" speed={30} text={r.title} className="serif mt-auto pt-16 text-[30px] leading-tight [--l-dot:#8fa6ba] sm:text-[34px]" />
              <p className="mt-4 max-w-[40ch] text-[15px] leading-relaxed text-[var(--l-snow-2)]">{r.body}</p>
            </BlurFade>
            <BlurFade inView delay={0.12} className={cn("sheen relative overflow-hidden rounded-[20px] p-5 sm:p-9", r.glow, i % 2 === 1 && "lg:order-1")}>
              {r.panel}
            </BlurFade>
          </div>
        ))}
      </Container>
    </section>
  );
}

const glass = "rounded-2xl bg-[#0d1220]/80 ring-1 ring-white/10 backdrop-blur-md shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)]";

function VisionPanel({ s, paused }: { s?: StreamSummary; paused?: boolean }) {
  const v = s?.vision?.state;
  const counters = v?.counters?.slice(0, 5) ?? [];
  return (
    <div className={cn(glass, "relative mx-auto max-w-[560px] overflow-hidden text-white")}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-[12px]">
        <span className="flex items-center gap-2 font-medium">
          <ScanIcon size={14} className="text-[var(--l-yes)]" /> What the AI sees
        </span>
        <span className="text-white/45">{s ? s.title : "…"}</span>
      </div>
      <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-[1.1fr_1fr]">
        <div className="relative aspect-video overflow-hidden rounded-lg bg-black/40">
          {s && <StreamImage s={s} className="absolute inset-0 size-full object-cover" />}
          <div className="absolute inset-0 bg-[linear-gradient(transparent_50%,rgb(0_0_0/0.45))]" />
          {v && <span className="absolute bottom-2 left-2 rounded-md bg-[var(--l-yes)]/90 px-1.5 py-0.5 text-[10.5px] font-semibold text-[#04140f]">{v.mode}</span>}
        </div>
        {!v && paused ? (
          <div className="flex flex-col justify-center gap-2 text-[12px]">
            <span className="flex items-center gap-1.5 font-medium text-[#f3c16a]">
              <span className="size-1.5 rounded-full bg-[#f3c16a]" /> AI engine paused
            </span>
            <span className="leading-relaxed text-white/55">No frames are being read right now, so no new markets open. Readings show here the moment it is back.</span>
          </div>
        ) : !counters.length && v ? (
          <div className="flex flex-col justify-center gap-2 text-[12px]">
            <span className="text-white/45">Scene</span>
            <span className="font-medium text-white/90">{v.game ?? s?.game ?? "Live gameplay"}</span>
            <span className="text-white/45">No numbers on screen in this frame. Markets wait for one.</span>
          </div>
        ) : (
        <ul className="space-y-1.5 text-[12px]">
          {(counters.length ? counters : [undefined, undefined, undefined]).map((c, i) => (
            <motion.li key={c?.key ?? i} initial={{ opacity: 0, x: 8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 + i * 0.12 }} className="flex items-center justify-between rounded-md bg-white/[0.05] px-2.5 py-1.5">
              {c ? (
                <>
                  <span className="truncate text-white/60">{c.label}</span>
                  <span className="font-mono font-semibold tabular-nums">{c.value}</span>
                </>
              ) : (
                <span className="h-3 w-full animate-pulse rounded bg-white/10" />
              )}
            </motion.li>
          ))}
        </ul>
        )}
      </div>
      <div className="border-t border-white/10 px-4 py-3 text-[12px] leading-relaxed text-white/55">{v?.summary ?? (paused ? "Last frame shown above. Live reading resumes automatically." : "Waiting for the next reading…")}</div>
    </div>
  );
}

function QuestionsPanel({ receipts }: { receipts: Receipt[] }) {
  const rows = receipts.slice(0, 6);
  return (
    <div className={cn(glass, "mx-auto max-w-[560px] overflow-hidden text-white")}>
      <div className="grid grid-cols-[48px_minmax(0,1fr)_64px] gap-3 border-b border-white/10 px-4 py-3 text-[11px] text-white/40">
        <span>When</span>
        <span>Question the AI asked</span>
        <span className="text-right">Result</span>
      </div>
      <ul>
        {(rows.length ? rows : Array.from({ length: 5 }, () => undefined)).map((r, i) => (
          <motion.li key={r?.marketId ?? i} initial={{ opacity: 0, y: 6 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: 0.1 + i * 0.09 }} className="grid grid-cols-[48px_minmax(0,1fr)_64px] items-center gap-3 border-b border-white/[0.06] px-4 py-2.5 text-[12.5px] last:border-0">
            {r ? (
              <>
                <span className="font-mono text-[11px] text-white/40">{ago(r.resolvedAt).replace(" ago", "")}</span>
                <span className="truncate text-white/85">{r.question}</span>
                <span className={cn("text-right font-mono text-[11px] font-semibold", r.verdict === "YES" ? "text-[var(--l-yes)]" : r.verdict === "NO" ? "text-[var(--l-no)]" : "text-white/45")}>{r.verdict}</span>
              </>
            ) : (
              <span className="col-span-3 h-3 animate-pulse rounded bg-white/10" />
            )}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

function ReceiptPanel({ r }: { r?: Receipt }) {
  return (
    <div className={cn(glass, "mx-auto max-w-[560px] overflow-hidden text-white")}>
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3 text-[12px]">
        <span className="flex items-center gap-2 font-medium">
          <SealCheckIcon size={14} weight="fill" className="text-[var(--l-yes)]" /> Receipt {r ? `#${r.marketId}` : ""}
        </span>
        {r && (
          <Link href={`/m/${r.marketId}`} className="flex items-center gap-1 text-white/50 hover:text-white">
            Open <ArrowUpRightIcon size={12} />
          </Link>
        )}
      </div>
      <div className="space-y-4 p-4">
        <div className="text-[15px] font-medium leading-snug">{r?.question ?? <span className="block h-4 w-3/4 animate-pulse rounded bg-white/10" />}</div>
        <div className="rounded-lg bg-white/[0.04] p-3 text-[12px] leading-relaxed text-white/60">{r?.rule.resolution ?? "…"}</div>
        <ul className="space-y-1.5">
          {(r?.readings ?? [undefined, undefined]).map((x, i) => (
            <motion.li key={i} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.25 }} className="flex items-center justify-between rounded-md bg-white/[0.05] px-3 py-2 text-[12px]">
              <span className="flex items-center gap-2 text-white/70">
                <span className="grid size-4 place-items-center rounded-full bg-white/10 text-[9px] font-bold">{i === 0 ? "A" : "B"}</span>
                {x ? x.source.replace(/^0g:/, "0G · ") : "…"}
              </span>
              <span className="font-mono font-semibold">{x?.evaluation ?? "…"}</span>
            </motion.li>
          ))}
        </ul>
        <div className="flex items-center justify-between border-t border-white/10 pt-3 text-[11.5px]">
          <span className="font-mono text-white/40">rule {r ? short(r.ruleHash, 8) : "…"}</span>
          {r && <span className={cn("rounded-full px-2.5 py-0.5 font-mono font-semibold", r.verdict === "YES" ? "bg-[var(--l-yes)] text-[#04140f]" : r.verdict === "NO" ? "bg-[var(--l-no)] text-[#1d0707]" : "bg-white/15 text-white")}>{r.verdict === "VOID" ? "VOID · refunded" : `Settled ${r.verdict}`}</span>}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────────── see it + proof ──────────────────────────── */

function SeeIt({ d }: { d: D }) {
  const st = d.stats;
  const max = Math.max(1, st?.markets ?? 1);
  return (
    <section data-tone="paper" className="bg-[var(--l-paper)] py-28 sm:py-36">
      <Container className="flex flex-col items-center text-center">
        <DotType as="h2" speed={36} text="Don't take our word for it. Watch one settle." className="serif text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1.05]" />
        <BlurFade inView delay={0.2}>
          <Pill href={d.featured ? `/c/${d.featured.slug}` : "/live"} className="mt-8">
            Open a live stream <ArrowRightIcon size={15} className="transition-transform group-hover:translate-x-0.5" />
          </Pill>
        </BlurFade>
      </Container>
      <Container className="mt-20">
        <BlurFade inView className="grid grid-cols-1 overflow-hidden rounded-[22px] bg-[var(--l-card)] shadow-[0_30px_90px_-50px_rgb(40_30_20/0.35)] ring-1 ring-[var(--l-line)] md:grid-cols-[1.35fr_1fr]">
          <figure className="flex flex-col p-8 sm:p-12">
            <span aria-hidden className="serif text-6xl leading-none text-[var(--l-ink-3)]/50">&ldquo;</span>
            <blockquote className="serif mt-2 max-w-[30ch] text-[clamp(1.5rem,2.6vw,2.05rem)] leading-[1.25]">
              If the two readers can&apos;t agree on what happened, nobody wins and nobody loses. Every stake comes back, fees included.
            </blockquote>
            <figcaption className="mt-auto flex items-center gap-3 pt-10 text-[13px]">
              <span className="grid size-9 place-items-center rounded-full bg-[var(--l-paper)] ring-1 ring-[var(--l-line)]">
                <ShieldCheckIcon size={16} weight="fill" className="text-[#2f63d6]" />
              </span>
              <span>
                <span className="block font-medium">The settlement rule</span>
                <span className="text-[var(--l-ink-3)]">Committed onchain before every market opens</span>
              </span>
            </figcaption>
          </figure>
          <div className="m-2 flex flex-col rounded-[16px] bg-[var(--l-paper)] p-7 ring-1 ring-[var(--l-line)] sm:p-8">
            <span className="flex items-center gap-2 text-[13px] font-medium text-[var(--l-ink-2)]">
              <LogoMark className="size-4 text-[var(--l-ink)]" accent="#5d8f17" /> The record so far
            </span>
            <div className="mt-8 flex items-baseline gap-1">
              <span className="serif text-[64px] leading-none tabular-nums">{st ? <NumberFlow value={st.markets} /> : "…"}</span>
            </div>
            <p className="mt-2 text-[13.5px] text-[var(--l-ink-2)]">markets settled by the rule they opened with</p>
            <div className="mt-auto space-y-4 pt-10">
              <div className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-[var(--l-ink-3)]">How they ended</div>
              <Bar label="Resolved Yes or No" value={st ? st.markets - st.voids : undefined} max={max} tone="ink" />
              <Bar label="Voided and refunded" value={st?.voids} max={max} tone="soft" />
            </div>
          </div>
        </BlurFade>
      </Container>
    </section>
  );
}

function Bar({ label, value, max, tone }: { label: string; value?: number; max: number; tone: "ink" | "soft" }) {
  return (
    <div>
      <div className="flex items-center justify-between text-[12.5px]">
        <span className="text-[var(--l-ink-2)]">{label}</span>
        <span className="font-mono font-medium tabular-nums">{value ?? "…"}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-[var(--l-paper-2)]">
        <motion.div initial={{ width: 0 }} whileInView={{ width: `${((value ?? 0) / max) * 100}%` }} viewport={{ once: true }} transition={{ duration: 1.1, ease: [0.2, 0.75, 0.25, 1] }} className={cn("h-full rounded-full", tone === "ink" ? "bg-[var(--l-ink)]" : "bg-[var(--l-ink-3)]/60")} />
      </div>
    </div>
  );
}

/* ──────────────────────────────── integrity ────────────────────────────── */

function Integrity({ d }: { d: D }) {
  const chain = d.stats?.chain;
  const r = d.proof;
  const items = [
    {
      icon: TimerIcon,
      name: "Latency buffer",
      tag: "Every market",
      title: "Trading locks before the moment plays out.",
      body: "Each market's window starts several seconds after trading closes, longer than the stream delay, so nobody can trade on something they've already seen.",
      viz: <BufferViz />,
    },
    {
      icon: LockSimpleIcon,
      name: "Rule first",
      tag: "Onchain",
      title: "The rule is public before the first trade.",
      body: "The exact resolution rule is hashed and committed onchain when the market opens. Anyone can recompute the verdict from the evidence afterwards.",
      viz: <Mono lines={[["rule", r ? short(r.ruleHash, 14) : "…"], ["question", r?.question ?? "…"], ["resolves", r?.rule.resolution ?? "…"]]} />,
    },
    {
      icon: EyeIcon,
      name: "Two readers",
      tag: "Every result",
      title: "Two different models have to agree.",
      body: "Reader A opens the market, a different Reader B settles it on its own frames. Corroboration, not certainty: if they disagree, nobody guesses.",
      viz: <Mono lines={(r?.readings ?? []).map((x, i) => [`reader ${i === 0 ? "A" : "B"}`, `${x.source.replace(/^0g:/, "")} → ${x.evaluation}`])} />,
    },
    {
      icon: ProhibitIcon,
      name: "No insiders",
      tag: "Contract-enforced",
      title: "The streamer can't trade their own markets.",
      body: "A streamer's verified human ID is blocked from their own channel's markets in the contract, and Clutch never asks about things the person on camera alone controls.",
      viz: <Mono lines={[["streamer", "blocked onchain"], ["markets", "decided by opponents or chance"], ["payout", "small and capped"]]} />,
    },
    {
      icon: ArrowsClockwiseIcon,
      name: "Refund on doubt",
      tag: "Always",
      title: "Doubt means a refund, never a coin flip.",
      body: "A missing frame, a disagreement or a stream that drops all end the same way: the market voids and every stake is returned in full.",
      viz: <Mono lines={[["voided so far", d.stats ? String(d.stats.voids) : "…"], ["refunded", "100% of stakes, fees included"]]} />,
    },
    {
      icon: ShieldCheckIcon,
      name: "Blackout Guard",
      tag: "Live",
      title: "If the chain stalls, trading stops.",
      body: "Blackout Guard watches the L2 sequencer. During an outage trading pauses, and any market whose window overlapped it is voided and refunded.",
      viz: <Mono lines={[["sequencer", chain?.sequencerPhase ?? "…"], ["recovery fee", chain ? `${(chain.blackoutFeePips / 10_000).toFixed(2)}%` : "…"]]} />,
    },
  ];
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const DURATION = 5200;
  useEffect(() => {
    if (paused || reduce) return;
    const t = setTimeout(() => setI((x) => (x + 1) % items.length), DURATION);
    return () => clearTimeout(t);
  }, [i, paused, reduce, items.length]);
  const cur = items[i];
  return (
    <section id="integrity" data-tone="paper" className="sunset scroll-mt-20 pb-28 pt-28 sm:pb-36 sm:pt-36">
      <Container>
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2 md:items-end">
          <DotType as="h2" speed={34} text="Nobody decides who wins." className="serif text-[clamp(2.4rem,5vw,4rem)] leading-[1.02]" />
          <BlurFade inView delay={0.15}>
            <p className="max-w-[46ch] text-[16px] leading-relaxed text-[var(--l-ink-2)]">
              The moment anyone can rig a call, the game is over. So six rules run on every market, and each one leaves evidence you can check yourself.
            </p>
            <Link href="/how-it-works" className="mt-4 inline-flex items-center gap-1.5 text-[14.5px] font-medium underline decoration-[var(--l-ink-3)]/50 underline-offset-4 hover:decoration-[var(--l-ink)]">
              Read the settlement rules <ArrowRightIcon size={14} />
            </Link>
          </BlurFade>
        </div>

        <div className="mt-14 grid grid-cols-1 gap-3 md:grid-cols-[0.9fr_1.1fr]" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)}>
          <ul className="space-y-2" role="tablist" aria-label="Fairness rules">
            {items.map((it, k) => (
              <li key={it.name}>
                <button
                  role="tab"
                  aria-selected={k === i}
                  onClick={() => setI(k)}
                  onMouseEnter={() => setI(k)}
                  onFocus={() => setI(k)}
                  className={cn(
                    "relative flex w-full items-center gap-3 overflow-hidden rounded-xl px-4 py-3.5 text-left transition-all duration-300",
                    k === i ? "bg-[var(--l-card)] shadow-[0_10px_30px_-18px_rgb(60_30_20/0.5)]" : "bg-white/30 hover:bg-white/50",
                  )}
                >
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-full transition-colors", k === i ? "bg-[var(--l-ink)] text-[var(--l-paper)]" : "bg-white/60 text-[var(--l-ink-2)]")}>
                    <it.icon size={15} weight="bold" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-[14.5px] font-medium">{it.name}</span>
                    <span className="ml-2 hidden text-[13px] text-[var(--l-ink-3)] sm:inline">{it.title.split(" ").slice(0, 4).join(" ")}…</span>
                  </span>
                  <span className="shrink-0 rounded-full bg-[var(--l-paper)]/80 px-2 py-0.5 text-[11px] text-[var(--l-ink-2)]">{it.tag}</span>
                  {k === i && !reduce && (
                    <motion.span key={`${i}-${paused}`} initial={{ width: 0 }} animate={{ width: paused ? undefined : "100%" }} transition={{ duration: DURATION / 1000, ease: "linear" }} className="absolute bottom-0 left-0 h-[2px] bg-[var(--l-ink)]/70" />
                  )}
                </button>
              </li>
            ))}
          </ul>
          <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }} className="flex flex-col rounded-[20px] bg-[var(--l-card)]/90 p-7 shadow-[0_30px_80px_-40px_rgb(60_30_20/0.6)] ring-1 ring-white/60 backdrop-blur sm:p-9">
            <span className="flex items-center gap-2 text-[13px] text-[var(--l-ink-3)]">
              <cur.icon size={15} weight="bold" /> {cur.name}
            </span>
            <h3 className="serif mt-4 text-[28px] leading-tight">{cur.title}</h3>
            <p className="mt-3 max-w-[48ch] text-[15px] leading-relaxed text-[var(--l-ink-2)]">{cur.body}</p>
            <div className="mt-8">{cur.viz}</div>
          </motion.div>
        </div>
      </Container>
    </section>
  );
}

function BufferViz() {
  const parts = [
    ["Trading", "bg-[var(--l-ink)]", 46],
    ["Buffer", "bg-[#a8700d]/70", 16],
    ["Event window", "bg-[#0c9a76]/80", 38],
  ] as const;
  return (
    <div>
      <div className="flex h-9 overflow-hidden rounded-lg">
        {parts.map(([l, c, w], k) => (
          <motion.div key={l} initial={{ width: 0 }} animate={{ width: `${w}%` }} transition={{ duration: 0.7, delay: k * 0.25, ease: [0.2, 0.75, 0.25, 1] }} className={cn("flex items-center px-3 text-[11.5px] font-medium text-white", c, k > 0 && "border-l border-white/50")}>
            <span className="truncate">{l}</span>
          </motion.div>
        ))}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10.5px] text-[var(--l-ink-3)]">
        <span>opens</span>
        <span>locks</span>
        <span>settles</span>
      </div>
    </div>
  );
}

function Mono({ lines }: { lines: string[][] }) {
  return (
    <dl className="space-y-1.5 rounded-xl bg-[var(--l-paper)] p-4 font-mono text-[11.5px] ring-1 ring-[var(--l-line)]">
      {(lines.length ? lines : [["…", "…"]]).map(([k, v], n) => (
        <motion.div key={k + n} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.1 + n * 0.12 }} className="grid grid-cols-[110px_minmax(0,1fr)] gap-3">
          <dt className="text-[var(--l-ink-3)]">{k}</dt>
          <dd className="truncate text-[var(--l-ink)]">{v}</dd>
        </motion.div>
      ))}
    </dl>
  );
}

/* ────────────────────────────────── steps ──────────────────────────────── */

function Steps({ d }: { d: D }) {
  const s = d.featured;
  const m = d.market;
  const r = d.proof;
  const cards = [
    {
      title: "Pick a stream.",
      body: "Any live channel works. The AI is already reading it, and the player and chat stay exactly where you expect them.",
      bg: "radial-gradient(80% 70% at 30% 20%, #8a9bb0 0%, #4c5d73 45%, #232c38 100%)",
      chips: [
        [<BroadcastIcon key="i" size={13} weight="fill" />, s ? `LIVE · ${s.title}` : "LIVE"],
        [<ScanIcon key="i" size={13} />, s?.vision?.state.mode ? `AI reading · ${s.vision.state.mode}` : "AI reading"],
        [<EyeIcon key="i" size={13} />, s ? `${compact(s.platformViewers ?? s.watching)} watching` : "…"],
      ],
    },
    {
      title: "Call it before it locks.",
      body: "A question pops up with a countdown. Pick an amount, tap Yes or No, and you're in. No confirm screen, no wallet pop-up.",
      bg: "radial-gradient(80% 70% at 70% 15%, #b9c79a 0%, #6f8a5c 45%, #2c3a24 100%)",
      chips: [
        [<LightningIcon key="i" size={13} weight="fill" />, m ? m.question : r?.question ?? "Will they survive the next 30 seconds?"],
        [<CheckIcon key="i" size={13} weight="bold" />, m ? `Yes ${Math.round(m.priceYes * 100)}¢ · No ${100 - Math.round(m.priceYes * 100)}¢` : "Yes or No, one tap"],
      ],
    },
    {
      title: "Let the rule settle it.",
      body: "The moment plays out, both readers check it, and winners are paid automatically. Every result gets a public receipt.",
      bg: "radial-gradient(80% 70% at 40% 85%, #e2b4a0 0%, #c4673f 45%, #4a2418 100%)",
      chips: [
        [<SealCheckIcon key="i" size={13} weight="fill" />, r ? (r.verdict === "VOID" ? "Voided · stakes refunded" : `Resolved ${r.verdict}`) : "Resolved"],
        [<ShieldCheckIcon key="i" size={13} weight="fill" />, r ? `Receipt #${r.marketId}` : "Public receipt"],
      ],
    },
  ];
  return (
    <section data-tone="paper" className="bg-[var(--l-paper)] py-28 sm:py-36">
      <Container>
        <DotType as="h2" speed={32} text="From the couch to the call in three taps." className="serif max-w-[16ch] text-[clamp(2.4rem,5vw,4rem)] leading-[1.02]" />
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-3">
          {cards.map((c, k) => (
            <BlurFade key={c.title} inView delay={0.08 * k}>
              <div className="relative aspect-[4/3.7] overflow-hidden rounded-[18px]" style={{ background: c.bg }}>
                <div aria-hidden className="absolute -left-10 top-1/3 h-40 w-[140%] -rotate-12 bg-white/15 blur-2xl" />
                <div className="relative flex h-full flex-col items-center gap-2.5 p-5 pt-8">
                  {c.chips.map(([icon, label], n) => (
                    <motion.div
                      key={n}
                      initial={{ opacity: 0, y: 14, scale: 0.97 }}
                      whileInView={{ opacity: 1, y: 0, scale: 1 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.25 + n * 0.22, duration: 0.5, ease: [0.2, 0.75, 0.25, 1] }}
                      className="flex w-[88%] items-center gap-2.5 rounded-xl bg-white/70 px-3.5 py-2.5 text-[12.5px] text-[var(--l-ink)] shadow-[0_10px_30px_-12px_rgb(0_0_0/0.4)] ring-1 ring-white/70 backdrop-blur-md"
                    >
                      <span className="shrink-0 text-[var(--l-ink-2)]">{icon}</span>
                      <span className="line-clamp-2 font-medium">{label}</span>
                    </motion.div>
                  ))}
                  <span className="mt-auto grid size-9 place-items-center rounded-xl bg-white/60 font-mono text-[12px] font-semibold text-[var(--l-ink-2)] backdrop-blur">{k + 1}</span>
                </div>
              </div>
              <h3 className="mt-5 text-[17px] font-semibold tracking-tight">{c.title}</h3>
              <p className="mt-1.5 max-w-[36ch] text-[14.5px] leading-relaxed text-[var(--l-ink-2)]">{c.body}</p>
            </BlurFade>
          ))}
        </div>
      </Container>
    </section>
  );
}

/* ──────────────────────────────── streamers ────────────────────────────── */

function Streamers({ d }: { d: D }) {
  const s = d.video.find((x) => x.slug === d.market?.slug) ?? d.featured;
  return (
    <section id="streamers" data-tone="paper" className="scroll-mt-20 border-t border-[var(--l-line)] bg-[var(--l-paper)] py-28 sm:py-36">
      <Container>
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 md:items-end">
          <DotType as="h2" speed={34} text="Your chat, now with stakes." className="serif text-[clamp(2.4rem,5vw,4rem)] leading-[1.02]" />
          <BlurFade inView delay={0.15}>
            <p className="max-w-[44ch] text-[16px] leading-relaxed text-[var(--l-ink-2)]">Your viewers already predict every play. Clutch gives them a reason to stay for the next one, without you changing how you stream.</p>
          </BlurFade>
        </div>
        <div className="mt-14 grid grid-cols-1 gap-5 md:grid-cols-2">
          <BlurFade inView>
            <div className="glow-plum sheen relative flex min-h-[340px] flex-col justify-center overflow-hidden rounded-[18px] p-5 sm:min-h-[380px] sm:p-7">
              <div className="relative aspect-video overflow-hidden rounded-xl bg-black/30 shadow-[0_30px_60px_-30px_rgb(30_10_40/0.8)] ring-1 ring-white/30">
                {s && <StreamImage s={s} className="absolute inset-0 size-full object-cover" />}
                {s && <ScaledOverlay slug={s.slug} />}
              </div>
              <div className="mt-3 flex items-center justify-between font-mono text-[10.5px] text-white/75">
                <span>OBS browser source · /overlay/{s?.slug ?? "your-channel"}</span>
                <span>live preview</span>
              </div>
            </div>
            <h3 className="mt-5 text-[17px] font-semibold tracking-tight">Drop in one overlay.</h3>
            <p className="mt-1.5 max-w-[42ch] text-[14.5px] leading-relaxed text-[var(--l-ink-2)]">A single browser source shows the live question, the countdown and the result on stream, so chat plays along without leaving.</p>
          </BlurFade>
          <BlurFade inView delay={0.1}>
            <div className="glow-plum sheen relative flex min-h-[340px] flex-col justify-center overflow-hidden rounded-[18px] p-5 sm:min-h-[380px] sm:p-7">
              <div className="rounded-xl bg-white/85 p-4 text-[var(--l-ink)] shadow-[0_30px_60px_-30px_rgb(30_10_40/0.8)] ring-1 ring-white/60 backdrop-blur">
                <div className="flex items-center justify-between border-b border-[var(--l-line)] pb-3">
                  <span className="flex items-center gap-2 text-[13px] font-semibold">
                    <SlidersHorizontalIcon size={15} /> Creator studio
                  </span>
                  <span className="rounded-full bg-[#0c9a76]/12 px-2 py-0.5 text-[11px] font-medium text-[#0c7a5e]">Channel verified</span>
                </div>
                <ul className="divide-y divide-[var(--l-line)] text-[13px]">
                  {[
                    ["Markets on my stream", "On", true],
                    ["Veto a market", "Any time", false],
                    ["Pause all markets", "One tap", false],
                    ["Trade my own markets", "Blocked onchain", false],
                  ].map(([k, v, on], n) => (
                    <motion.li key={String(k)} initial={{ opacity: 0, x: 8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 + n * 0.12 }} className="flex items-center justify-between py-3">
                      <span>{k}</span>
                      {on ? (
                        <span className="flex h-5 w-9 items-center rounded-full bg-[var(--l-ink)] p-0.5">
                          <span className="ml-auto size-4 rounded-full bg-white" />
                        </span>
                      ) : (
                        <span className="text-[12px] text-[var(--l-ink-3)]">{v}</span>
                      )}
                    </motion.li>
                  ))}
                </ul>
                <div className="mt-2 flex items-center gap-2 rounded-lg bg-[var(--l-paper)] px-3 py-2.5 text-[12px] text-[var(--l-ink-2)]">
                  <FingerprintIcon size={15} /> Claim a channel by putting a code in your stream title.
                </div>
              </div>
            </div>
            <h3 className="mt-5 text-[17px] font-semibold tracking-tight">Stay in control.</h3>
            <p className="mt-1.5 max-w-[42ch] text-[14.5px] leading-relaxed text-[var(--l-ink-2)]">Veto any market or pause them all. You can never trade your own markets, and the contract enforces it.</p>
          </BlurFade>
        </div>
        <BlurFade inView delay={0.15} className="mt-10">
          <Pill href="/studio">
            <BroadcastIcon size={16} weight="fill" /> Open creator studio
          </Pill>
        </BlurFade>
      </Container>
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
        <iframe src={`/overlay/${slug}`} loading="lazy" title="Clutch OBS overlay" tabIndex={-1} className="pointer-events-none absolute left-0 top-0 origin-top-left border-0" style={{ width: 1920, height: 1080, transform: `scale(${scale})` }} />
      )}
    </div>
  );
}

/* ──────────────────────────────── manifesto ────────────────────────────── */

function Manifesto() {
  return (
    <section data-tone="paper" className="border-t border-[var(--l-line)] bg-[var(--l-paper)] py-28 sm:py-40">
      <Container>
        <TextReveal mode="inline" dim={0.18} textClassName="serif max-w-[26ch] text-[clamp(2rem,4.2vw,3.4rem)] leading-[1.14]">
          “Chat has always known what happens next. We just gave it a scoreboard, and made sure nobody can rig it.”
        </TextReveal>
        <BlurFade inView delay={0.1} className="mt-10 flex items-center gap-3 text-[13px]">
          <span className="grid size-10 place-items-center rounded-full bg-[var(--l-card)] ring-1 ring-[var(--l-line)]">
            <LogoMark className="size-[18px]" accent="#5d8f17" />
          </span>
          <span>
            <span className="block font-medium">Why we built Clutch</span>
            <span className="text-[var(--l-ink-3)]">ETHGlobal Mumbai</span>
          </span>
        </BlurFade>
      </Container>
    </section>
  );
}

/* ─────────────────────────────────── faq ───────────────────────────────── */

const FAQ = [
  ["Is this real money?", "Not yet. Clutch runs on a testnet with test USDC from the built-in faucet, so you can try everything for free. The contracts, the AI and the settlement are the same ones that would run on mainnet."],
  ["Who decides the result?", "A rule, not a person. Two different AI models each read the stream on their own frames, against a rule that was locked onchain before trading opened. If they don't agree, the market is voided and everyone is refunded."],
  ["Which streams work?", "Any live stream with something on screen that changes: scores, kill feeds, players left, rounds. Clutch reads Twitch, Kick and YouTube, plus Lichess games move by move."],
  ["Do I need World ID?", "No. Sign in and you can trade right away. One Proof of Human check unlocks free funds every day, a place on the leaderboard and a higher daily limit. We never see your name, face or documents."],
  ["Can the streamer rig a market?", "Clutch never opens markets the person on camera controls, like whether they survive. Markets are on what opponents or chance decide, such as team scores or who scores first, and each market's payout is small and capped."],
  ["What does “call a market” mean?", "Connect your own 0G account and you can ask the AI to open a market on the stream you're watching right now. The inference is billed to your 0G credits, and you can see the request on your 0G activity page."],
  ["What if the chain goes down mid-market?", "Blackout Guard watches the L2 sequencer. During an outage trading stops, and any market whose window overlapped the outage is voided and refunded."],
];

function Faq() {
  return (
    <section id="faq" data-tone="paper" className="scroll-mt-20 border-t border-[var(--l-line)] bg-[var(--l-paper)] py-28 sm:py-36">
      <Container className="grid grid-cols-1 gap-12 lg:grid-cols-[0.8fr_1.2fr]">
        <div>
          <DotType as="h2" speed={36} text="Questions, answered." className="serif text-[clamp(2.4rem,4.6vw,3.6rem)] leading-[1.02]" />
          <p className="mt-4 max-w-[34ch] text-[15px] leading-relaxed text-[var(--l-ink-2)]">
            Everything else lives in the{" "}
            <Link href="/how-it-works" className="underline decoration-[var(--l-ink-3)]/50 underline-offset-4 hover:decoration-[var(--l-ink)]">
              settlement rules
            </Link>
            .
          </p>
        </div>
        <BlurFade inView>
          <Accordion type="single" collapsible className="border-t border-[var(--l-line)]">
            {FAQ.map(([q, a]) => (
              <AccordionItem key={q} value={q} className="border-[var(--l-line)]">
                <AccordionTrigger className="py-5 text-[17px] font-medium hover:no-underline [&>svg]:text-[var(--l-ink-3)]">{q}</AccordionTrigger>
                <AccordionContent className="max-w-[62ch] pb-5 text-[15px] leading-relaxed text-[var(--l-ink-2)]">{a}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </BlurFade>
      </Container>
    </section>
  );
}

/* ─────────────────────────────── closing CTA ───────────────────────────── */

function Closing({ d }: { d: D }) {
  return (
    <section data-tone="night" className="relative overflow-hidden bg-[var(--l-night)] text-[var(--l-snow)]">
      <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/2 h-[420px] w-[1100px] -translate-x-1/2 rounded-[50%] bg-[radial-gradient(closest-side,rgb(74_214_176/0.32),rgb(60_80_200/0.22)_55%,transparent)] blur-2xl" />
      <Container className="relative flex flex-col items-center py-32 text-center sm:py-44">
        <DotType as="h2" speed={36} text="The next clutch is already loading." className="serif max-w-[16ch] text-[clamp(2.6rem,6vw,4.8rem)] leading-[1.0] [--l-dot:#8fa6ba]" />
        <BlurFade inView delay={0.3}>
          <p className="mx-auto mt-6 max-w-[44ch] text-[16px] leading-relaxed text-[var(--l-snow-2)]">
            {d.video.length ? `${d.video.length} streams are live right now. ` : ""}Grab free test funds and make your first call before the next round starts.
          </p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Pill href="/live" tone="snow">
              Start watching <ArrowRightIcon size={15} className="transition-transform group-hover:translate-x-0.5" />
            </Pill>
            <Link href="/studio" className="inline-flex h-11 items-center rounded-full px-5 text-[14.5px] font-medium text-[var(--l-snow-2)] ring-1 ring-white/15 transition-colors hover:text-[var(--l-snow)]">
              I&apos;m a streamer
            </Link>
          </div>
        </BlurFade>
      </Container>
    </section>
  );
}

/* ───────────────────────────── latest receipts ─────────────────────────── */

const THUMB: Record<string, string> = {
  YES: "radial-gradient(90% 80% at 30% 20%, #8fe3c8 0%, #2f9d7e 45%, #0f3a30 100%)",
  NO: "radial-gradient(90% 80% at 70% 20%, #ffc1b0 0%, #d8604f 45%, #4a1a14 100%)",
  VOID: "radial-gradient(90% 80% at 50% 10%, #c9c3d8 0%, #8a7fa3 45%, #2f2a3c 100%)",
};

/** Soft verdict-coloured wash over the channel picture, darker at the bottom so the label reads. */
const TINT: Record<string, string> = {
  YES: "linear-gradient(180deg, rgb(47 157 126 / 0.18), rgb(10 30 25 / 0.7))",
  NO: "linear-gradient(180deg, rgb(216 96 79 / 0.18), rgb(40 12 10 / 0.7))",
  VOID: "linear-gradient(180deg, rgb(138 127 163 / 0.18), rgb(25 22 32 / 0.72))",
};

/** The channel the market ran on: its latest frame for video, its board for chess; the gradient shows if neither loads. */
function ReceiptThumb({ s }: { s?: StreamSummary }) {
  if (!s) return null;
  if (s.media?.kind === "video") return <StreamImage s={s} quiet className="absolute inset-0 size-full object-cover" />;
  return (
    <div className="absolute inset-0 grid place-items-center bg-[#2a2622]">
      <div className="pointer-events-none aspect-square h-[120%] -rotate-6 opacity-90">
        <LiveBoard id={`rc-${s.slug}`} fen={s.fen} lastMove={s.lastMove} orientation={s.orientation} animate={false} />
      </div>
    </div>
  );
}

function Receipts({ d }: { d: D }) {
  const list = d.receipts.slice(0, 12);
  const bySlug = new Map(d.list.map((s) => [s.slug, s]));
  return (
    <section data-tone="night" className="border-t border-[var(--l-night-line)] bg-[var(--l-night)] py-24 text-[var(--l-snow)] sm:py-28">
      <Container className="flex items-end justify-between gap-6">
        <DotType as="h2" speed={36} text="Every call, on the record." className="serif text-[clamp(2rem,3.6vw,2.8rem)] leading-tight [--l-dot:#8fa6ba]" />
        <Link href="/live" className="hidden shrink-0 items-center gap-1.5 text-[13.5px] text-[var(--l-snow-2)] hover:text-[var(--l-snow)] sm:inline-flex">
          Watch live <ArrowRightIcon size={13} />
        </Link>
      </Container>
      <div className="relative mt-12">
        {list.length ? (
          <Marquee pauseOnHover className="[--duration:70s] [--gap:1.25rem]">
            {list.map((r) => (
              <Link key={r.marketId} href={`/m/${r.marketId}`} className="group block w-[270px]">
                <div className="relative aspect-[16/10] overflow-hidden rounded-[14px]" style={{ background: THUMB[r.verdict] }}>
                  <ReceiptThumb s={bySlug.get(r.slug)} />
                  <div aria-hidden className="absolute inset-0" style={{ background: TINT[r.verdict] }} />
                  <span className="absolute bottom-3 left-3 rounded-md bg-black/35 px-2 py-0.5 font-mono text-[10.5px] text-white backdrop-blur">{r.verdict === "VOID" ? "Refunded" : `Settled ${r.verdict}`}</span>
                </div>
                <div className="mt-3 font-mono text-[11px] text-[var(--l-snow-3)]">
                  #{r.marketId} · {ago(r.resolvedAt)}
                </div>
                <div className="serif mt-1 line-clamp-2 text-[17px] leading-snug text-[var(--l-snow)]">{r.question}</div>
              </Link>
            ))}
          </Marquee>
        ) : (
          <Container className="grid grid-cols-2 gap-5 md:grid-cols-4">
            {Array.from({ length: 4 }).map((_, k) => (
              <div key={k} className="aspect-[16/10] animate-pulse rounded-[14px] bg-[var(--l-night-2)]" />
            ))}
          </Container>
        )}
        <div aria-hidden className="pointer-events-none absolute inset-y-0 left-0 w-24 bg-gradient-to-r from-[var(--l-night)]" />
        <div aria-hidden className="pointer-events-none absolute inset-y-0 right-0 w-24 bg-gradient-to-l from-[var(--l-night)]" />
      </div>
    </section>
  );
}

/* ────────────────────────────────── footer ─────────────────────────────── */

function Footer({ d }: { d: D }) {
  const up = d.agent ? d.agent.mode === "full" && !d.agent.outOfCredits : undefined;
  const cols: [string, [string, string][]][] = [
    ["Product", [["Live now", "/live"], ["Explore", "/browse"], ["Leaderboard", "/leaderboard"], ["Portfolio", "/portfolio"]]],
    ["Platform", [["How it works", "/how-it-works"], ["Creator studio", "/studio"], ["Liquidity vault", "/vault"], ["Agents", "/agents"]]],
    ["More", [["Responsible play", "/responsible-play"], ["GitHub", REPO]]],
  ];
  return (
    <footer data-tone="night" className="border-t border-[var(--l-night-line)] bg-[var(--l-night)] text-[var(--l-snow)]">
      <Container className="grid grid-cols-2 gap-x-6 gap-y-10 py-16 md:grid-cols-[1.4fr_repeat(3,1fr)] md:gap-12">
        <div className="col-span-2 md:col-span-1">
          <div className="flex items-center gap-2.5">
            <LogoMark className="size-[24px]" accent="#b8f36b" />
            <Wordmark className="text-[15px]" />
          </div>
          <p className="serif mt-4 max-w-[22ch] text-[19px] leading-snug text-[var(--l-snow-2)]">Every moment is a market.</p>
          <span className="mt-6 inline-flex items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-[12px] text-[var(--l-snow-2)] ring-1 ring-white/10">
            <span className={cn("size-1.5 rounded-full", up === undefined ? "bg-white/30" : up ? "bg-[var(--l-yes)]" : "bg-[#f3c16a]")} />
            {up === undefined ? "Checking the AI engine…" : up ? "AI engine live" : "AI engine paused"}
          </span>
        </div>
        {cols.map(([h, links]) => (
          <nav key={h} aria-label={h}>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-[var(--l-snow-3)]">{h}</div>
            <ul className="mt-4 space-y-2.5 text-[14px]">
              {links.map(([l, href]) => (
                <li key={l}>
                  {href.startsWith("http") ? (
                    <a href={href} target="_blank" rel="noreferrer" className="text-[var(--l-snow-2)] transition-colors hover:text-[var(--l-snow)]">
                      {l}
                    </a>
                  ) : (
                    <Link href={href} className="text-[var(--l-snow-2)] transition-colors hover:text-[var(--l-snow)]">
                      {l}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </Container>
      <Container className="flex flex-col gap-3 border-t border-[var(--l-night-line)] py-6 text-[12px] text-[var(--l-snow-3)] sm:flex-row sm:justify-between">
        <span className="flex items-center gap-1.5">
          <ShieldCheckIcon size={13} /> Testnet only. Test USDC has no real-world value.
        </span>
        <span>Built at ETHGlobal Mumbai · 2026</span>
      </Container>
    </footer>
  );
}
