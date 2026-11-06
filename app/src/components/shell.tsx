"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import NumberFlow from "@number-flow/react";
import { Command } from "cmdk";
import {
  BroadcastIcon,
  ChartLineUpIcon,
  CompassIcon,
  CopyIcon,
  GearSixIcon,
  MagnifyingGlassIcon,
  MoonIcon,
  PlusIcon,
  RobotIcon,
  SignOutIcon,
  SunIcon,
  TrophyIcon,
  VaultIcon,
  WalletIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { StreamSummary } from "@clutch/shared";
import { Avatar, LiveBadge, Logo } from "@/components/brand";
import { Onboarding } from "@/components/onboarding";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccount } from "@/lib/account";
import { useLive } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { useWallet } from "@/lib/wallet";
import { cents, compact, short } from "@/lib/format";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/live", label: "Live", icon: BroadcastIcon },
  { href: "/browse", label: "Browse", icon: CompassIcon },
  { href: "/portfolio", label: "Portfolio", icon: ChartLineUpIcon },
  { href: "/leaderboard", label: "Leaderboard", icon: TrophyIcon },
  { href: "/agents", label: "Agents", icon: RobotIcon },
];

/** Live markets first, then live video, then live chess, then offline; audience breaks ties. */
export function channelRank(a: StreamSummary, b: StreamSummary) {
  const score = (s: StreamSummary) =>
    (s.slug === "replay" ? -8e9 : 0) + // the offline demo replay never outranks a real live stream
    (s.market?.phase === "trading" ? 4e9 : 0) + (s.reading ? 2e9 : 0) + (s.live && !s.rerun ? 1e9 : 0) + (s.media?.kind === "video" ? 5e8 : 0) + (s.platformViewers ?? 0) + s.watching * 1000;
  return score(b) - score(a);
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh">
      <TopBar />
      <div className="flex">
        <SideRail />
        <main className="min-w-0 flex-1 pb-20 lg:pb-0">{children}</main>
      </div>
      <MobileNav />
      <Onboarding />
      <CommandMenu />
    </div>
  );
}

