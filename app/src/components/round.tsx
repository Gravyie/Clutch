"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { CircleNotchIcon, LockSimpleIcon, ProhibitIcon, ScanIcon, SealCheckIcon, SparkleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { MarketView, StreamState } from "@clutch/shared";
import { CountdownRing, PriceChart, isOpen } from "@/components/market";
import { useEnsureReady } from "@/components/onboarding";
import { CallMarket } from "@/components/call";
import { useAccount, type PoolKey, type Refusal } from "@/lib/account";
import { useLive, useNow } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { ENGINE_URL } from "@/lib/env";
import { ago, cents, compactUsd, usd } from "@/lib/format";
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

/** One round: the live question, one-tap Yes/No, then a live "playing out" view and the verdict. */
export function RoundPanel({ m, stream, pool, next }: { m?: MarketView; stream?: StreamState; pool?: PoolKey; next?: string }) {
  if (!m) return <Waiting stream={stream} hint={next} />;
  return (
    <AnimatePresence mode="wait">
      <motion.section key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ type: "spring", stiffness: 280, damping: 28 }} className="surface overflow-hidden">
        <div className="grid gap-5 p-5 md:grid-cols-[minmax(0,1fr)_320px]">
          <Question m={m} stream={stream} />
          {m.phase === "trading" ? <OneTap m={m} pool={pool} /> : <AfterLock m={m} stream={stream} />}
        </div>
      </motion.section>
    </AnimatePresence>
  );
}

function Question({ m, stream }: { m: MarketView; stream?: StreamState }) {
  const delta = m.priceYes - m.pYes0;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2 text-xs">
        {m.phase === "trading" ? (
          <span className="flex items-center gap-1.5 font-semibold text-live">
            <span className="size-1.5 animate-live rounded-full bg-live" /> LIVE MARKET
          </span>
        ) : m.phase === "settled" || m.phase === "void" ? (
          <span className="font-semibold text-muted-foreground">RESULT</span>
        ) : (
          <span className="flex items-center gap-1.5 font-semibold text-warn">
            <LockSimpleIcon size={12} weight="bold" /> LOCKED · PLAYING OUT
          </span>
        )}
        <span className="text-faint">
          · {compactUsd(m.volume)} vol · {m.traders} {m.traders === 1 ? "trader" : "traders"}
        </span>
      </div>
      <div className="mt-2 flex items-start gap-4">
        <h2 className="display flex-1 text-[26px] font-bold leading-[1.05] sm:text-[32px]">{m.question}</h2>
        {m.phase === "trading" && <CountdownRing from={m.openedAt} to={m.lockTime} size={52} />}
      </div>
      <div className="mt-3 flex items-baseline gap-2">
        <NumberFlow value={Math.round(m.priceYes * 100)} suffix="%" className="text-3xl font-semibold tracking-tight tabular" />
        <span className="text-sm text-muted-foreground">chance of Yes</span>
        {Math.abs(delta) >= 0.01 && <span className={cn("text-sm font-medium tabular", delta > 0 ? "text-yes" : "text-no")}>{delta > 0 ? "▲" : "▼"} {Math.round(Math.abs(delta) * 100)}</span>}
      </div>
      <PriceChart m={m} height={72} />
      <p className="mt-1 flex items-start gap-1.5 text-xs text-faint">
        <SparkleIcon size={13} className="mt-px shrink-0" />
        <span className="line-clamp-2">
          {m.ai.paidBy === "viewer" ? "Called by a viewer on their own 0G credits" : m.ai.provider === "0g" ? "Opened and priced by the 0G agent" : "Opened from base rates"}
          {m.ai.rationale ? `: ${m.ai.rationale.replace(/\.$/, "")}.` : "."}
        </span>
      </p>
    </div>
  );
}

