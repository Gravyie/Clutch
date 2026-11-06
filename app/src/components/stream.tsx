"use client";

import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { useTheme } from "next-themes";
import { EyeIcon, ArrowSquareOutIcon, ScanIcon, LightningIcon, TwitchLogoIcon, YoutubeLogoIcon, BroadcastIcon } from "@phosphor-icons/react";
import type { Player, StreamState, StreamSummary } from "@clutch/shared";
import { Avatar, LiveBadge } from "@/components/brand";
import { api, useNow } from "@/lib/live";
import { ENGINE_URL } from "@/lib/env";
import { cents, clock, compact, compactUsd } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const LiveBoard = memo(function LiveBoard({ fen, lastMove, orientation = "white", animate = true, id }: { fen?: string; lastMove?: string; orientation?: "white" | "black"; animate?: boolean; id: string }) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";
  const hl = { background: "rgb(34 211 145 / 0.32)" };
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    squareStyles[lastMove.slice(0, 2)] = { background: "rgb(34 211 145 / 0.2)" };
    squareStyles[lastMove.slice(2, 4)] = hl;
  }
  return (
    <Chessboard
      options={{
        id,
        position: fen ?? START,
        boardOrientation: orientation,
        allowDragging: false,
        showAnimations: animate,
        animationDurationInMs: 180,
        showNotation: animate,
        squareStyles,
        boardStyle: { borderRadius: 10, overflow: "hidden" },
        darkSquareStyle: { backgroundColor: dark ? "#6f7b8a" : "#8a99aa" },
        lightSquareStyle: { backgroundColor: dark ? "#b4bdc8" : "#dde3e9" },
        darkSquareNotationStyle: { color: dark ? "#b4bdc8" : "#dde3e9", fontSize: 10, fontWeight: 600 },
        lightSquareNotationStyle: { color: dark ? "#6f7b8a" : "#8a99aa", fontSize: 10, fontWeight: 600 },
      }}
    />
  );
});

/** Clock that keeps ticking locally between server updates for the side to move. */
function useTickingClock(ms: number | undefined, running: boolean) {
  const [base, setBase] = useState({ ms, at: Date.now() });
  useNow(running ? 200 : 60_000);
  useEffect(() => setBase({ ms, at: Date.now() }), [ms]);
  if (base.ms === undefined) return undefined;
  return running ? Math.max(0, base.ms - (Date.now() - base.at)) : base.ms;
}

export function PlayerStrip({ p, side, toMove }: { p: Player; side: "white" | "black"; toMove: boolean }) {
  const ms = useTickingClock(p.ms, toMove);
  const low = (ms ?? 1e9) < 20_000;
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <div className="flex min-w-0 items-center gap-2.5">
        <span className={cn("size-3 shrink-0 rounded-full ring-1 ring-border-strong", side === "white" ? "bg-zinc-100" : "bg-zinc-800")} aria-label={`${side} pieces`} />
        {p.title && <span className="rounded bg-warn-soft px-1 text-[11px] font-bold text-warn">{p.title}</span>}
        <span className="truncate text-sm font-semibold">{p.name || "Waiting for game"}</span>
        {p.rating ? <span className="text-xs text-faint tabular">{p.rating}</span> : null}
      </div>
      <span
        className={cn(
          "min-w-[68px] rounded-lg px-2.5 py-1 text-center font-mono text-[15px] font-medium tabular transition-colors",
          toMove ? (low ? "bg-no text-white" : "bg-foreground text-background") : "bg-raised text-muted-foreground",
        )}
      >
        {clock(ms)}
      </span>
    </div>
  );
}

