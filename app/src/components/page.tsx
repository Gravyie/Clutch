"use client";

import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react";
import { DotType } from "@/components/dot-type";
import { BlurFade } from "@/components/ui/blur-fade";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/*
  The app's page vocabulary, taken from the landing page so every screen reads the same way:
  a serif title that types itself in, one quiet line of context, actions on the right,
  pill switchers on a soft track, and related numbers grouped in one card.
*/

/** Page width and rhythm. "wide" is for grids of streams; everything else reads better narrower. */
export function PageShell({ children, wide, className }: { children: React.ReactNode; wide?: boolean; className?: string }) {
  return <div className={cn("mx-auto w-full px-4 pb-24 pt-8 sm:px-8 sm:pt-12", wide ? "max-w-[1560px]" : "max-w-[1180px]", className)}>{children}</div>;
}

export function PageHeader({ eyebrow, title, description, actions, className }: { eyebrow?: React.ReactNode; title: string; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <header className={cn("flex flex-col gap-6 pb-9 md:flex-row md:items-end md:justify-between md:gap-10 sm:pb-12", className)}>
      <div className="min-w-0">
        {eyebrow && (
          <BlurFade inView={false} delay={0.02}>
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-card px-3 py-1.5 text-[12.5px] text-muted-foreground shadow-[0_1px_0_rgb(255_255_255/0.6)_inset] ring-1 ring-border">{eyebrow}</div>
          </BlurFade>
        )}
        <DotType as="h1" start speed={34} text={title} className="display text-[clamp(2.5rem,4.6vw,3.6rem)] leading-[1.02]" />
        {description && (
          <BlurFade inView={false} delay={0.25}>
            <p className="mt-4 max-w-[58ch] text-[15.5px] leading-relaxed text-muted-foreground">{description}</p>
          </BlurFade>
        )}
      </div>
      {actions && (
        <BlurFade inView={false} delay={0.3} className="flex shrink-0 flex-wrap items-center gap-2.5">
          {actions}
        </BlurFade>
      )}
    </header>
  );
}

/** A small live dot for eyebrows. */
export function LiveDot({ tone = "live" }: { tone?: "live" | "yes" | "warn" }) {
  const c = tone === "live" ? "bg-live" : tone === "yes" ? "bg-yes" : "bg-warn";
  return (
    <span className="relative flex size-1.5">
      <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", c)} />
      <span className={cn("relative inline-flex size-1.5 rounded-full", c)} />
    </span>
  );
}

export function SectionHeader({ title, href, link = "See all", description, className }: { title: string; href?: string; link?: string; description?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("mb-6 flex items-end justify-between gap-6", className)}>
      <div className="min-w-0">
        <DotType as="h2" speed={30} text={title} className="display text-[clamp(1.8rem,2.8vw,2.25rem)]" />
        {description && <p className="mt-1.5 text-[14px] text-muted-foreground">{description}</p>}
      </div>
      {href && (
        <Link href={href} className="group inline-flex shrink-0 items-center gap-1.5 text-[13.5px] text-muted-foreground transition-colors hover:text-foreground">
          {link} <ArrowRightIcon size={13} className="transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}
    </div>
  );
}

/** Pill switcher on a soft track, the same control the landing uses for its stake picker. */
export function Segmented<T extends string>({ value, onChange, options, label, className }: { value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode; count?: number }[]; label: string; className?: string }) {
  return (
    <div className={cn("scrollbar-none -mx-1 max-w-full overflow-x-auto px-1 max-sm:pr-8 max-sm:[mask-image:linear-gradient(90deg,#000_82%,transparent)]", className)}>
      <ToggleGroup type="single" value={value} onValueChange={(v) => v && onChange(v as T)} aria-label={label} className="inline-flex h-10 w-max gap-0.5 rounded-full bg-secondary p-1">
        {options.map((o) => (
          <ToggleGroupItem
            key={o.value}
            value={o.value}
            className="h-8 !rounded-full px-3.5 text-[13px] font-medium text-muted-foreground transition-all hover:bg-transparent hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
          >
            {o.label}
            {o.count ? <span className="ml-1 text-[11.5px] tabular-nums text-faint">{o.count}</span> : null}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** Related numbers in one card with hairline dividers, instead of a row of separate boxes. */
export function StatStrip({ items, className }: { items: { label: string; value?: React.ReactNode; hint?: string }[]; className?: string }) {
  return (
    <BlurFade inView delay={0.05} className={cn("grid grid-cols-2 overflow-hidden rounded-[20px] bg-card shadow-[var(--shadow-card)] ring-1 ring-border md:grid-cols-4", className)}>
      {items.map((it, i) => (
        <div key={it.label} className={cn("px-5 py-5 sm:px-6 sm:py-6", i % 2 === 1 && "border-l border-border", i >= 2 && "border-t border-border md:border-t-0", i === 2 && "md:border-l")}>
          <div className="text-[12.5px] text-muted-foreground">{it.label}</div>
          <div className="display mt-2 text-[2.2rem] leading-none tabular-nums sm:text-[2.5rem]">{it.value ?? <span className="inline-block h-8 w-16 animate-pulse rounded-md bg-secondary align-middle" />}</div>
          {it.hint && <div className="mt-1.5 text-[12px] text-faint">{it.hint}</div>}
        </div>
      ))}
    </BlurFade>
  );
}

/** A calm, solid inline notice (no dashed boxes). */
export function Notice({ icon, title, children, action, className }: { icon?: React.ReactNode; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <BlurFade inView delay={0.08} className={cn("flex flex-col gap-4 rounded-[18px] bg-secondary/60 px-5 py-4 sm:flex-row sm:items-center", className)}>
      <div className="flex min-w-0 flex-1 items-start gap-3.5">
        {icon && <span className="grid size-9 shrink-0 place-items-center rounded-full bg-card text-muted-foreground ring-1 ring-border">{icon}</span>}
        <div className="min-w-0">
          <div className="text-[14.5px] font-medium">{title}</div>
          {children && <div className="mt-0.5 text-[13.5px] leading-relaxed text-muted-foreground">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </BlurFade>
  );
}

/** Fades a section up as it scrolls into view, like the landing. */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  return (
    <BlurFade inView delay={delay} className={className}>
      {children}
    </BlurFade>
  );
}
