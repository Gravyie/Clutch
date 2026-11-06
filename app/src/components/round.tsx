"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { ArrowRightIcon, CaretDownIcon, ProhibitIcon, ScanIcon, SealCheckIcon, ShieldCheckIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { MarketView, StreamState } from "@clutch/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Item, ItemActions, ItemContent, ItemGroup, ItemMedia, ItemTitle } from "@/components/ui/item";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { PriceChart, isOpen } from "@/components/market";
import { useEnsureReady } from "@/components/onboarding";
import { CallMarket } from "@/components/call";
import { useAccount, type PoolKey, type Refusal } from "@/lib/account";
import { useLive, useNow } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { ENGINE_URL } from "@/lib/env";
import { ago, cents, compactUsd, short, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

const STAKES = [1, 5, 10, 25];

/** The counter a vision market is about, and its value now vs at window start (from the AI's live reading). */
function useCounterProgress(m: MarketView, s?: StreamState) {
  const p = m.rule.params as { key?: string; label?: string; kind?: string; threshold?: number };
  if (!p.key || !s?.vision) return null;
  if (p.key === "__pov_alive") return { label: "Streamer alive", now: s.vision.state.povAlive === null ? "?" : s.vision.state.povAlive ? "yes" : "no" };
  const c = s.vision.state.counters?.find((x) => x.key === p.key);
  return { label: p.label ?? p.key, now: c ? String(c.value) : "?", target: p.threshold };
}

const fmtSec = (n: number) => {
  const v = Math.max(0, Math.ceil(n));
  return v >= 60 ? `${Math.floor(v / 60)}:${String(v % 60).padStart(2, "0")}` : `0:${String(v).padStart(2, "0")}`;
};

/** A duration in words: "40s", "15 min", "2 min 30s". */
const dur = (n: number) => {
  const v = Math.max(0, Math.round(n));
  if (v < 60) return `${v}s`;
  const m = Math.floor(v / 60);
  const s = v % 60;
  return s ? `${m} min ${s}s` : `${m} min`;
};

type Stage = "trading" | "locked" | "window" | "resolving" | "settled" | "void";

const STATUS: Record<Stage, { label: string; dot: string; text: string }> = {
  trading: { label: "Live", dot: "bg-live animate-live", text: "text-live" },
  locked: { label: "Trading closed", dot: "bg-warn", text: "text-warn" },
  window: { label: "Playing out", dot: "bg-warn animate-live", text: "text-warn" },
  resolving: { label: "Checking result", dot: "bg-info animate-live", text: "text-info" },
  settled: { label: "Resolved", dot: "bg-foreground/60", text: "text-muted-foreground" },
  void: { label: "Voided", dot: "bg-void", text: "text-void" },
};

/**
 * The moment card: one live question, its timing and odds, and one-tap Yes/No while it trades. After lock the same
 * card walks the lifecycle (closed, playing out, checking, result) so the viewer never loses the thread.
 */
export function RoundPanel({ m, stream, pool, next }: { m?: MarketView; stream?: StreamState; pool?: PoolKey; next?: string }) {
  if (!m) return <Waiting stream={stream} hint={next} />;
  const trading = m.phase === "trading";
  return (
    <AnimatePresence mode="wait">
      <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.28, ease: [0.2, 0.75, 0.25, 1] }}>
        <Card aria-label="Current market" className="relative gap-0 overflow-hidden py-0">
          {trading && <LockBar m={m} />}
          <CardHeader className="gap-2.5 px-5 pt-5 pb-0">
            <StatusLine m={m} />
            <CardTitle className="text-[20px] leading-[1.25] font-semibold tracking-[-0.018em] text-balance">{m.question}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 px-5 pt-4 pb-5">
            <Odds m={m} />
            {trading ? <OneTap m={m} pool={pool} /> : <AfterLock m={m} stream={stream} />}
          </CardContent>
          <WhyThis m={m} />
        </Card>
      </motion.div>
    </AnimatePresence>
  );
}

/** A hairline across the top of the card that drains as trading runs out. */
function LockBar({ m }: { m: MarketView }) {
  const now = useNow(250);
  const frac = Math.min(1, Math.max(0, (m.lockTime - now) / Math.max(1, m.lockTime - m.openedAt)));
  return (
    <div className="absolute inset-x-0 top-0 h-[3px] bg-secondary" aria-hidden>
      <div className={cn("h-full transition-[width] duration-300 ease-linear", m.lockTime - now < 6 ? "bg-no" : "bg-brand")} style={{ width: `${frac * 100}%` }} />
    </div>
  );
}

