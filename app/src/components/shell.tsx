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
  QuestionIcon,
  SignOutIcon,
  SunIcon,
  TrophyIcon,
  UserCircleIcon,
  VaultIcon,
  WalletIcon,
  WarningIcon,
} from "@phosphor-icons/react";
import { toast } from "sonner";
import type { StreamSummary } from "@clutch/shared";
import { Avatar, LiveBadge, Logo } from "@/components/brand";
import { Onboarding } from "@/components/onboarding";
import { WalletSheet } from "@/components/wallet-sheet";
import { Tutorial } from "@/components/tutorial";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useAccount } from "@/lib/account";
import { useLive } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { useWallet } from "@/lib/wallet";
import { chain as appChain } from "@/lib/env";
import { cents, compact, short } from "@/lib/format";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { Separator } from "@/components/ui/separator";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/live", label: "Live", icon: BroadcastIcon },
  { href: "/browse", label: "Explore", icon: CompassIcon },
  { href: "/leaderboard", label: "Leaderboard", icon: TrophyIcon },
  { href: "/portfolio", label: "Portfolio", icon: ChartLineUpIcon },
];

/** Bottom tabs on phones: the four places a viewer goes most. */
const MOBILE_NAV = [
  { href: "/live", label: "Live", icon: BroadcastIcon },
  { href: "/browse", label: "Explore", icon: CompassIcon },
  { href: "/portfolio", label: "Portfolio", icon: ChartLineUpIcon },
  { href: "/account", label: "Account", icon: UserCircleIcon },
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
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset className="min-w-0 bg-background">
        <TopBar />
        <main className="min-w-0 flex-1 pb-[calc(4.25rem+env(safe-area-inset-bottom))] md:pb-0">{children}</main>
      </SidebarInset>
      <MobileNav />
      <Onboarding />
      <WalletSheet />
      <Tutorial />
      <CommandMenu />
    </SidebarProvider>
  );
}

