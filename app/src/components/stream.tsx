"use client";

import Link from "next/link";
import { memo, useEffect, useRef, useState } from "react";
import { Chessboard } from "react-chessboard";
import { useTheme } from "next-themes";
import { EyeIcon } from "@phosphor-icons/react";
import type { Player, StreamState, StreamSummary } from "@clutch/shared";
import { Avatar, LiveBadge } from "@/components/brand";
import { api, useNow } from "@/lib/live";
import { cents, clock, compactUsd } from "@/lib/format";
import { cn } from "@/lib/utils";

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
  if (!stream) return <div className="aspect-[4/3] w-full rounded-2xl bg-surface shimmer" />;
  const playing = stream.status === "started";
  const whiteToMove = playing && stream.plies % 2 === 0;
  const blackToMove = playing && stream.plies % 2 === 1;
  const top = stream.orientation === "white" ? "black" : "white";
  const bottom = top === "white" ? "black" : "white";
  const twitch = stream.owner?.twitch;

  const board = (
    <div className={cn("mx-auto w-full", compact ? "max-w-[min(100%,440px)]" : "max-w-[min(100%,calc(100dvh-15rem))]")}>
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
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2">
        {stream.live ? <LiveBadge /> : <span className="rounded-[5px] bg-raised px-1.5 py-px text-[10.5px] font-semibold text-muted-foreground">OFFLINE</span>}
        <span className="flex items-center gap-1 rounded-full bg-background/70 px-2 py-0.5 text-xs text-muted-foreground backdrop-blur">
          <EyeIcon size={13} /> {stream.watching}
        </span>
      </div>
      {twitch ? (
        <div className="grid gap-3 p-3 lg:grid-cols-[1fr_260px]">
          <TwitchPlayer channel={twitch} slug={stream.slug} />
          <div className="hidden lg:block">{board}</div>
        </div>
      ) : (
        <div className="px-4 pb-3 pt-10 sm:px-8">{board}</div>
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

/** Browse card: a live miniature of the game, the channel, and its market if one is open. */
export function ChannelCard({ s, size = "md" }: { s: StreamSummary; size?: "md" | "lg" }) {
  const m = s.market && (s.market.phase === "trading" || s.market.phase === "locked" || s.market.phase === "window") ? s.market : undefined;
  return (
    <Link href={`/c/${s.slug}`} className="group block">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-[radial-gradient(120%_80%_at_50%_0%,var(--raised),var(--sunk))] transition group-hover:border-border-strong">
        <div className={cn("mx-auto py-4", size === "lg" ? "w-[62%]" : "w-[58%]")}>
          <div className={cn("pointer-events-none transition duration-300 group-hover:scale-[1.02]", !s.live && "opacity-40 grayscale")}>
            <LiveBoard id={`thumb-${s.slug}`} fen={s.fen} lastMove={s.lastMove} orientation={s.orientation} animate={false} />
          </div>
        </div>
        <div className="absolute left-3 top-3 flex items-center gap-1.5">
          {s.live && <LiveBadge />}
          {s.live && (
            <span className="flex items-center gap-1 rounded-full bg-background/75 px-1.5 py-0.5 text-[11px] text-muted-foreground backdrop-blur">
              <EyeIcon size={12} /> {s.watching}
            </span>
          )}
        </div>
        {m && (
          <div className="absolute inset-x-3 bottom-3 rounded-xl border border-border bg-background/85 px-3 py-2 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium">{m.question}</span>
              <span className="shrink-0 font-mono text-xs font-semibold text-yes tabular">{cents(m.priceYes)}</span>
            </div>
          </div>
        )}
      </div>
      <div className="mt-3 flex gap-3">
        <Avatar name={s.title} size={36} />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold leading-tight">{s.title}</div>
          <div className="truncate text-xs text-muted-foreground">{s.live && s.white.name ? `${s.white.name} vs ${s.black.name}` : s.subtitle}</div>
          <div className="mt-0.5 text-xs text-faint">
            {s.settledToday} markets today{s.volumeToday > 0 ? ` · ${compactUsd(s.volumeToday)} traded` : ""}
          </div>
        </div>
      </div>
    </Link>
  );
}
