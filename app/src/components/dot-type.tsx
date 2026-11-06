"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Dot-matrix type-in. Text writes itself left to right: a small cluster of dots leads, the next few letters appear as
 * stippled glyphs, and they settle into solid ink a beat later. Layout is reserved up front, so nothing reflows.
 * Fires once when scrolled into view. Screen readers get the plain sentence; reduced motion shows it immediately.
 */
export function DotType({
  text,
  as: Tag = "span",
  className,
  speed = 34,
  delay = 0,
  trail = 4,
  start,
}: {
  text: string;
  as?: "h1" | "h2" | "h3" | "p" | "span" | "div";
  className?: string;
  /** milliseconds per character */
  speed?: number;
  /** milliseconds before typing begins once visible */
  delay?: number;
  /** how many stippled letters run ahead of the solid ones */
  trail?: number;
  /** start immediately instead of on scroll into view */
  start?: boolean;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const [go, setGo] = useState(false);
  const [n, setN] = useState(0);
  const total = text.length;

  useEffect(() => {
    if (start) return setGo(true);
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          setGo(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -12% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [start]);

  // Progress comes from elapsed time on animation frames, so a slow frame skips ahead instead of dragging the text.
  useEffect(() => {
    if (!go || reduce) return;
    let raf = 0;
    const t0 = performance.now() + delay;
    const end = total + trail;
    const frame = (t: number) => {
      const k = Math.min(end, Math.max(0, Math.floor((t - t0) / speed)));
      setN((prev) => (prev === k ? prev : k));
      if (k < end) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [go, reduce, total, trail, speed, delay]);

  const done = reduce || n >= total + trail;
  const solid = reduce ? total : Math.max(0, n - trail);
  const head = Math.min(total, n);

  // words stay unbroken, so the reserved layout wraps exactly like the final text
  let idx = 0;
  const words = text.split(/(\s+)/);

  return (
    <Tag ref={ref as never} className={cn("relative", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {words.map((w, wi) => {
          if (/^\s+$/.test(w)) {
            idx += w.length;
            return <span key={wi}>{w}</span>;
          }
          return (
            <span key={wi} className="inline-block whitespace-nowrap">
              {Array.from(w).map((ch) => {
                const i = idx++;
                const state = done || i < solid ? "solid" : i < head ? "stipple" : "hidden";
                return (
                  <span key={i} className={cn("relative", state === "stipple" && "stipple", state === "hidden" && "text-transparent")}>
                    {ch}
                    {!done && i === head && <Cursor />}
                  </span>
                );
              })}
            </span>
          );
        })}
        {!done && head >= total && (
          <span className="relative">
            <Cursor />
          </span>
        )}
      </span>
    </Tag>
  );
}

/** The leading cluster: two round dots, a small one, and a fine dot grid. */
function Cursor() {
  return (
    <svg viewBox="0 0 44 14" className="pointer-events-none absolute left-0 top-1/2 h-[0.34em] w-auto -translate-y-[10%] overflow-visible" aria-hidden>
      <g fill="var(--l-dot, #7c93a6)">
        <circle cx="3" cy="9" r="3" />
        <circle cx="8.5" cy="5.5" r="1.4" />
        <circle cx="13.5" cy="9" r="3" className="animate-pulse" />
        <circle cx="18.5" cy="5" r="1.2" />
        {[0, 1, 2].map((r) =>
          [0, 1, 2, 3].map((c) => <circle key={`${r}-${c}`} cx={25 + c * 4.6} cy={3 + r * 4.4} r="1.25" opacity={0.55 + 0.15 * ((r + c) % 3)} />),
        )}
      </g>
    </svg>
  );
}