function TopBar() {
  const wallet = useWallet();
  const acct = useAccount();
  const open = useUI((s) => s.openOnboarding);
  const setCommand = useUI((s) => s.setCommand);
  const setWallet = useUI((s) => s.setWallet);
  const setTutorial = useUI((s) => s.setTutorial);
  const chain = useLive((s) => s.chain);
  const connected = useLive((s) => s.connected);
  const path = usePathname();
  return (
    <header className="sticky top-0 z-40 h-14 shrink-0 border-b border-border bg-background/85 backdrop-blur-xl lg:h-[60px]">
      <div className="flex h-full items-center gap-2 px-3 sm:px-5">
        <SidebarTrigger className="-ml-1 size-9 text-muted-foreground" />
        <Separator orientation="vertical" className="mx-1 hidden !h-5 md:block" />
        <Link href="/" className="flex shrink-0 items-center rounded-lg md:hidden" aria-label="Clutch home">
          <Logo />
        </Link>
        <button
          onClick={() => setCommand(true)}
          className="hidden h-9 w-[260px] items-center gap-2 rounded-lg border border-border bg-raised/50 pl-3 pr-1.5 text-sm text-faint shadow-xs transition hover:border-border-strong md:flex xl:w-[320px]"
        >
          <MagnifyingGlassIcon size={16} />
          Search channels
          <KbdGroup className="ml-auto">
            <Kbd>⌘</Kbd>
            <Kbd>K</Kbd>
          </KbdGroup>
        </button>
        <button onClick={() => setCommand(true)} className="ml-auto grid size-9 place-items-center rounded-full text-muted-foreground hover:bg-raised md:hidden" aria-label="Search">
          <MagnifyingGlassIcon size={19} />
        </button>
        <div className="flex items-center gap-2 md:ml-auto">
          <Button variant="ghost" size="sm" onClick={() => setTutorial(true)} className="hidden h-9 gap-1.5 rounded-full px-3 text-muted-foreground hover:text-foreground md:inline-flex">
            <QuestionIcon size={16} /> How it works
          </Button>
          {appChain.testnet && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="hidden h-7 items-center gap-1.5 rounded-full border border-border px-2.5 text-[11.5px] font-medium text-muted-foreground xl:flex">
                  <span className={cn("size-1.5 rounded-full", connected ? "bg-yes" : "bg-warn")} /> {appChain.name}
                </span>
              </TooltipTrigger>
              <TooltipContent>Testnet only. Balances are test USDC with no real-world value.</TooltipContent>
            </Tooltip>
          )}
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
          {!connected && <span className="hidden text-xs text-warn sm:inline">Reconnecting…</span>}
          {wallet.address ? (
            <>
              <button onClick={() => (acct.pass ? setWallet(true) : open())} className="flex h-9 items-center gap-2 rounded-full border border-border bg-raised px-3.5 text-sm transition hover:border-border-strong" aria-label="Wallet balance">
                <WalletIcon size={16} className="text-muted-foreground" />
                <NumberFlow value={acct.spendable} format={{ style: "currency", currency: "USD" }} className="font-medium tabular" />
              </button>
              {acct.onboarded ? (
                <Button size="sm" className="hidden h-9 rounded-full bg-foreground px-4 font-medium text-background hover:bg-foreground/90 sm:inline-flex" onClick={() => setWallet("deposit")}>
                  Deposit
                </Button>
              ) : (
                <Button size="sm" className="h-9 rounded-full bg-foreground px-4 font-medium text-background hover:bg-foreground/90" onClick={() => open()}>
                  Finish setup
                </Button>
              )}
              <AccountMenu />
            </>
          ) : (
            <Button size="sm" className="h-9 rounded-full bg-foreground px-5 font-medium text-background hover:bg-foreground/90" onClick={() => open()} disabled={!wallet.ready}>
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

/** The left rail: where to go, which channels are live right now, and whether the AI engine is up. */
function AppSidebar() {
  const path = usePathname();
  const streams = useLive((s) => s.streams);
  const agent = useLive((s) => s.agent);
  const { isMobile, setOpenMobile } = useSidebar();
  const list = Object.values(streams).sort(channelRank);
  const close = () => isMobile && setOpenMobile(false);
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="h-14 justify-center border-b border-sidebar-border lg:h-[60px]">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" className="h-10 hover:bg-transparent active:bg-transparent">
              <Link href="/" onClick={close} aria-label="Clutch home">
                <Logo className="text-sidebar-accent-foreground" />
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent className="scrollbar-none">
        <SidebarGroup>
          <SidebarMenu>
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = path.startsWith(href) || (href === "/live" && path.startsWith("/c/"));
              return (
                <SidebarMenuItem key={href}>
                  <SidebarMenuButton asChild isActive={active} tooltip={label} className="h-9 data-[active=true]:font-medium">
                    <Link href={href} onClick={close}>
                      <Icon weight={active ? "fill" : "regular"} className={cn("!size-[18px]", active && "text-brand")} />
                      <span>{label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
        <SidebarSeparator className="mx-0" />
        <SidebarGroup className="min-h-0">
          <SidebarGroupLabel>Live channels</SidebarGroupLabel>
          <SidebarGroupAction asChild title="Add your channel">
            <Link href="/studio" onClick={close}>
              <PlusIcon />
              <span className="sr-only">Add your channel</span>
            </Link>
          </SidebarGroupAction>
          <SidebarMenu>
            {list.length === 0 && Array.from({ length: 6 }).map((_, i) => <SidebarMenuSkeleton key={i} showIcon />)}
            {list.slice(0, 40).map((s) => {
              const trading = s.market?.phase === "trading";
              const sub = trading
                ? s.market!.question
                : !s.live
                  ? "Offline"
                  : s.media?.kind === "video"
                    ? s.rerun
                      ? `Rerun · ${s.game ?? ""}`
                      : (s.game ?? s.streamTitle ?? "Live")
                    : `${s.white.name || "…"} vs ${s.black.name || "…"}`;
              return (
                <SidebarMenuItem key={s.slug}>
                  <SidebarMenuButton asChild size="lg" isActive={path === `/c/${s.slug}`} tooltip={`${s.title} · ${sub}`} className={cn("h-11 gap-2.5", (trading || s.live) && "pr-14")}>
                    <Link href={`/c/${s.slug}`} onClick={close}>
                      <span className="relative shrink-0">
                        <Avatar name={s.title} size={28} className={cn(!s.live && "opacity-50 grayscale")} />
                        {s.live && <span className="absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-sidebar bg-live" />}
                      </span>
                      <span className="grid min-w-0 flex-1 leading-tight">
                        <span className="truncate text-[13px] font-medium text-sidebar-accent-foreground">{s.title}</span>
                        <span className="truncate text-xs text-faint">{sub}</span>
                      </span>
                    </Link>
                  </SidebarMenuButton>
                  {trading ? (
                    <SidebarMenuBadge className="top-1.5 h-5 rounded-full bg-yes-soft px-1.5 font-mono text-[11px] text-yes tabular peer-hover/menu-button:text-yes">{cents(s.market!.priceYes)}</SidebarMenuBadge>
                  ) : s.live ? (
                    <SidebarMenuBadge className="top-1.5 h-5 text-[11px] font-normal text-faint tabular">{s.platformViewers ? compact(s.platformViewers) : s.watching}</SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              );
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="border-t border-sidebar-border p-3 text-xs text-faint group-data-[collapsible=icon]:hidden">
        <div className="flex items-center justify-between gap-2 whitespace-nowrap">
          <span>AI engine</span>
          <span className={cn("flex items-center gap-1.5 font-medium", agent?.mode === "full" ? "text-yes" : "text-warn")}>
            {agent?.mode === "full" && <span className="size-1.5 animate-live rounded-full bg-yes" />}
            {!agent ? "connecting…" : agent.enabled === false ? "AI paused" : agent.outOfCredits ? "0G out of credits" : agent.mode === "paused" ? "Daily AI budget spent" : agent.provider === "0g" ? `0G · ${agent.requestsToday.toLocaleString()} today` : "Offline model"}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <Link href="/how-it-works" onClick={close} className="hover:text-foreground">How it works</Link>
          <Link href="/responsible-play" onClick={close} className="hover:text-foreground">Responsible play</Link>
        </div>
        <div>Testnet only · test USDC has no real value</div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  );
}

function MobileNav() {
  const path = usePathname();
  return (
    <nav aria-label="Primary" className="pb-safe fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/92 backdrop-blur-xl md:hidden">
      <div className="grid h-[68px] grid-cols-4">
        {MOBILE_NAV.map(({ href, label, icon: Icon }) => {
          const active = path.startsWith(href) || (href === "/live" && path.startsWith("/c/"));
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={cn("flex flex-col items-center justify-center gap-1 text-[11px] font-medium transition-colors", active ? "text-foreground" : "text-faint")}>
              <Icon size={23} weight={active ? "fill" : "regular"} className={active ? "text-brand" : undefined} />
              {label}
            </Link>
          );
        })}
      </div>
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