function StatusLine({ m }: { m: MarketView }) {
  const now = useNow(250);
  const st = STATUS[m.phase as Stage] ?? STATUS.locked;
  const left = m.lockTime - now;
  let right: React.ReactNode = null;
  if (m.phase === "trading") {
    right = (
      <span className={cn("rounded-md px-2 py-0.5 font-mono text-[12px] font-semibold tabular", left < 6 ? "bg-no-soft text-no" : "bg-secondary text-foreground")} aria-label={`Trading closes in ${Math.ceil(Math.max(0, left))} seconds`}>
        {fmtSec(left)}
      </span>
    );
  } else if (m.phase === "window" || m.phase === "locked") {
    right = <span className="text-[12.5px] text-muted-foreground tabular">{now < m.windowStart ? `starts ${fmtSec(m.windowStart - now)}` : now < m.windowEnd ? `${fmtSec(m.windowEnd - now)} left` : "awaiting result"}</span>;
  } else if (m.trades > 0) {
    right = (
      <span className="text-xs text-faint tabular">
        {compactUsd(m.volume)} · {m.traders} {m.traders === 1 ? "trader" : "traders"}
      </span>
    );
  }
  return (
    <div className="flex h-6 items-center gap-2">
      <span className={cn("flex items-center gap-1.5 text-[12.5px] font-medium", st.text)}>
        <span className={cn("size-1.5 rounded-full", st.dot)} aria-hidden />
        {st.label}
      </span>
      {m.phase === "trading" && <span className="text-[12.5px] text-faint">· closes in</span>}
      <span className="ml-auto">{right}</span>
    </div>
  );
}

function Odds({ m }: { m: MarketView }) {
  const delta = m.priceYes - m.pYes0;
  const trading = m.phase === "trading";
  return (
    <div>
      <div className="flex items-baseline gap-2">
        <NumberFlow value={Math.round(m.priceYes * 100)} suffix="%" className="text-[28px] leading-none font-semibold tracking-[-0.03em] tabular" />
        <span className="text-[13px] text-muted-foreground">{m.phase === "trading" ? "chance of Yes" : m.phase === "settled" || m.phase === "void" ? "final Yes price" : "Yes at close"}</span>
        {Math.abs(delta) >= 0.01 && (
          <span className={cn("ml-auto text-xs font-medium tabular", delta > 0 ? "text-yes" : "text-no")}>
            {delta > 0 ? "▲" : "▼"} {Math.round(Math.abs(delta) * 100)} pts
          </span>
        )}
      </div>
      {trading && (
        <p className="mt-1.5 text-xs text-faint">
          Event starts {dur(m.windowStart - m.lockTime)} after close and runs {dur(m.windowEnd - m.windowStart)}
          {m.trades > 0 ? ` · ${compactUsd(m.volume)} traded` : ""}
        </p>
      )}
      {m.trades > 0 && (
        <div className="mt-2">
          <PriceChart m={m} height={52} />
        </div>
      )}
    </div>
  );
}

