"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { Area, AreaChart, ResponsiveContainer, Tooltip as ChartTooltip, YAxis } from "recharts";
import { ArrowRightIcon, CaretDownIcon, CaretUpIcon, CheckCircleIcon, CircleNotchIcon, ClockIcon, LockSimpleIcon, ProhibitIcon, SealCheckIcon, ShieldCheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { templateById, type MarketView, type PricePoint, type Receipt, type TradeEvent } from "@clutch/shared";
import { Button } from "@/components/ui/button";
import { Item, ItemActions, ItemContent, ItemTitle } from "@/components/ui/item";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useEnsureReady } from "@/components/onboarding";
import { useAccount, type PoolKey, type Refusal } from "@/lib/account";
import { api, useLive, useNow } from "@/lib/live";
import { ago, cents, compactUsd, pct, short, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

export const isOpen = (m?: Pick<MarketView, "phase">) => !!m && (m.phase === "trading" || m.phase === "locked" || m.phase === "window" || m.phase === "resolving");

export function CountdownRing({ from, to, size = 40, label }: { from: number; to: number; size?: number; label?: string }) {
  const now = useNow(200);
  const left = Math.max(0, to - now);
  const frac = Math.min(1, Math.max(0, left / Math.max(1, to - from)));
  const r = size / 2 - 3;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative grid place-items-center" style={{ width: size, height: size }} aria-label={label ?? `${Math.ceil(left)} seconds left`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" className="stroke-raised" />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth="3" strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} className={cn("transition-[stroke-dashoffset] duration-200 ease-linear", left < 5 ? "stroke-no" : "stroke-foreground")} />
      </svg>
      <span className="absolute font-mono text-[12px] font-semibold tabular">{Math.ceil(left)}</span>
    </div>
  );
}

const PHASES = [
  { k: "trading", label: "Trading" },
  { k: "locked", label: "Buffer" },
  { k: "window", label: "Playing out" },
  { k: "resolving", label: "Settling" },
] as const;

export function PhaseSteps({ m }: { m: MarketView }) {
  const settled = m.phase === "settled" || m.phase === "void";
  const idx = settled ? 4 : PHASES.findIndex((p) => p.k === m.phase);
  return (
    <div className="grid grid-cols-4 gap-1">
      {PHASES.map((p, i) => (
        <div key={p.k}>
          <div className={cn("h-1 rounded-full", i < idx ? "bg-foreground/70" : i === idx ? "bg-yes" : "bg-raised")} />
          <div className={cn("mt-1.5 text-[11px]", i === idx ? "font-medium text-foreground" : "text-faint")}>{p.label}</div>
        </div>
      ))}
    </div>
  );
}

function useMarketDetail(id: number) {
  return useQuery({
    queryKey: ["market", id],
    queryFn: () => api<{ market: MarketView; history: PricePoint[]; trades: TradeEvent[]; receipt: Receipt | null }>(`/markets/${id}`),
    refetchInterval: 15_000,
  });
}

/** Price history from the server, extended live by trades arriving over the socket. */
export function usePriceSeries(m: MarketView) {
  const { data } = useMarketDetail(m.id);
  const live = useLive((s) => s.trades);
  return useMemo(() => {
    const base = data?.history ?? [{ t: m.openedAt * 1000, p: m.pYes0 }];
    const seen = new Set((data?.trades ?? []).map((t) => t.tx));
    const extra = live.filter((t) => t.marketId === m.id && !seen.has(t.tx)).map((t) => ({ t: t.at, p: t.priceYesAfter }));
    const pts = [...base, ...extra].sort((a, b) => a.t - b.t);
    return [...pts, { t: Date.now(), p: m.priceYes }];
  }, [data, live, m.id, m.openedAt, m.pYes0, m.priceYes]);
}