function TopBar() {
  const wallet = useWallet();
  const acct = useAccount();
  const open = useUI((s) => s.openOnboarding);
  const setCommand = useUI((s) => s.setCommand);
  const chain = useLive((s) => s.chain);
  const connected = useLive((s) => s.connected);
  return (
    <header className="sticky top-0 z-40 h-14 border-b border-border bg-background/80 backdrop-blur-xl">
      <div className="flex h-full items-center gap-3 px-3 sm:px-4">
        <Link href="/" className="flex w-[216px] shrink-0 items-center" aria-label="Clutch home">
          <Logo />
        </Link>
        <button
          onClick={() => setCommand(true)}
          className="hidden h-9 w-full max-w-[420px] items-center gap-2 rounded-[10px] border border-border bg-raised px-3 text-sm text-faint transition hover:border-border-strong md:flex"
        >
          <MagnifyingGlassIcon size={16} />
          Search channels and markets
          <kbd className="ml-auto rounded-md border border-border px-1.5 font-mono text-[11px]">⌘K</kbd>
        </button>
        <div className="ml-auto flex items-center gap-2">
          {chain && chain.sequencerPhase !== "Normal" && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden items-center gap-1.5 rounded-full bg-warn-soft px-2.5 py-1 text-xs font-medium text-warn sm:flex">
                  <WarningIcon size={14} weight="fill" /> Chain {chain.sequencerPhase.toLowerCase()}
                </span>
              </TooltipTrigger>
              <TooltipContent>Blackout Guard paused trading until the L2 sequencer is healthy again.</TooltipContent>
            </Tooltip>
          )}
          {!connected && <span className="hidden text-xs text-faint sm:inline">Reconnecting…</span>}
          {wallet.address ? (
            <>
              <button onClick={() => !acct.onboarded && open()} className="flex h-9 items-center gap-2 rounded-[10px] border border-border bg-raised px-3 text-sm">
                <WalletIcon size={16} className="text-muted-foreground" />
                <NumberFlow value={acct.spendable} format={{ style: "currency", currency: "USD" }} className="font-medium tabular" />
              </button>
              {!acct.onboarded && (
                <Button size="sm" className="h-9 rounded-full bg-brand px-4 font-semibold text-brand-foreground hover:bg-brand/90" onClick={() => open()}>
                  Finish setup
                </Button>
              )}
              <AccountMenu />
            </>
          ) : (
            <Button size="sm" className="h-9 rounded-full bg-brand px-5 font-semibold text-brand-foreground hover:bg-brand/90" onClick={() => open()} disabled={!wallet.ready}>
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function AccountMenu() {
  const wallet = useWallet();
  const acct = useAccount();
  const { resolvedTheme, setTheme } = useTheme();
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="rounded-full outline-none ring-offset-2 ring-offset-background focus-visible:ring-2" aria-label="Account">
        <Avatar name={wallet.address ?? "?"} size={34} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64 rounded-xl border-border bg-surface p-1.5">
        <DropdownMenuLabel className="font-normal">
          <div className="text-sm font-medium">{wallet.label ?? "Your wallet"}</div>
          <div className="font-mono text-xs text-faint">{short(wallet.address, 8)}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/portfolio")}>
          <ChartLineUpIcon /> Portfolio
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/account")}>
          <GearSixIcon /> Account and limits
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/studio")}>
          <BroadcastIcon /> Creator studio
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/vault")}>
          <VaultIcon /> Liquidity vault
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => (navigator.clipboard.writeText(wallet.address ?? ""), toast.success("Address copied"))}>
          <CopyIcon /> Copy address
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}>
          {resolvedTheme === "dark" ? <SunIcon /> : <MoonIcon />} {resolvedTheme === "dark" ? "Light" : "Dark"} theme
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={async () => {
            if (wallet.kind === "guest" && (acct.usdc > 0 || acct.vault.assets > 0) && !confirm("Signing out deletes this guest wallet and its balance. Continue?")) return;
            await wallet.logout();
          }}
          className="text-no focus:text-no"
        >
          <SignOutIcon /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SideRail() {
  const path = usePathname();
  const streams = useLive((s) => s.streams);
  const list = Object.values(streams).sort(channelRank);
  return (
    <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-[240px] shrink-0 flex-col border-r border-border lg:flex">
      <nav className="space-y-0.5 p-3">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn("relative flex h-9 items-center gap-3 rounded-[10px] px-3 text-sm transition-colors", active ? "bg-raised font-medium text-foreground" : "text-muted-foreground hover:bg-raised/60 hover:text-foreground")}
            >
              {active && <span className="absolute -left-3 top-2 h-5 w-[3px] rounded-r-full bg-brand" />}
              <Icon size={18} weight={active ? "fill" : "regular"} className={active ? "text-brand" : undefined} />
              {label}
            </Link>
          );
        })}
      </nav>
      <div className="mx-3 border-t border-border" />
      <div className="flex items-center justify-between px-6 pb-1 pt-4">
        <span className="text-xs font-medium text-muted-foreground">Live channels</span>
        <Link href="/studio" className="text-faint hover:text-foreground" aria-label="Add your channel">
          <PlusIcon size={14} />
        </Link>
      </div>
      <div className="scrollbar-none flex-1 space-y-0.5 overflow-y-auto px-3 pb-3">
        {list.length === 0 && Array.from({ length: 4 }).map((_, i) => <div key={i} className="shimmer h-12 rounded-[10px] bg-raised/50" />)}
        {list.map((s) => {
          const active = path === `/c/${s.slug}`;
          return (
            <Link key={s.slug} href={`/c/${s.slug}`} className={cn("group flex items-center gap-3 rounded-[10px] px-2.5 py-2 transition-colors", active ? "bg-raised" : "hover:bg-raised/60")}>
              <span className="relative">
                <Avatar name={s.title} size={30} className={cn(!s.live && "opacity-50 grayscale")} />
                {s.live && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-background bg-live" />}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium leading-tight">{s.title}</span>
                <span className="block truncate text-xs text-faint">{s.market && s.market.phase === "trading" ? s.market.question : !s.live ? "Offline" : s.media?.kind === "video" ? (s.rerun ? `Rerun · ${s.game ?? ""}` : (s.game ?? s.streamTitle ?? "Live")) : `${s.white.name || "…"} vs ${s.black.name || "…"}`}</span>
              </span>
              {s.market && s.market.phase === "trading" ? (
                <span className="rounded-full bg-yes-soft px-1.5 py-0.5 font-mono text-[11px] font-medium text-yes tabular">{cents(s.market.priceYes)}</span>
              ) : s.live ? (
                <span className="text-xs text-faint tabular">{s.platformViewers ? compact(s.platformViewers) : s.watching}</span>
              ) : null}
            </Link>
          );
        })}
      </div>
      <SideFooter />
    </aside>
  );
}