/** The stage: the live game on a broadcast backdrop, or the streamer's Twitch with the board picture-in-picture. */
export function StreamStage({ stream, overlay, compact }: { stream?: StreamState; overlay?: React.ReactNode; compact?: boolean }) {
  if (!stream) return <div className="aspect-video w-full rounded-2xl bg-surface shimmer" />;
  if (stream.media?.kind === "video") return <VideoStage stream={stream} />;
  const playing = stream.status === "started";
  const whiteToMove = playing && stream.plies % 2 === 0;
  const blackToMove = playing && stream.plies % 2 === 1;
  const top = stream.orientation === "white" ? "black" : "white";
  const bottom = top === "white" ? "black" : "white";
  const twitch = stream.owner?.twitch;

  const board = (
    <div className={cn("mx-auto w-full", compact ? "max-w-[min(100%,440px)]" : "max-w-[min(100%,calc(100dvh-20.5rem),32rem)] xl:max-w-[min(100%,calc(100dvh-20.5rem))]")}>
      <PlayerStrip p={stream[top]} side={top} toMove={top === "white" ? whiteToMove : blackToMove} />
      <div className="relative">
        <LiveBoard id={`board-${stream.slug}`} fen={stream.fen} lastMove={stream.lastMove} orientation={stream.orientation} />
        {!stream.live && (
          <div className="absolute inset-0 grid place-items-center rounded-[10px] bg-background/70 backdrop-blur-sm">
            <div className="text-center">
              <div className="text-sm font-semibold">{stream.kind === "lichess-user" ? "Not playing right now" : "Waiting for the next game"}</div>
              <div className="mt-1 text-xs text-muted-foreground">{stream.kind === "lichess-user" ? "The channel goes live when they start a game on Lichess." : "A new game starts in a moment."}</div>
            </div>
          </div>
        )}
      </div>
      <PlayerStrip p={stream[bottom]} side={bottom} toMove={bottom === "white" ? whiteToMove : blackToMove} />
    </div>
  );

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-[radial-gradient(120%_80%_at_50%_0%,var(--raised),var(--sunk))]">
      {compact && (
        <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
          {stream.live ? <LiveBadge /> : <span className="rounded-[5px] bg-raised px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">OFFLINE</span>}
          <span className="flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-xs text-muted-foreground backdrop-blur">
            <EyeIcon size={13} /> {stream.watching}
          </span>
        </div>
      )}
      {twitch ? (
        <div className="grid gap-3 p-3 lg:grid-cols-[1fr_260px]">
          <TwitchPlayer channel={twitch} slug={stream.slug} />
          <div className="hidden lg:block">{board}</div>
        </div>
      ) : (
        <div className={cn("px-3 pb-2 sm:px-8", compact ? "pt-10" : "pt-2 sm:pt-3")}>{board}</div>
      )}
      {overlay}
    </div>
  );
}

/** Twitch player. Reports viewer latency so the engine can widen the onchain buffer for slow viewers. */
function TwitchPlayer({ channel, slug }: { channel: string; slug: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = "twitch-embed-js";
    let timer: ReturnType<typeof setInterval> | undefined;
    const init = () => {
      const T = (window as any).Twitch;
      if (!T || !ref.current) return;
      ref.current.innerHTML = "";
      const embed = new T.Embed(ref.current, { width: "100%", height: "100%", channel, layout: "video", muted: true, parent: [location.hostname] });
      embed.addEventListener(T.Embed.VIDEO_READY, () => {
        const player = embed.getPlayer();
        timer = setInterval(() => {
          const s = player.getPlaybackStats?.();
          if (s?.hlsLatencyBroadcaster) void api("/telemetry/latency", { body: { slug, ms: s.hlsLatencyBroadcaster * 1000 } }).catch(() => {});
        }, 15_000);
      });
    };
    if (!document.getElementById(id)) {
      const s = document.createElement("script");
      s.id = id;
      s.src = "https://embed.twitch.tv/embed/v1.js";
      s.onload = init;
      document.body.appendChild(s);
    } else init();
    return () => clearInterval(timer);
  }, [channel, slug]);
  return <div ref={ref} className="aspect-video w-full overflow-hidden rounded-xl bg-black" />;
}

export const PlatformIcon = ({ p, size = 14 }: { p?: string; size?: number }) =>
  p === "kick" ? <LightningIcon size={size} weight="fill" /> : p === "youtube" ? <YoutubeLogoIcon size={size} weight="fill" /> : p === "twitch" ? <TwitchLogoIcon size={size} weight="fill" /> : <BroadcastIcon size={size} />;

export const platformUrl = (s: StreamSummary) =>
  s.media?.kind !== "video" ? undefined : s.media.platform === "twitch" ? `https://twitch.tv/${s.media.channel}` : s.media.platform === "kick" ? `https://kick.com/${s.media.channel}` : s.media.channel.startsWith("@") ? `https://youtube.com/${s.media.channel}/live` : `https://youtube.com/watch?v=${s.media.channel}`;

/** The engine's latest captured frame: literally what the AI is looking at. */
export const frameUrl = (s: StreamSummary) => (s.frameAt ? `${ENGINE_URL}/frames/${s.slug}.jpg?t=${Math.floor(s.frameAt / 3000)}` : undefined);