export function PriceChart({ m, height = 110 }: { m: MarketView; height?: number }) {
  const series = usePriceSeries(m);
  const up = m.priceYes >= m.pYes0;
  const color = up ? "var(--yes)" : "var(--no)";
  return (
    <div style={{ height }} className="-mx-1">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 6, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id={`g-${m.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <YAxis domain={[0, 1]} hide />
          <ChartTooltip
            cursor={{ stroke: "var(--border-strong)" }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <div className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs shadow-card">
                  <span className="font-semibold">{pct(Number(payload[0].value))}</span> <span className="text-faint">YES</span>
                </div>
              ) : null
            }
          />
          <Area type="stepAfter" dataKey="p" stroke={color} strokeWidth={2} fill={`url(#g-${m.id})`} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** The trade ticket. Pick a side, pick an amount, one tap. Every refusal names its rule. */
export function TradeTicket({ m, pool }: { m: MarketView; pool?: PoolKey }) {
  const acct = useAccount();
  const ensureReady = useEnsureReady();
  const chain = useLive((s) => s.chain);
  const [side, setSide] = useState<"yes" | "no">("yes");
  const [amount, setAmount] = useState(10);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const [quote, setQuote] = useState<{ shares: number; priceYesAfter: number } | null>(null);
  const trading = m.phase === "trading";
  const chainOk = !chain || chain.sequencerPhase === "Normal";
  const price = side === "yes" ? m.priceYes : 1 - m.priceYes;

  useEffect(() => {
    if (!trading || amount <= 0 || !acct.ready) return setQuote(null);
    let live = true;
    const t = setTimeout(() => {
      acct.quote(m.id, side === "yes", amount).then((q) => live && setQuote(q)).catch(() => live && setQuote(null));
    }, 150);
    return () => {
      live = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m.id, side, amount, trading, acct.ready, Math.round(m.priceYes * 1000)]);

  const shares = quote?.shares ?? (amount * 0.98) / Math.max(price, 0.01);
  const avg = shares > 0 ? amount / shares : price;
  const impact = quote ? Math.abs((side === "yes" ? quote.priceYesAfter : 1 - quote.priceYesAfter) - price) : 0;

  async function submit() {
    setRefusal(null);
    if (!ensureReady()) return;
    if (!pool) return;
    setBusy(true);
    try {
      const r = await acct.back({ marketId: m.id, pool, yes: side === "yes", amount });
      toast.success(`Bought ${r.shares.toFixed(2)} ${side.toUpperCase()}`, { description: `${usd(amount)} on "${m.question}"` });
    } catch (e: any) {
      setRefusal(e?.title ? e : { code: "Error", title: "That didn't go through", body: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Outcome">
        {(["yes", "no"] as const).map((s) => {
          const p = s === "yes" ? m.priceYes : 1 - m.priceYes;
          const on = side === s;
          return (
            <button
              key={s}
              role="radio"
              aria-checked={on}
              disabled={!trading}
              onClick={() => setSide(s)}
              className={cn(
                "flex h-14 items-center justify-between rounded-xl border px-4 transition active:scale-[0.98] disabled:opacity-50",
                on ? (s === "yes" ? "border-yes bg-yes-soft" : "border-no bg-no-soft") : "border-border bg-raised hover:border-border-strong",
              )}
            >
              <span className={cn("text-[15px] font-semibold", on ? (s === "yes" ? "text-yes" : "text-no") : "text-foreground")}>{s === "yes" ? "Yes" : "No"}</span>
              <span className={cn("font-mono text-lg font-semibold tabular", on ? (s === "yes" ? "text-yes" : "text-no") : "text-muted-foreground")}>{cents(p)}</span>
            </button>
          );
        })}
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <label htmlFor={`amt-${m.id}`} className="font-medium text-muted-foreground">
            Amount
          </label>
          <span className="text-faint tabular">Balance {usd(acct.usdc)}</span>
        </div>
        <div className="flex h-14 items-center rounded-xl border border-border bg-sunk px-4 focus-within:border-border-strong">
          <span className="text-2xl font-semibold text-faint">$</span>
          <input
            id={`amt-${m.id}`}
            inputMode="decimal"
            value={amount ? String(amount) : ""}
            onChange={(e) => setAmount(Math.max(0, Math.min(1000, Number(e.target.value.replace(/[^0-9.]/g, "")) || 0)))}
            disabled={!trading}
            className="w-full bg-transparent px-1 text-2xl font-semibold tabular outline-none disabled:opacity-50"
          />
        </div>
        <div className="mt-2 grid grid-cols-4 gap-1.5">
          {[1, 5, 10, 25].map((v) => (
            <button key={v} disabled={!trading} onClick={() => setAmount(v)} className={cn("h-8 rounded-lg text-xs font-medium transition active:scale-[0.97] disabled:opacity-50", amount === v ? "bg-foreground text-background" : "bg-raised text-muted-foreground hover:text-foreground")}>
              ${v}
            </button>
          ))}
        </div>
      </div>

      <dl className="space-y-1.5 text-sm">
        <Row k="Average price" v={cents(avg)} />
        <Row k="Shares" v={shares.toFixed(2)} />
        {impact > 0.01 && <Row k="Price impact" v={<span className="text-warn">{(impact * 100).toFixed(1)} pts</span>} />}
        <div className="flex items-center justify-between pt-1">
          <dt className="text-muted-foreground">To win</dt>
          <dd className="text-xl font-semibold text-yes">
            <NumberFlow value={shares} format={{ style: "currency", currency: "USD" }} className="tabular" />
          </dd>
        </div>
      </dl>

      <Button
        size="lg"
        disabled={!trading || busy || amount <= 0 || !chainOk}
        onClick={submit}
        className={cn("h-12 w-full rounded-xl text-[15px] font-semibold text-white active:scale-[0.99]", side === "yes" ? "bg-yes hover:bg-yes/90" : "bg-no hover:bg-no/90", "dark:text-black")}
      >
        {busy ? <CircleNotchIcon className="animate-spin" /> : null}
        {!chainOk ? "Paused: chain recovering" : !trading ? "Trading closed" : busy ? "Confirming…" : `Buy ${side === "yes" ? "Yes" : "No"} · ${usd(amount, amount % 1 ? 2 : 0)}`}
      </Button>

      <AnimatePresence>
        {refusal && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex gap-3 rounded-xl border border-no/30 bg-no-soft p-3">
              <ProhibitIcon size={20} className="mt-0.5 shrink-0 text-no" weight="bold" />
              <div>
                <div className="text-sm font-semibold">{refusal.title}</div>
                <p className="mt-0.5 text-sm text-muted-foreground">{refusal.body}</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {acct.pass && (
        <div>
          <div className="flex justify-between text-[11px] text-faint">
            <span>Today's limit</span>
            <span className="tabular">
              {usd(acct.stakedToday, 0)} of {usd(acct.pass.dailyCap, 0)}
            </span>
          </div>
          <div className="mt-1 h-1 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-foreground/60 transition-[width]" style={{ width: `${Math.min(100, (acct.stakedToday / acct.pass.dailyCap) * 100)}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex justify-between">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-medium tabular">{v}</dd>
    </div>
  );
}

/** The full market panel for a channel page. */
export function MarketPanel({ m, pool, emptyHint }: { m?: MarketView; pool?: PoolKey; emptyHint?: string }) {
  if (!m) return <NoMarket hint={emptyHint} />;
  return (
    <AnimatePresence mode="wait">
      <motion.section key={m.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }} transition={{ type: "spring", stiffness: 260, damping: 26 }} className="surface overflow-hidden">
        <MarketHeader m={m} />
        <div className="space-y-4 p-4 pt-0">
          {m.phase === "trading" ? <TradeTicket m={m} pool={pool} /> : <AfterLock m={m} />}
          <YourPosition m={m} />
          <RuleDisclosure m={m} />
        </div>
      </motion.section>
    </AnimatePresence>
  );
}

function MarketHeader({ m }: { m: MarketView }) {
  const t = templateById(m.template);
  const delta = m.priceYes - m.pYes0;
  return (
    <div className="space-y-3 p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-xs">
            {m.phase === "trading" ? (
              <span className="flex items-center gap-1.5 font-medium text-live">
                <span className="size-1.5 animate-live rounded-full bg-live" /> Live market
              </span>
            ) : (
              <span className={cn("font-medium", m.phase === "void" ? "text-void" : m.phase === "settled" ? (m.outcome === "YES" ? "text-yes" : "text-no") : "text-warn")}>{m.phase === "void" ? "Voided" : m.phase === "settled" ? `Resolved ${m.outcome}` : "Trading closed"}</span>
            )}
            {t && <span className="text-faint">· {t.title} template</span>}
          </div>
          <h2 className="text-xl font-semibold leading-snug tracking-tight text-balance">{m.question}</h2>
        </div>
        {m.phase === "trading" && <CountdownRing from={m.openedAt} to={m.lockTime} size={44} />}
      </div>
      <div className="flex items-end justify-between">
        <div className="flex items-baseline gap-2">
          <NumberFlow value={Math.round(m.priceYes * 100)} suffix="%" className="text-[34px] font-semibold leading-none tracking-tight tabular" />
          <span className="text-sm text-muted-foreground">chance</span>
          {Math.abs(delta) >= 0.01 && (
            <span className={cn("flex items-center text-sm font-medium tabular", delta > 0 ? "text-yes" : "text-no")}>
              {delta > 0 ? <CaretUpIcon weight="fill" size={12} /> : <CaretDownIcon weight="fill" size={12} />}
              {Math.round(Math.abs(delta) * 100)}
            </span>
          )}
        </div>
        <div className="text-right text-xs text-faint">
          <div className="tabular">{compactUsd(m.volume)} vol</div>
          <div className="tabular">{m.traders} traders</div>
        </div>
      </div>
      {m.trades > 0 && <PriceChart m={m} />}
    </div>
  );
}

function AfterLock({ m }: { m: MarketView }) {
  const acct = useAccount();
  const [pos, setPos] = useState<{ due: number; claimed: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const settled = m.phase === "settled" || m.phase === "void";
  const now = useNow(500);
  useEffect(() => {
    if (!settled || !acct.address) return;
    api<{ positions: { marketId: number; claimable: number; claimed: boolean }[] }>(`/portfolio/${acct.address}`)
      .then((p) => {
        const x = p.positions.find((q) => q.marketId === m.id);
        setPos(x ? { due: x.claimable, claimed: x.claimed } : null);
      })
      .catch(() => {});
  }, [settled, acct.address, m.id]);

  if (settled) {
    const tone = m.outcome === "YES" ? "yes" : m.outcome === "NO" ? "no" : "void";
    return (
      <div className="space-y-3">
        <div className={cn("flex items-center gap-3 rounded-xl p-4", tone === "yes" ? "bg-yes-soft" : tone === "no" ? "bg-no-soft" : "bg-void-soft")}>
          <SealCheckIcon size={28} weight="fill" className={tone === "yes" ? "text-yes" : tone === "no" ? "text-no" : "text-void"} />
          <div>
            <div className={cn("text-lg font-semibold", tone === "yes" ? "text-yes" : tone === "no" ? "text-no" : "text-void")}>{m.outcome === "VOID" ? "Voided, everyone refunded" : `Resolved ${m.outcome === "YES" ? "Yes" : "No"}`}</div>
            <div className="text-xs text-muted-foreground">{m.voidReason ?? "Both read paths agreed."}</div>
          </div>
        </div>
        {pos && pos.due > 0 && !pos.claimed && (
          <Button
            className="h-11 w-full rounded-xl font-semibold"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const v = await acct.claim(m.id);
                toast.success(`Collected ${usd(v)}`);
                setPos({ due: 0, claimed: true });
              } catch (e: any) {
                toast.error(e.shortMessage ?? e.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <CircleNotchIcon className="animate-spin" /> : <CheckCircleIcon weight="fill" />} Collect {usd(pos.due)}
          </Button>
        )}
        <Link href={`/m/${m.id}`} className="flex items-center justify-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          See the receipt <ArrowRightIcon size={14} />
        </Link>
      </div>
    );
  }
  const text =
    m.phase === "locked"
      ? `Trading closed. The window opens in ${Math.max(0, Math.ceil(m.windowStart - now))}s, once every viewer has seen the lock.`
      : m.phase === "window"
        ? now < m.windowEnd
          ? `Playing out. Window ends in ${Math.ceil(m.windowEnd - now)}s or sooner if decided.`
          : "Waiting for both sources to report."
        : "Both sources agree. Posting the result onchain.";
  return (
    <div className="space-y-3 rounded-xl bg-sunk p-4">
      <PhaseSteps m={m} />
      <p className="flex gap-2 text-sm text-muted-foreground">
        {m.phase === "locked" ? <LockSimpleIcon size={16} className="mt-0.5 shrink-0" /> : <ClockIcon size={16} className="mt-0.5 shrink-0" />}
        {text}
      </p>
    </div>
  );
}

export function YourPosition({ m }: { m: MarketView }) {
  const acct = useAccount();
  const trades = useLive((s) => s.trades);
  const { data } = useQuery({
    queryKey: ["portfolio", acct.address, m.id, trades.filter((t) => t.marketId === m.id && t.trader.toLowerCase() === acct.address?.toLowerCase()).length],
    queryFn: () => api<{ positions: { marketId: number; yes: number; no: number; cost: number; value: number }[] }>(`/portfolio/${acct.address}`),
    enabled: !!acct.address,
  });
  const p = data?.positions.find((x) => x.marketId === m.id);
  if (!p) return null;
  return (
    <Item variant="outline" size="sm" className="bg-card shadow-sm">
      <ItemContent>
        <ItemTitle className="font-normal text-muted-foreground">Your position</ItemTitle>
      </ItemContent>
      <ItemActions className="font-medium tabular">
        {p.yes > 0 && <span className="text-yes">{p.yes.toFixed(1)} Yes</span>}
        {p.yes > 0 && p.no > 0 && <span className="text-faint"> · </span>}
        {p.no > 0 && <span className="text-no">{p.no.toFixed(1)} No</span>}
        <span className="text-faint"> · {usd(p.cost)}</span>
      </ItemActions>
    </Item>
  );
}

function RuleDisclosure({ m }: { m: MarketView }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-border">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left text-sm">
        <ShieldCheckIcon size={16} className="text-yes" weight="fill" />
        <span className="font-medium">Rules, committed before trading</span>
        <CaretDownIcon size={14} className={cn("ml-auto text-faint transition", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
            <div className="space-y-2.5 border-t border-border px-3.5 py-3 text-[13px] leading-relaxed">
              <p>{m.rule.resolution}</p>
              <p className="text-muted-foreground">Two separate read paths must report the same moves and result. If they disagree or go missing, the market voids and every stake is refunded, fees included.</p>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-faint">
                <span>Opened at {pct(m.pYes0)}</span>
                <span>Window starts {m.windowStart - m.lockTime}s after lock</span>
                <span className="font-mono">rule {short(m.ruleHash, 8)}</span>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-faint">
                <SparkleIcon size={13} className="mt-0.5 shrink-0" />
                {m.ai.provider === "0g" ? `Picked by the 0G agent (${m.ai.model}${m.ai.requestId ? `, request ${short(m.ai.requestId, 8)}` : ""}).` : "Picked by the offline base-rate model."} {m.ai.rationale}
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function NoMarket({ hint }: { hint?: string }) {
  return (
    <section className="surface p-5">
      <div className="flex items-center gap-3">
        <div className="relative grid size-10 place-items-center rounded-xl bg-raised">
          <SparkleIcon size={20} className="text-muted-foreground" />
          <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-live rounded-full bg-yes" />
        </div>
        <div>
          <div className="text-sm font-semibold">No market right now</div>
          <div className="text-xs text-muted-foreground">{hint ?? "A market opens when the outcome is genuinely uncertain."}</div>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <div className="shimmer h-4 w-3/4 rounded bg-raised/60" />
        <div className="shimmer h-4 w-1/2 rounded bg-raised/60" />
      </div>
    </section>
  );
}

export function TradeTape({ marketId, limit = 8 }: { marketId?: number; limit?: number }) {
  const trades = useLive((s) => s.trades).filter((t) => marketId === undefined || t.marketId === marketId).slice(0, limit);
  if (!trades.length) return <p className="py-4 text-center text-xs text-faint">No trades yet. Be first.</p>;
  return (
    <ul className="space-y-1">
      <AnimatePresence initial={false}>
        {trades.map((t) => (
          <motion.li key={t.tx} layout initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 text-xs">
            <span className={cn("w-8 font-semibold", t.yes ? "text-yes" : "text-no")}>{t.yes ? "YES" : "NO"}</span>
            <span className="font-mono text-faint">{short(t.trader, 5)}</span>
            <span className="ml-auto font-medium tabular">{usd(t.amount, t.amount % 1 ? 2 : 0)}</span>
            <span className="w-10 text-right font-mono text-muted-foreground tabular">{cents(t.priceYesAfter)}</span>
            <span className="w-14 text-right text-faint">{ago(t.at)}</span>
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

/** Compact live-market card for rails and grids. */
export function MarketCard({ m }: { m: MarketView }) {
  const now = useNow(1000);
  const left = Math.max(0, Math.ceil(m.lockTime - now));
  return (
    <Link href={`/c/${m.slug}`} className="surface group flex flex-col gap-3 p-4 transition hover:border-border-strong">
      <div className="flex items-center gap-2 text-xs">
        {m.phase === "trading" ? (
          <span className="flex items-center gap-1.5 font-medium text-live">
            <span className="size-1.5 animate-live rounded-full bg-live" /> {left}s to lock
          </span>
        ) : (
          <span className="text-faint">{m.phase === "settled" || m.phase === "void" ? `Settled ${m.outcome}` : "Playing out"}</span>
        )}
        <span className="ml-auto truncate text-faint">{m.streamTitle}</span>
      </div>
      <div className="line-clamp-2 min-h-[2.75rem] text-[15px] font-semibold leading-snug">{m.question}</div>
      <div>
        <div className="mb-1.5 flex justify-between text-xs font-medium">
          <span className="text-yes tabular">Yes {cents(m.priceYes)}</span>
          <span className="text-no tabular">No {cents(1 - m.priceYes)}</span>
        </div>
        <div className="flex h-1.5 overflow-hidden rounded-full bg-no/70">
          <motion.div className="h-full bg-yes" animate={{ width: `${m.priceYes * 100}%` }} transition={{ type: "spring", stiffness: 140, damping: 22 }} />
        </div>
      </div>
      <div className="flex justify-between text-xs text-faint">
        <span className="tabular">{compactUsd(m.volume)} vol</span>
        <span className="flex items-center gap-1 text-muted-foreground transition group-hover:text-foreground">
          Trade <ArrowRightIcon size={12} />
        </span>
      </div>
    </Link>
  );
}

export function ReceiptRow({ r }: { r: Receipt }) {
  const tone = r.verdict === "YES" ? "text-yes bg-yes-soft" : r.verdict === "NO" ? "text-no bg-no-soft" : "text-void bg-void-soft";
  return (
    <Link href={`/m/${r.marketId}`} className="flex items-center gap-3 rounded-xl px-3 py-2.5 transition hover:bg-raised/60">
      <span className={cn("w-12 shrink-0 rounded-md py-0.5 text-center text-[11px] font-semibold", tone)}>{r.verdict}</span>
      <span className="min-w-0 flex-1 truncate text-sm">{r.question}</span>
      <Tooltip>
        <TooltipTrigger asChild>
          <ShieldCheckIcon size={16} className="shrink-0 text-faint" />
        </TooltipTrigger>
        <TooltipContent>Two sources agreed · evidence {short(r.evidenceRoot, 8)}</TooltipContent>
      </Tooltip>
      <span className="w-16 shrink-0 text-right text-xs text-faint">{ago(r.resolvedAt)}</span>
    </Link>
  );
}
