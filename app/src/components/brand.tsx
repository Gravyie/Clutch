import { cn } from "@/lib/utils";
import { hueOf } from "@/lib/format";

/** The Clutch mark: a rounded tile with a notch, the moment cut out of a frame. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="9" className="fill-foreground" />
      <path d="M21.5 11.2a7 7 0 1 0 0 9.6" fill="none" strokeWidth="3.4" strokeLinecap="round" className="stroke-background" />
      <circle cx="23" cy="16" r="2.2" className="fill-brand" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark />
      <span className="text-[17px] font-semibold tracking-tight">Clutch</span>
    </span>
  );
}

export function LiveBadge({ className, label = "LIVE" }: { className?: string; label?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-[5px] bg-live px-1.5 py-[1px] text-[10.5px] font-semibold tracking-wide text-white", className)}>
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