/** A live video channel: the platform's own player, with what the AI reads from it underneath. */
function VideoStage({ stream }: { stream: StreamState }) {
  const m = stream.media as Extract<StreamState["media"], { kind: "video" }>;
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-black">
      <div className="relative aspect-video w-full">
        {!stream.live ? (
          <Offline s={stream} />
        ) : m.platform === "twitch" ? (
          <TwitchPlayer channel={m.channel} slug={stream.slug} />
        ) : m.platform === "kick" ? (
          <iframe src={`https://player.kick.com/${m.channel}?autoplay=true&muted=true`} className="absolute inset-0 size-full" allow="autoplay; fullscreen" allowFullScreen title={`${m.channel} on Kick`} />
        ) : /^[\w-]{11}$/.test(m.channel) ? (
          <iframe src={`https://www.youtube.com/embed/${m.channel}?autoplay=1&mute=1`} className="absolute inset-0 size-full" allow="autoplay; fullscreen; picture-in-picture" allowFullScreen title="YouTube live" />
        ) : (
          <Offline s={stream} message="Watch on YouTube" />
        )}
        <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2">
          {/* Twitch's player draws its own LIVE badge and title; ours would sit on top of them. */}
          {stream.live && m.platform !== "twitch" && <LiveBadge />}
          {stream.rerun && <span className="rounded-[5px] bg-warn px-1.5 py-px text-[10.5px] font-semibold text-black">RERUN · NO MARKETS</span>}
        </div>
      </div>
      <VisionBar s={stream} />
    </div>
  );
}

function Offline({ s, message }: { s: StreamSummary; message?: string }) {
  const f = frameUrl(s);
  return (
    <div className="absolute inset-0 grid place-items-center bg-[radial-gradient(120%_80%_at_50%_0%,var(--raised),var(--sunk))]">
      {f && <img src={f} alt="" className="absolute inset-0 size-full object-cover opacity-30 blur-sm" />}
      <div className="relative text-center">
        <div className="mx-auto grid size-12 place-items-center rounded-full bg-raised">
          <PlatformIcon p={s.media?.kind === "video" ? s.media.platform : undefined} size={22} />
        </div>
        <div className="mt-3 text-sm font-semibold">{message ?? `${s.title} is offline`}</div>
        <div className="mt-1 text-xs text-muted-foreground">Markets open automatically when they go live.</div>
        {platformUrl(s) && (
          <a href={platformUrl(s)} target="_blank" rel="noreferrer" className="pointer-events-auto mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            Open channel <ArrowSquareOutIcon size={12} />
          </a>
        )}
      </div>
    </div>
  );
}

/** "AI vision": the engine's reading of the latest frame, so viewers can see exactly what markets are judged on. */
export function VisionBar({ s }: { s: StreamSummary }) {
  const v = s.vision;
  const now = useNow(1000);
  const st = v?.state;
  const score = st && st.scoreA !== null && st.scoreB !== null ? `${st.teamA ?? "Left"} ${st.scoreA} : ${st.scoreB} ${st.teamB ?? "Right"}` : st?.remaining !== null && st?.remaining !== undefined ? `${st.remaining} left` : null;
  const clockText = st?.clock !== null && st?.clock !== undefined ? `${Math.floor(st.clock / 60)}:${String(st.clock % 60).padStart(2, "0")}` : null;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-white/10 bg-surface px-4 py-2.5 text-xs">
      <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
        <ScanIcon size={15} className={cn(v && now * 1000 - v.at < 20_000 ? "text-yes" : "text-faint")} /> AI vision
      </span>
      {!v ? (
        <span className="text-faint">{s.live ? (s.rerun ? "Not reading reruns: the result already happened." : "Waiting for a reader slot…") : "Offline"}</span>
      ) : (
        <>
          <span className={cn("rounded-md px-1.5 py-0.5 font-medium", st?.mode === "gameplay" ? "bg-yes-soft text-yes" : "bg-raised text-muted-foreground")}>{st?.mode}</span>
          {score && <span className="font-mono font-medium tabular text-foreground">{score}</span>}
          {clockText && <span className="font-mono tabular text-muted-foreground">{clockText}</span>}
          {st?.bomb === "planted" && <span className="rounded-md bg-no-soft px-1.5 py-0.5 font-medium text-no">bomb planted</span>}
          <span className="min-w-0 flex-1 truncate text-faint">{st?.summary}</span>
          <span className="text-faint tabular">{Math.max(0, Math.round(now - v.at / 1000))}s ago</span>
        </>
      )}
    </div>
  );
}

/**
 * Explore tile, sized by what it shows so a masonry feed packs tightly: live video is 16:9, a chess board is square,
 * an offline channel is a compact row. An open market sits under the picture, never over it.
 */
/** Relative tile height at unit width, for the masonry layout. */
export function channelCardHeight(s: StreamSummary) {
  const m = s.market && (s.market.phase === "trading" || s.market.phase === "locked" || s.market.phase === "window");
  if (!s.live) return 0.2;
  return (s.media?.kind === "video" ? 0.5625 : 1.06) + 0.25 + (m ? 0.14 : 0);
}

