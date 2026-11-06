import { cn } from "@/lib/utils";
import { hueOf } from "@/lib/format";

/**
 * The Clutch mark: a tilted "C" catching a dot (the moment) inside two viewfinder corners (the frame that catches it).
 * Signal lime and ink in every theme, so the brand reads the same everywhere. Same drawing as app/icon.svg.
 */
export function LogoMark({ className, frame = true }: { className?: string; frame?: boolean }) {
  return (
    <svg viewBox="0 0 64 64" className={cn("size-7 shrink-0", className)} aria-hidden>
      <rect width="64" height="64" rx="16" fill="#b8f36b" />
      {frame && <path d="M47 9H55V17M9 47V55H17" fill="none" stroke="#101808" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />}
      <g transform="rotate(-14 32 32)">
        <path d="M40.4 22.63A14 14 0 1 0 40.4 41.37" fill="none" stroke="#101808" strokeWidth="8.5" strokeLinecap="round" />
        <circle cx="46.5" cy="32" r="5.2" fill="#101808" />
      </g>
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark className="size-8" />
      <span className="text-[21px] font-extrabold leading-none tracking-[-0.06em]">
        clutch<span className="text-brand">.</span>
      </span>
    </span>
  );
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
