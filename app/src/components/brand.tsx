import { cn } from "@/lib/utils";
import { hueOf } from "@/lib/format";

/**
 * The Clutch mark: a "C" folded from three flat planes, catching a diamond (the moment) in its opening.
 * No tile: it is drawn in currentColor so it sits on any surface, and only the diamond carries the brand accent.
 * Same drawing as app/icon.svg.
 */
export function LogoMark({ className, accent = "var(--brand)" }: { className?: string; accent?: string }) {
  return (
    <svg viewBox="0 0 32 32" fill="currentColor" className={cn("size-6 shrink-0", className)} aria-hidden>
      <polygon points="5,5 27,5 22.2,10.2 10.2,10.2" />
      <polygon points="5,5.9 9.3,10.2 9.3,21.8 5,26.1" opacity=".72" />
      <polygon points="5,27 10.2,21.8 22.2,21.8 27,27" />
      <polygon points="22.5,12.4 26.1,16 22.5,19.6 18.9,16" fill={accent} />
    </svg>
  );
}

/** Mark plus the tracked uppercase wordmark. */
export function Logo({ className, accent }: { className?: string; accent?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-[22px]" accent={accent} />
      <Wordmark />
    </span>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("mr-[-0.32em] text-[14.5px] font-semibold leading-none tracking-[0.32em]", className)}>CLUTCH</span>;
}

export function LiveBadge({ className, label = "LIVE" }: { className?: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[5px] bg-live px-1.5 py-[1px] text-[10.5px] font-bold tracking-wide text-[#1a0703]", className)}>
      <span className="size-1 animate-live rounded-full bg-current" aria-hidden />
      {label}
    </span>
  );
}

/** Generated avatar: initials on a hue derived from the name. No stock photos, no egg icons. */
export function Avatar({ name, size = 32, className }: { name: string; size?: number; className?: string }) {
  const h = hueOf(name || "?");
  const initials = (name || "?").replace(/^0x/, "").slice(0, 2).toUpperCase();
  return (
    <span
      className={cn("inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-1 ring-black/5", className)}
      style={{ width: size, height: size, fontSize: size * 0.38, background: `linear-gradient(135deg, hsl(${h} 62% 46%), hsl(${(h + 40) % 360} 58% 34%))` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
