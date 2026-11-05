"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import { LogoMark } from "@/components/brand";
import { useChannel, useLive, useNow } from "@/lib/live";
import { cents } from "@/lib/format";

/**
 * OBS browser source (1920×1080, transparent). The live market and a QR to trade it; hides between markets,
 * leaving a small station bug. CSS animations only: OBS may throttle animation frames for background sources.
 */
export default function Overlay() {
  const { slug } = useParams<{ slug: string }>();
  useChannel("global");
  const summary = useLive((s) => s.streams[slug]);
  const market = useLive((s) => (summary?.market ? s.markets[summary.market.id] : undefined));
  const now = useNow(500);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    document.body.classList.add("overlay");
    document.documentElement.classList.add("dark");
    setOrigin(location.origin);
  }, []);
  const show = market && market.phase !== "void" && !(market.phase === "settled" && now - market.windowEnd > 30);
  const p = market?.priceYes ?? 0.5;

  return (
    <div className="pointer-events-none fixed inset-0 font-sans text-white">
      <div className="absolute left-10 top-8 flex items-center gap-2 rounded-xl bg-black/60 px-3 py-2 backdrop-blur">
        <LogoMark className="size-6" />
        <span className="text-base font-semibold tracking-tight">Clutch</span>
      </div>
      {show && market && (
        <div key={market.id} className="overlay-in absolute bottom-10 left-10 flex w-[640px] gap-5 rounded-2xl border border-white/10 bg-black/80 p-5 backdrop-blur-md">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              {market.phase === "trading" ? (
                <>
                  <span className="rounded bg-[#ff3347] px-1.5 py-px text-xs font-bold">LIVE</span>
                  <span className="text-white/70">Locks in {Math.max(0, Math.ceil(market.lockTime - now))}s</span>
                </>
              ) : market.phase === "settled" ? (
                <span className="text-white/70">Resolved {market.outcome === "YES" ? "Yes" : "No"}</span>
              ) : (
                <span className="text-white/70">Trading closed · playing out</span>
              )}
            </div>
            <div className="mt-2 text-[30px] font-semibold leading-tight tracking-tight">{market.question}</div>
            <div className="mt-4 flex items-baseline justify-between">
              <span className="text-3xl font-semibold text-[#22d391] tabular">Yes {cents(p)}</span>
              <span className="text-3xl font-semibold text-[#ff5a76] tabular">No {cents(1 - p)}</span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-[#ff5a76]/80">
              <div className="h-full bg-[#22d391] transition-[width] duration-500" style={{ width: `${p * 100}%` }} />
            </div>
          </div>
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="rounded-xl bg-white p-2">
              <QRCodeSVG value={`${origin}/c/${slug}`} size={116} bgColor="#ffffff" fgColor="#09090b" />
            </div>
            <span className="text-xs font-medium text-white/70">Scan to play</span>
          </div>
        </div>
      )}
    </div>
  );
}