/** "Why this market?": the objective rule and where the question came from, folded away until asked. */
function WhyThis({ m }: { m: MarketView }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="border-t">
      <CollapsibleTrigger asChild>
        <button className="flex h-11 w-full items-center gap-2 px-5 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:bg-secondary/60 focus-visible:outline-none">
          <ShieldCheckIcon size={15} className="text-info" weight="fill" />
          Rules and source
          <span className="ml-auto font-mono text-[11px] font-normal text-faint">#{m.id}</span>
          <CaretDownIcon size={13} className={cn("text-faint transition-transform duration-200", open && "rotate-180")} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-3 px-5 pb-5 text-[13px] leading-relaxed">
        <p>{m.rule.resolution}</p>
        {m.ai.rationale && <p className="text-muted-foreground">{m.ai.rationale}</p>}
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
          <dt className="text-faint">Opened by</dt>
          <dd className="text-muted-foreground">{m.ai.paidBy === "viewer" ? "a viewer, on their own 0G credits" : m.ai.provider === "0g" ? `0G agent · ${m.ai.model}` : "offline base-rate model"}</dd>
          {m.ai.requestId && (
            <>
              <dt className="text-faint">Request</dt>
              <dd className="truncate font-mono text-muted-foreground">{short(m.ai.requestId, 10)}</dd>
            </>
          )}
          <dt className="text-faint">Opened at</dt>
          <dd className="text-muted-foreground tabular">{Math.round(m.pYes0 * 100)}% Yes</dd>
          <dt className="text-faint">Rule hash</dt>
          <dd className="truncate font-mono text-muted-foreground">{short(m.ruleHash, 10)}</dd>
        </dl>
        <Link href={`/m/${m.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline">
          Full market and receipt <ArrowRightIcon size={12} />
        </Link>
      </CollapsibleContent>
    </Collapsible>
  );
}

/** Tap a side: the trade goes through with the chosen stake. No confirm step, no wallet pop-up. */
function OneTap({ m, pool }: { m: MarketView; pool?: PoolKey }) {
  const acct = useAccount();
  const ensureReady = useEnsureReady();
  const verify = useUI((s) => s.openVerify);
  const setWallet = useUI((s) => s.setWallet);
  const chain = useLive((s) => s.chain);
  const now = useNow(500);
  const [stake, setStake] = useState(5);
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const chainOk = !chain || chain.sequencerPhase === "Normal";
  const closed = now >= m.lockTime;
  const lowBalance = acct.onboarded && acct.spendable < stake;

  // The tapped side survives onboarding: after "Verify" the same tap runs with the then-current account.
  const goRef = useRef<(yes: boolean) => void>(() => {});
  async function go(yes: boolean) {
    setRefusal(null);
    if (!ensureReady(() => goRef.current(yes)) || !pool) return;
    setBusy(yes ? "yes" : "no");
    try {
      const r = await acct.back({ marketId: m.id, pool, yes, amount: stake });
      toast.success(`${yes ? "Yes" : "No"} · ${usd(stake, 0)} in`, { description: `${r.shares.toFixed(2)} shares · pays ${usd(r.shares)} if right${r.paidWith === "eth" ? " · paid in ETH, one transaction" : ""}` });
    } catch (e: any) {
      setRefusal(e?.title ? e : { code: "Error", title: "That didn't go through", body: String(e?.message ?? e) });
    } finally {
      setBusy(null);
    }
  }

  goRef.current = go;

  return (
    <div className="space-y-3">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="font-medium text-muted-foreground" id={`stake-${m.id}`}>
            Amount
          </span>
          {acct.onboarded ? (
            lowBalance ? (
              <button onClick={() => setWallet("deposit")} className="font-medium text-brand hover:underline">
                Add funds
              </button>
            ) : (
              <span className="text-faint tabular">{usd(acct.spendable)} available</span>
            )
          ) : (
            <span className="text-faint">Test USDC</span>
          )}
        </div>
        <ToggleGroup
          type="single"
          value={String(stake)}
          onValueChange={(v) => v && setStake(Number(v))}
          aria-labelledby={`stake-${m.id}`}
          className="grid h-10 w-full grid-cols-4 gap-0 rounded-lg bg-secondary p-1"
        >
          {STAKES.map((v) => (
            <ToggleGroupItem
              key={v}
              value={String(v)}
              role="radio"
              className="h-8 rounded-md !rounded-md text-[13px] font-semibold text-muted-foreground tabular transition-all hover:bg-transparent hover:text-foreground data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm"
            >
              ${v}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([true, false] as const).map((yes) => {
          const price = yes ? m.priceYes : 1 - m.priceYes;
          const payout = (stake * 0.98) / Math.max(price, 0.01);
          return (
            <button
              key={String(yes)}
              disabled={busy !== null || !chainOk || closed}
              onClick={() => go(yes)}
              aria-label={`${yes ? "Yes" : "No"} at ${cents(price)}, stake $${stake}`}
              className={cn(
                "group relative flex h-16 flex-col items-center justify-center rounded-xl font-semibold shadow-xs outline-none transition-all duration-150",
                "hover:-translate-y-px hover:shadow-md active:translate-y-0 active:scale-[0.985] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
                "disabled:pointer-events-none disabled:opacity-45",
                yes ? "bg-yes text-white dark:text-[#04140f]" : "bg-no text-white dark:text-[#1d0707]",
              )}
            >
              {busy === (yes ? "yes" : "no") ? (
                <Spinner className="size-5" />
              ) : (
                <>
                  <span className="text-[16px] leading-tight">
                    {yes ? "Yes" : "No"} <span className="tabular">{cents(price)}</span>
                  </span>
                  <span className="text-[11.5px] font-medium opacity-80 tabular">to win {usd(payout)}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {closed && <p className="text-xs text-warn">Trading just closed. Waiting for the chain to confirm the lock.</p>}
      {!chainOk && <p className="text-xs text-warn">Chain recovering: trading is paused by Blackout Guard until the sequencer is healthy.</p>}
      <AnimatePresence>
        {refusal && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden" role="alert">
            <div className="flex gap-2.5 rounded-lg bg-no-soft p-3">
              <ProhibitIcon size={16} weight="bold" className="mt-0.5 shrink-0 text-no" />
              <div className="min-w-0">
                <div className="text-[13px] font-semibold">{refusal.title}</div>
                <p className="text-xs text-muted-foreground">{refusal.code === "DailyCapExceeded" && !acct.verified ? `That's the ${usd(acct.pass?.dailyCap ?? 10, 0)} starter limit for this wallet.` : refusal.body}</p>
                {refusal.code === "DailyCapExceeded" && !acct.verified && (
                  <button onClick={() => verify()} className="mt-1.5 text-xs font-semibold text-brand hover:underline">
                    Raise it with World ID
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="text-center text-[11.5px] text-faint">{acct.onboarded ? "One tap places the trade · winnings pay out automatically" : "Sign in once, then every prediction is one tap"}</p>
    </div>
  );
}

const STEPS: { k: Stage; label: string }[] = [
  { k: "locked", label: "Closed" },
  { k: "window", label: "Playing out" },
  { k: "resolving", label: "Checking" },
  { k: "settled", label: "Result" },
];

/** One segmented bar for the whole lifecycle; the current segment fills with real time where it has a clock. */
function Lifecycle({ m }: { m: MarketView }) {
  const now = useNow(500);
  const done = m.phase === "settled" || m.phase === "void";
  const idx = done ? 4 : Math.max(0, STEPS.findIndex((s) => s.k === m.phase));
  const fill = (i: number) => {
    if (i < idx) return 1;
    if (i > idx) return 0;
    if (m.phase === "window") return now < m.windowStart ? 0.04 : Math.min(1, (now - m.windowStart) / Math.max(1, m.windowEnd - m.windowStart));
    if (m.phase === "locked") return Math.min(1, Math.max(0.04, (now - m.lockTime) / Math.max(1, m.windowStart - m.lockTime)));
    return 0.5;
  };
  const tone = m.phase === "void" ? "bg-void" : done ? "bg-foreground/70" : m.phase === "resolving" ? "bg-info" : "bg-warn";
  return (
    <div>
      <ol className="grid grid-cols-4 gap-1" aria-label="Market lifecycle">
        {STEPS.map((s, i) => (
          <li key={s.k} aria-current={i === idx ? "step" : undefined} className="h-1.5 overflow-hidden rounded-full bg-secondary">
            <div className={cn("h-full rounded-full transition-[width] duration-500", i < idx ? (done ? tone : "bg-foreground/35") : tone, i === idx && m.phase === "resolving" && "animate-pulse")} style={{ width: `${fill(i) * 100}%` }} />
          </li>
        ))}
      </ol>
      <div className="mt-2 grid grid-cols-4 gap-1 text-[11px]">
        {STEPS.map((s, i) => (
          <span key={s.k} className={cn(i === Math.min(idx, 3) ? "font-medium text-foreground" : "text-faint")}>
            {i === 3 && m.phase === "void" ? "Void" : s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function AfterLock({ m, stream }: { m: MarketView; stream?: StreamState }) {
  const progress = useCounterProgress(m, stream);
  if (m.phase === "settled" || m.phase === "void") {
    const isVoid = m.outcome === "VOID" || m.phase === "void";
    const yes = m.outcome === "YES";
    return (
      <div className="space-y-4">
        <Lifecycle m={m} />
        <div className="flex items-start gap-3">
          <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", isVoid ? "bg-void-soft text-void" : yes ? "bg-yes-soft text-yes" : "bg-no-soft text-no")}>
            {isVoid ? <ProhibitIcon size={18} weight="bold" /> : <SealCheckIcon size={18} weight="fill" />}
          </span>
          <div className="min-w-0">
            <div className={cn("text-[15px] font-semibold", isVoid ? "text-foreground" : yes ? "text-yes" : "text-no")}>{isVoid ? "Voided, stakes refunded" : yes ? "Resolved Yes" : "Resolved No"}</div>
            <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{m.voidReason ?? (m.tx.resolve ? "Settled onchain against the rule committed before trading." : "Result recorded; onchain settlement pending.")}</p>
          </div>
        </div>
        <Button asChild variant="outline" className="h-10 w-full rounded-lg">
          <Link href={`/m/${m.id}`}>
            View receipt <ArrowRightIcon />
          </Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      <Lifecycle m={m} />
      {progress && (
        <div className="flex items-center justify-between border-t pt-3.5">
          <span className="flex items-center gap-2 text-[13px] text-muted-foreground">
            <ScanIcon size={15} className="text-yes" /> {progress.label}
            <span className="text-[11px] text-faint">· live AI reading</span>
          </span>
          <span className="text-[15px] font-semibold capitalize tabular">
            {progress.now}
            {progress.target !== undefined && <span className="text-xs font-normal text-faint"> / {progress.target}</span>}
          </span>
        </div>
      )}
      <p className="text-xs leading-relaxed text-faint">{m.phase === "resolving" ? "Two readers are checking the window against the committed rule." : "Trading is closed. Only what happens inside the window decides the result."}</p>
    </div>
  );
}

function Waiting({ stream, hint }: { stream?: StreamState; hint?: string }) {
  const callable = stream?.media?.kind === "video" && stream.live && !stream.rerun;
  const now = useNow(1000);
  // Never a dead end: what's trading on other channels right now, soonest to lock first.
  const markets = useLive((s) => s.markets);
  const elsewhere = useMemo(
    () =>
      Object.values(markets)
        .filter((m) => m.slug !== stream?.slug && m.phase === "trading" && m.lockTime - now > 6)
        .sort((a, b) => a.lockTime - b.lockTime)
        .slice(0, 3),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [markets, stream?.slug, Math.floor(now / 5)],
  );
  const title = !stream || !stream.live || stream.rerun ? (stream?.rerun ? "No markets on reruns" : stream && !stream.live ? "Channel is offline" : "No markets on this stream right now") : "Watching for the next moment";
  return (
    <Card className="gap-0 overflow-hidden py-0" aria-label="No market open">
      <div className="flex items-start gap-3.5 p-5">
        <span className="relative grid size-10 shrink-0 place-items-center rounded-xl bg-secondary text-muted-foreground">
          <ScanIcon size={20} />
          {stream?.reading && <span className="absolute -top-0.5 -right-0.5 size-2.5 animate-live rounded-full border-2 border-card bg-yes" />}
        </span>
        <div className="min-w-0">
          <div className="text-[15px] font-semibold tracking-tight">{title}</div>
          <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{hint ?? "Markets open when the action gets uncertain."}</p>
        </div>
      </div>
      {elsewhere.length > 0 && (
        <div className="border-t">
          <div className="px-5 pt-3.5 pb-1 text-xs font-medium text-muted-foreground">Trading now on other streams</div>
          <ItemGroup className="px-2 pb-2">
            {elsewhere.map((m) => (
              <Item key={m.id} asChild size="sm" className="gap-3 rounded-lg px-3 py-2.5 hover:bg-secondary/60">
                <Link href={`/c/${m.slug}`}>
                  <ItemContent className="min-w-0">
                    <ItemTitle className="block w-full truncate text-[13px]">{m.question}</ItemTitle>
                    <span className="truncate text-xs text-faint">{m.streamTitle}</span>
                  </ItemContent>
                  <ItemActions className="flex-col items-end gap-0.5 text-xs tabular">
                    <span className="font-mono text-live">{Math.max(0, Math.ceil(m.lockTime - now))}s</span>
                    <span className="font-mono font-semibold text-yes">Yes {Math.round(m.priceYes * 100)}¢</span>
                  </ItemActions>
                </Link>
              </Item>
            ))}
          </ItemGroup>
        </div>
      )}
      {callable && stream && (
        <div className="border-t bg-secondary/30 p-5">
          <CallMarket slug={stream.slug} />
        </div>
      )}
    </Card>
  );
}

/** What the AI reads off the stream right now: every counter, live. */
export function VisionPanel({ s }: { s?: StreamState }) {
  const now = useNow(1000);
  if (!s || s.media?.kind !== "video") return null;
  const v = s.vision;
  const fresh = v && now * 1000 - v.at < 30_000;
  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardHeader className="flex items-center border-b px-4 py-3 [.border-b]:pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <ScanIcon size={16} className={fresh ? "text-yes" : "text-faint"} /> What the AI sees
        </CardTitle>
        {v && <CardAction className="self-center text-[11px] text-faint">{Math.max(0, Math.round(now - v.at / 1000))}s ago</CardAction>}
      </CardHeader>
      {s.frameAt && <img src={`${ENGINE_URL}/frames/${s.slug}.jpg?t=${Math.floor(s.frameAt / 2000)}`} alt="Latest frame the AI read" className="aspect-video w-full object-cover" />}
      <CardContent className="space-y-2.5 p-4">
        {!v ? (
          <p className="text-sm text-faint">{s.reading ? "Starting to read this stream…" : s.rerun ? "Reruns are never read: the result already happened." : "Queued for an AI reader."}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className={cn(v.state.mode === "gameplay" && "bg-yes-soft text-yes")}>
                {v.state.mode}
              </Badge>
              {v.state.povAlive !== null && <Badge variant="secondary">player {v.state.povAlive ? "alive" : "down"}</Badge>}
              {v.state.game && <span className="truncate text-xs text-faint">{v.state.game}</span>}
            </div>
            {v.state.counters && v.state.counters.length > 0 ? (
              <dl className="grid grid-cols-2 gap-1.5">
                {v.state.counters.slice(0, 8).map((c) => (
                  <div key={c.key} className="rounded-lg border bg-secondary/40 px-2.5 py-1.5">
                    <dt className="truncate text-[11px] text-faint">{c.label}</dt>
                    <dd className="font-mono text-sm font-semibold tabular">{c.value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="text-xs text-faint">No counters on screen right now.</p>
            )}
            <p className="text-xs text-muted-foreground">{v.state.summary}</p>
            <p className="text-[11px] text-faint">Read by {v.reader} in {(v.ms / 1000).toFixed(1)}s</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function VerdictBadge({ v }: { v: string }) {
  return <Badge className={cn("w-12 justify-center rounded-md font-semibold", v === "YES" ? "bg-yes-soft text-yes" : v === "NO" ? "bg-no-soft text-no" : "bg-void-soft text-void")}>{v}</Badge>;
}

/** Other markets on this channel that are locked and playing out. */
export function PlayingOut({ slug, exclude }: { slug: string; exclude?: number }) {
  const list = Object.values(useLive((s) => s.markets)).filter((m) => m.slug === slug && isOpen(m) && m.phase !== "trading" && m.id !== exclude);
  if (!list.length) return null;
  return (
    <Card className="gap-1 py-3">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Playing out</CardTitle>
      </CardHeader>
      <ItemGroup className="px-1.5">
        {list.map((m) => (
          <Item key={m.id} asChild size="sm" className="rounded-lg px-2.5 py-2 hover:bg-secondary/60">
            <Link href={`/m/${m.id}`}>
              <ItemContent className="min-w-0">
                <ItemTitle className="block w-full truncate font-normal">{m.question}</ItemTitle>
              </ItemContent>
              <ItemActions className="font-mono text-xs text-yes tabular">{cents(m.priceYes)}</ItemActions>
            </Link>
          </Item>
        ))}
      </ItemGroup>
    </Card>
  );
}

/** The last results on this channel, newest first. */
export function RecentRounds({ slug }: { slug: string }) {
  const receipts = useLive((s) => s.receipts).filter((r) => r.slug === slug).slice(0, 8);
  if (!receipts.length) return null;
  return (
    <Card className="gap-1 py-3">
      <CardHeader className="px-4">
        <CardTitle className="text-sm">Recent results</CardTitle>
      </CardHeader>
      <ItemGroup className="px-1.5">
        {receipts.map((r) => (
          <Item key={r.marketId} asChild size="sm" className="gap-2.5 rounded-lg px-2.5 py-2 hover:bg-secondary/60">
            <Link href={`/m/${r.marketId}`}>
              <ItemMedia>
                <VerdictBadge v={r.verdict} />
              </ItemMedia>
              <ItemContent className="min-w-0">
                <ItemTitle className="block w-full truncate font-normal text-muted-foreground">{r.question}</ItemTitle>
              </ItemContent>
              <ItemActions className="text-[11px] text-faint">{ago(r.resolvedAt)}</ItemActions>
            </Link>
          </Item>
        ))}
      </ItemGroup>
    </Card>
  );
}