function SideFooter() {
  const agent = useLive((s) => s.agent);
  return (
    <div className="border-t border-border p-4 text-xs text-faint">
      <div className="flex items-center justify-between gap-2 whitespace-nowrap">
        <span>AI engine</span>
        <span className={cn("flex items-center gap-1.5 font-medium", agent?.mode === "full" ? "text-yes" : "text-warn")}>
          {agent?.mode === "full" && <span className="size-1.5 animate-live rounded-full bg-yes" />}
          {agent ? (agent.provider === "0g" ? `0G · ${agent.requestsToday.toLocaleString()} calls today` : "Offline model") : "…"}
        </span>
      </div>
      <div className="mt-2 flex gap-3">
        <Link href="/how-it-works" className="hover:text-foreground">
          How it works
        </Link>
        <Link href="/responsible-play" className="hover:text-foreground">
          Responsible play
        </Link>
      </div>
    </div>
  );
}

function MobileNav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 grid h-16 grid-cols-5 border-t border-border bg-background/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = path.startsWith(href);
        return (
          <Link key={href} href={href} className={cn("flex flex-col items-center justify-center gap-1 text-[11px]", active ? "text-foreground" : "text-faint")}>
            <Icon size={22} weight={active ? "fill" : "regular"} className={active ? "text-brand" : undefined} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function CommandMenu() {
  const { command, setCommand } = useUI();
  const router = useRouter();
  const streams = useLive((s) => s.streams);
  const markets = useLive((s) => s.markets);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommand(!useUI.getState().command);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setCommand]);
  const go = (href: string) => {
    setCommand(false);
    router.push(href);
  };
  const live = Object.values(markets).filter((m) => m.phase === "trading" || m.phase === "locked" || m.phase === "window");
  return (
    <Dialog open={command} onOpenChange={setCommand}>
      <DialogContent className="overflow-hidden rounded-2xl border-border bg-surface p-0 sm:max-w-[560px]" showCloseButton={false}>
        <DialogTitle className="sr-only">Search</DialogTitle>
        <Command className="[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:pt-3 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:text-faint">
          <div className="flex items-center gap-2 border-b border-border px-4">
            <MagnifyingGlassIcon size={18} className="text-faint" />
            <Command.Input autoFocus placeholder="Search channels, markets, pages" className="h-12 w-full bg-transparent text-sm outline-none placeholder:text-faint" />
          </div>
          <Command.List className="max-h-[360px] overflow-y-auto p-2">
            <Command.Empty className="py-8 text-center text-sm text-faint">Nothing matches.</Command.Empty>
            {live.length > 0 && (
              <Command.Group heading="Live markets">
                {live.map((m) => (
                  <Item key={m.id} onSelect={() => go(`/c/${m.slug}`)} value={`${m.question} ${m.streamTitle}`}>
                    <span className="truncate">{m.question}</span>
                    <span className="ml-auto font-mono text-xs text-yes">{cents(m.priceYes)}</span>
                  </Item>
                ))}
              </Command.Group>
            )}
            <Command.Group heading="Channels">
              {Object.values(streams).map((s) => (
                <Item key={s.slug} onSelect={() => go(`/c/${s.slug}`)} value={`${s.title} ${s.white.name} ${s.black.name}`}>
                  <Avatar name={s.title} size={22} />
                  <span>{s.title}</span>
                  {s.live && <LiveBadge className="ml-auto" />}
                </Item>
              ))}
            </Command.Group>
            <Command.Group heading="Pages">
              {[...NAV, { href: "/studio", label: "Creator studio" }, { href: "/vault", label: "Liquidity vault" }, { href: "/account", label: "Account and limits" }, { href: "/how-it-works", label: "How it works" }].map((n) => (
                <Item key={n.href} onSelect={() => go(n.href)} value={n.label}>
                  {n.label}
                </Item>
              ))}
            </Command.Group>
          </Command.List>
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function Item({ children, onSelect, value }: { children: React.ReactNode; onSelect: () => void; value: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex h-10 cursor-pointer items-center gap-2.5 rounded-[10px] px-3 text-sm aria-selected:bg-raised">
      {children}
    </Command.Item>
  );
}