/** Tap a side: the trade goes through with the chosen stake. No confirm step, no wallet pop-up. */
function OneTap({ m, pool }: { m: MarketView; pool?: PoolKey }) {
  const acct = useAccount();
  const ensureReady = useEnsureReady();
  const verify = useUI((s) => s.openVerify);
  const chain = useLive((s) => s.chain);
  const [stake, setStake] = useState(5);
  const [busy, setBusy] = useState<"yes" | "no" | null>(null);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const chainOk = !chain || chain.sequencerPhase === "Normal";

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
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-4 gap-1.5" role="radiogroup" aria-label="Stake">
        {STAKES.map((v) => (
          <button key={v} role="radio" aria-checked={stake === v} onClick={() => setStake(v)} className={cn("h-9 rounded-lg text-sm font-semibold transition active:scale-[0.97]", stake === v ? "bg-foreground text-background" : "bg-raised text-muted-foreground hover:text-foreground")}>
            ${v}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {([true, false] as const).map((yes) => {
          const price = yes ? m.priceYes : 1 - m.priceYes;
          return (
            <button
              key={String(yes)}
              disabled={busy !== null || !chainOk}
              onClick={() => go(yes)}
              className={cn(
                "group relative flex h-[84px] flex-col items-center justify-center overflow-hidden rounded-xl text-white transition active:scale-[0.98] disabled:opacity-60",
                yes ? "bg-yes hover:brightness-110" : "bg-no hover:brightness-110",
                "dark:text-black",
              )}
            >
              {busy === (yes ? "yes" : "no") ? (
                <CircleNotchIcon size={26} className="animate-spin" />
              ) : (
                <>
                  <span className="text-lg font-bold">
                    {yes ? "Yes" : "No"} {cents(price)}
                  </span>
                  <span className="text-xs font-medium opacity-80">pays ≈{usd((stake * 0.98) / Math.max(price, 0.01))}</span>
                </>
              )}
            </button>
          );
        })}
      </div>
      {!chainOk && <p className="text-xs text-warn">Chain recovering: trading paused by Blackout Guard.</p>}
      <AnimatePresence>
        {refusal && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="flex gap-2.5 rounded-xl border border-no/30 bg-no-soft p-3">
              <ProhibitIcon size={18} className="mt-0.5 shrink-0 text-no" weight="bold" />
              <div>
                <div className="text-sm font-semibold">{refusal.title}</div>
                <p className="text-xs text-muted-foreground">{refusal.code === "DailyCapExceeded" && !acct.verified ? `That's the ${usd(acct.pass?.dailyCap ?? 10, 0)} starter limit for this wallet.` : refusal.body}</p>
                {refusal.code === "DailyCapExceeded" && !acct.verified && (
                  <button onClick={() => verify()} className="mt-2 text-xs font-semibold text-brand underline underline-offset-4">
                    Raise it with World ID
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="text-center text-[11px] text-faint">{acct.onboarded ? `${usd(acct.spendable)} available${acct.usdc < stake && acct.eth > 0 ? " · pays in ETH" : ""} · tap a side` : "One World ID check, then every trade is one tap"}</p>
    </div>
  );
}

function AfterLock({ m, stream }: { m: MarketView; stream?: StreamState }) {
  const now = useNow(500);
  const progress = useCounterProgress(m, stream);
  if (m.phase === "settled" || m.phase === "void") {
    const tone = m.outcome === "YES" ? "yes" : m.outcome === "NO" ? "no" : "void";
    return (
      <div className={cn("flex flex-col justify-center rounded-xl p-5", tone === "yes" ? "bg-yes-soft" : tone === "no" ? "bg-no-soft" : "bg-void-soft")}>
        <SealCheckIcon size={30} weight="fill" className={tone === "yes" ? "text-yes" : tone === "no" ? "text-no" : "text-void"} />
        <div className={cn("mt-2 text-2xl font-bold", tone === "yes" ? "text-yes" : tone === "no" ? "text-no" : "text-void")}>{m.outcome === "VOID" ? "Void · refunded" : m.outcome === "YES" ? "Yes" : "No"}</div>
        <p className="mt-1 text-xs text-muted-foreground">{m.voidReason ?? "Both AI readers agreed on their own frames."}</p>
        <Link href={`/m/${m.id}`} className="mt-3 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">
          See the receipt
        </Link>
      </div>
    );
  }
  const total = Math.max(1, m.windowEnd - m.windowStart);
  const frac = now < m.windowStart ? 0 : Math.min(1, (now - m.windowStart) / total);
  return (
    <div className="flex flex-col justify-center gap-3 rounded-xl bg-sunk p-5">
      <div className="text-xs font-semibold text-muted-foreground">{now < m.windowStart ? `Window opens in ${Math.ceil(m.windowStart - now)}s` : m.phase === "resolving" ? "Both readers checking the result…" : `Playing out · ${Math.max(0, Math.ceil(m.windowEnd - now))}s left`}</div>
      <div className="h-1.5 overflow-hidden rounded-full bg-raised">
        <div className="h-full rounded-full bg-warn transition-[width] duration-500" style={{ width: `${frac * 100}%` }} />
      </div>
      {progress && (
        <div className="flex items-center justify-between rounded-lg bg-surface px-3 py-2.5">
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <ScanIcon size={14} className="text-yes" /> {progress.label}
          </span>
          <span className="font-mono text-lg font-semibold tabular">
            {progress.now}
            {progress.target !== undefined && <span className="text-xs font-normal text-faint"> / {progress.target}</span>}
          </span>
        </div>
      )}
      <p className="text-[11px] text-faint">Live AI reading. The result is settled by two independent readers.</p>
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
    [markets, stream?.slug, Math.floor(now / 5)],
  );
  return (
    <section className="surface p-5">
      <div className="flex items-center gap-4">
        <div className="relative grid size-11 shrink-0 place-items-center rounded-xl bg-raised">
          <ScanIcon size={22} className="text-muted-foreground" />
          {stream?.reading && <span className="absolute -right-0.5 -top-0.5 size-2.5 animate-live rounded-full bg-yes" />}
        </div>
        <div className="min-w-0">
          <div className="text-sm font-semibold">Next market on this stream is coming</div>
          <div className="text-sm text-muted-foreground">{hint ?? "Markets open when the action gets uncertain."}</div>
        </div>
      </div>
      {elsewhere.length > 0 && (
        <div className="mt-4">
          <div className="eyebrow mb-2">Trading now on other streams</div>
          <div className="grid gap-2 sm:grid-cols-3">
            {elsewhere.map((m) => (
              <Link key={m.id} href={`/c/${m.slug}`} className="group rounded-xl border border-border bg-raised/40 p-3 transition hover:border-brand/50">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="truncate font-medium text-muted-foreground">{m.streamTitle}</span>
                  <span className="shrink-0 font-mono text-live tabular">{Math.max(0, Math.ceil(m.lockTime - now))}s</span>
                </div>
                <div className="mt-1 line-clamp-2 text-[13px] font-semibold leading-snug">{m.question}</div>
                <div className="mt-2 flex gap-1.5 font-mono text-[11px] font-semibold">
                  <span className="rounded-md bg-yes-soft px-1.5 py-0.5 text-yes">Yes {Math.round(m.priceYes * 100)}¢</span>
                  <span className="rounded-md bg-no-soft px-1.5 py-0.5 text-no">No {100 - Math.round(m.priceYes * 100)}¢</span>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}
      {callable && stream && <CallMarket slug={stream.slug} className="mt-4" />}
    </section>
  );
}

/** What the AI reads off the stream right now: every counter, live. */
export function VisionPanel({ s }: { s?: StreamState }) {
  const now = useNow(1000);
  if (!s || s.media?.kind !== "video") return null;
  const v = s.vision;
  const fresh = v && now * 1000 - v.at < 30_000;
  return (
    <section className="surface overflow-hidden">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <ScanIcon size={16} className={fresh ? "text-yes" : "text-faint"} /> What the AI sees
        </h3>
        {v && <span className="text-[11px] text-faint">{Math.max(0, Math.round(now - v.at / 1000))}s ago</span>}
      </div>
      {s.frameAt && <img src={`${ENGINE_URL}/frames/${s.slug}.jpg?t=${Math.floor(s.frameAt / 2000)}`} alt="Latest frame the AI read" className="aspect-video w-full object-cover" />}
      <div className="space-y-2 p-4">
        {!v ? (
          <p className="text-sm text-faint">{s.reading ? "Starting to read this stream…" : s.rerun ? "Reruns are never read: the result already happened." : "Queued for an AI reader."}</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={cn("rounded-md px-2 py-0.5 text-xs font-medium", v.state.mode === "gameplay" ? "bg-yes-soft text-yes" : "bg-raised text-muted-foreground")}>{v.state.mode}</span>
              {v.state.povAlive !== null && <span className="rounded-md bg-raised px-2 py-0.5 text-xs text-muted-foreground">player {v.state.povAlive ? "alive" : "down"}</span>}
              {v.state.game && <span className="truncate text-xs text-faint">{v.state.game}</span>}
            </div>
            {v.state.counters && v.state.counters.length > 0 ? (
              <dl className="grid grid-cols-2 gap-1.5">
                {v.state.counters.slice(0, 8).map((c) => (
                  <div key={c.key} className="rounded-lg bg-sunk px-2.5 py-1.5">
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
      </div>
    </section>
  );
}

/** Other markets on this channel that are locked and playing out. */
export function PlayingOut({ slug, exclude }: { slug: string; exclude?: number }) {
  const list = Object.values(useLive((s) => s.markets)).filter((m) => m.slug === slug && isOpen(m) && m.phase !== "trading" && m.id !== exclude);
  if (!list.length) return null;
  return (
    <section className="surface p-4">
      <h3 className="mb-2 text-sm font-semibold">Playing out</h3>
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.id}>
            <Link href={`/m/${m.id}`} className="flex items-center justify-between gap-3 text-sm">
              <span className="truncate">{m.question}</span>
              <span className="shrink-0 font-mono text-xs text-yes tabular">{cents(m.priceYes)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The last results on this channel, newest first. */
export function RecentRounds({ slug }: { slug: string }) {
  const receipts = useLive((s) => s.receipts).filter((r) => r.slug === slug).slice(0, 10);
  if (!receipts.length) return null;
  return (
    <section className="surface p-4">
      <h3 className="mb-2.5 text-sm font-semibold">Recent results</h3>
      <ul className="space-y-1.5">
        {receipts.map((r) => (
          <li key={r.marketId}>
            <Link href={`/m/${r.marketId}`} className="flex items-center gap-2.5 text-sm">
              <span className={cn("w-11 shrink-0 rounded-md py-0.5 text-center text-[11px] font-semibold", r.verdict === "YES" ? "bg-yes-soft text-yes" : r.verdict === "NO" ? "bg-no-soft text-no" : "bg-void-soft text-void")}>{r.verdict}</span>
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{r.question}</span>
              <span className="shrink-0 text-[11px] text-faint">{ago(r.resolvedAt)}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