export function ChannelCard({ s }: { s: StreamSummary; size?: "md" | "lg" }) {
  const m = s.market && (s.market.phase === "trading" || s.market.phase === "locked" || s.market.phase === "window") ? s.market : undefined;
  const video = s.media?.kind === "video";
  const thumb = video && s.live ? (frameUrl(s) ?? (s.media?.kind === "video" && s.media.platform === "twitch" ? `https://static-cdn.jtvnw.net/previews-ttv/live_user_${s.media.channel}-640x360.jpg` : undefined)) : undefined;
  const sub = video ? (s.live ? (s.streamTitle ?? s.subtitle) : "Offline") : s.live && s.white.name ? `${s.white.name} vs ${s.black.name}` : s.subtitle;
  const offline = !s.live;
  const [broken, setBroken] = useState<string>();

  return (
    <Link href={`/c/${s.slug}`} className="group block min-w-0 outline-none" aria-label={`${s.title}${s.live ? ", live" : ", offline"}${m ? `, market: ${m.question}` : ""}`}>
      <Card className="gap-0 overflow-hidden py-0 transition duration-200 group-hover:-translate-y-0.5 group-hover:border-border-strong group-hover:shadow-md group-focus-visible:ring-2 group-focus-visible:ring-ring">
        {!offline && (
          <div className="relative overflow-hidden bg-secondary">
            {video ? (
              <div className="relative aspect-video">
                {thumb && broken !== thumb ? (
                  <img src={thumb} alt="" loading="lazy" onError={() => setBroken(thumb)} className="absolute inset-0 size-full object-cover" />
                ) : (
                  <div className="absolute inset-0 grid place-items-center text-faint">
                    <PlatformIcon p={s.media?.kind === "video" ? s.media.platform : undefined} size={26} />
                  </div>
                )}
              </div>
            ) : (
              <div className="bg-[radial-gradient(120%_90%_at_50%_0%,var(--raised),var(--sunk))] p-3 pt-10">
                <div className="pointer-events-none overflow-hidden rounded-[10px]">
                  <LiveBoard id={`thumb-${s.slug}`} fen={s.fen} lastMove={s.lastMove} orientation={s.orientation} animate={false} />
                </div>
              </div>
            )}
            <div className="absolute left-2.5 top-2.5 flex flex-wrap items-center gap-1.5">
              <LiveBadge />
              {s.rerun && <Badge className="h-[18px] rounded-[5px] bg-warn px-1.5 text-[10.5px] font-bold text-black">RERUN</Badge>}
              <Badge variant="secondary" className="h-[18px] gap-1 rounded-full bg-background/80 px-1.5 text-[11px] font-normal backdrop-blur">
                <EyeIcon /> {s.platformViewers ? compact(s.platformViewers) : s.watching}
              </Badge>
              {s.reading && (
                <Badge className="h-[18px] gap-1 rounded-full bg-yes px-1.5 text-[11px] text-[#04140f]">
                  <ScanIcon weight="bold" /> AI watching
                </Badge>
              )}
            </div>
          </div>
        )}

        {m && (
          <div className="flex items-center gap-2 border-b bg-secondary/40 px-3.5 py-2.5">
            <span className={cn("size-1.5 shrink-0 rounded-full", m.phase === "trading" ? "animate-live bg-live" : "bg-warn")} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium">{m.question}</span>
            {m.phase === "trading" ? (
              <Badge className="shrink-0 rounded-full bg-yes-soft font-mono text-yes tabular">Yes {cents(m.priceYes)}</Badge>
            ) : (
              <Badge variant="outline" className="shrink-0 rounded-full border-warn/30 text-warn">
                Locked
              </Badge>
            )}
          </div>
        )}

        <div className={cn("flex gap-3 px-3.5", offline ? "items-center py-3" : "py-3")}>
          <Avatar name={s.title} size={offline ? 32 : 36} className={cn(offline && "opacity-60 grayscale")} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-semibold leading-tight">{s.title}</span>
              {video && <PlatformIcon p={s.media?.kind === "video" ? s.media.platform : undefined} size={12} />}
            </div>
            {!offline && <div className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{sub}</div>}
            <div className="mt-0.5 truncate text-xs text-faint">
              {[s.game, s.settledToday ? `${s.settledToday} markets today` : null, s.volumeToday > 0 ? `${compactUsd(s.volumeToday)} traded` : null].filter(Boolean).join(" · ")}
            </div>
          </div>
          {offline && (
            <Badge variant="outline" className="shrink-0 rounded-full text-faint">
              Offline
            </Badge>
          )}
        </div>
      </Card>
    </Link>
  );
}
