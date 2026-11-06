"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftIcon, ArrowSquareOutIcon, CheckCircleIcon, CopyIcon, DatabaseIcon, SparkleIcon, XCircleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ruleHash, type MarketView, type PricePoint, type Receipt, type SourceReading, type TradeEvent } from "@clutch/shared";
import { MarketPanel, PriceChart, TradeTape, isOpen } from "@/components/market";
import { api, useLive } from "@/lib/live";
import { ENGINE_URL, chain, explorerTx } from "@/lib/env";
import { compactUsd, pct, short } from "@/lib/format";
import { cn } from "@/lib/utils";

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const { data, error } = useQuery({
    queryKey: ["market", Number(id)],
    queryFn: () => api<{ market: MarketView; history: PricePoint[]; trades: TradeEvent[]; receipt: Receipt | null }>(`/markets/${id}`),
    refetchInterval: (q) => (q.state.data?.receipt ? false : 5000),
  });
  const liveM = useLive((s) => s.markets[Number(id)]);
  const m = liveM ?? data?.market;
  const { data: ch } = useQuery({ queryKey: ["stream", m?.slug], queryFn: () => api<{ pool: { key: any } }>(`/streams/${m!.slug}`), enabled: !!m && isOpen(m) });

  if (error) return <div className="p-10 text-center text-muted-foreground">Market not found.</div>;
  if (!m) return <div className="mx-auto max-w-5xl p-6"><div className="shimmer h-80 rounded-2xl bg-surface" /></div>;
  const r = data?.receipt;

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-6 sm:px-6">
      <Link href={`/c/${m.slug}`} className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeftIcon size={14} /> {m.streamTitle}
      </Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-6">
          <header className="surface overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3 text-xs">
              <Verdict m={m} />
              <span className="font-mono text-faint">Market #{m.id}</span>
              <span className="text-faint">·</span>
              <span className="text-muted-foreground">{chain.name}{chain.testnet ? " · testnet" : ""}</span>
              <span className="ml-auto text-faint">{new Date(m.openedAt * 1000).toLocaleString()}</span>
            </div>
            <div className="px-5 py-5">
              <h1 className="text-[26px] font-semibold leading-tight tracking-[-0.025em] sm:text-3xl">{m.question}</h1>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  ["Opened at", `${pct(m.pYes0)} Yes`],
                  ["Last price", `${pct(m.priceYes)} Yes`],
                  ["Volume", compactUsd(m.volume)],
                  ["Traders", String(m.traders)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-[11.5px] text-faint">{k}</dt>
                    <dd className="mt-0.5 font-mono text-[15px] font-semibold tabular">{v}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
                <TxLink label="Opened" hash={m.tx.open} />
                <TxLink label="Settled" hash={m.tx.resolve} pending={m.phase !== "settled" && m.phase !== "void" ? "not yet settled" : "awaiting confirmation"} />
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(location.href);
                    toast.success("Receipt link copied");
                  }}
                  className="ml-auto inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"
                >
                  <CopyIcon size={13} /> Copy permalink
                </button>
              </div>
            </div>
          </header>
          {m.trades > 0 ? (
            <section className="surface p-5">
              <h2 className="mb-2 text-sm font-semibold">Yes price over time</h2>
              <PriceChart m={m} height={200} />
            </section>
          ) : (
            <p className="rounded-2xl border border-dashed border-border px-5 py-4 text-sm text-faint">No trades on this market, so it stayed at its opening price of {pct(m.pYes0)} Yes.</p>
          )}
          {r ? <ReceiptView r={r} /> : <Pending m={m} />}
          <section className="surface p-5">
            <h2 className="mb-3 text-sm font-semibold">Trades</h2>
            <TradeTape marketId={m.id} limit={30} />
          </section>
        </div>
        <aside className="lg:sticky lg:top-[76px] lg:h-fit">
          <MarketPanel m={m} pool={ch?.pool.key} />
        </aside>
      </div>
    </div>
  );
}

function Pending({ m }: { m: MarketView }) {
  return (
    <section className="surface p-5">
      <h2 className="text-sm font-semibold">Receipt</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {m.phase === "settled" || m.phase === "void" ? "Settled onchain. Receipt details are loading." : "The receipt appears here the moment both sources agree and the result is posted onchain."}
      </p>
      <Step n={1} title="Rule committed before trading" ok>
        <p className="text-sm text-muted-foreground">{m.rule.resolution}</p>
        <HashCheck rule={m.rule} hash={m.ruleHash} />
      </Step>
    </section>
  );
}

function ReceiptView({ r }: { r: Receipt }) {
  const tone = r.verdict === "YES" ? "yes" : r.verdict === "NO" ? "no" : "void";
  return (
    <section className="surface overflow-hidden">
      <div className={cn("flex items-center justify-between gap-4 p-5", tone === "yes" ? "bg-yes-soft" : tone === "no" ? "bg-no-soft" : "bg-void-soft")}>
        <div>
          <div className="text-xs font-medium text-muted-foreground">Result</div>
          <div className={cn("text-2xl font-semibold", tone === "yes" ? "text-yes" : tone === "no" ? "text-no" : "text-void")}>
            {r.verdict === "VOID" ? "Void: everyone refunded" : `Resolved ${r.verdict === "YES" ? "Yes" : "No"}`}
          </div>
          {r.voidReason && <p className="mt-1 text-sm text-muted-foreground">{r.voidReason}</p>}
        </div>
        <span className="text-right text-xs text-muted-foreground">{new Date(r.resolvedAt).toLocaleString()}</span>
      </div>
      <div className="space-y-1 p-5">
        <Step n={1} title="Rule committed before any trade" ok>
          <p className="text-sm leading-relaxed">{r.rule.resolution}</p>
          <p className="mt-1 text-sm text-muted-foreground">{r.rule.agreement}</p>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
            <KV k="Trading closed" v={new Date(r.rule.lockTime * 1000).toLocaleTimeString()} />
            <KV k="Window" v={`${new Date(r.rule.windowStart * 1000).toLocaleTimeString()} to ${new Date(r.rule.windowEnd * 1000).toLocaleTimeString()}`} />
            <KV k="Latency buffer" v={`${r.rule.windowStart - r.rule.lockTime}s after close`} />
          </div>
          <HashCheck rule={r.rule} hash={r.ruleHash} />
        </Step>
        <Step n={2} title={r.rule.adapter === "vision" ? "Two independent readers of the stream" : "Two independent sources"} ok={r.verdict !== "VOID"}>
          <div className="grid gap-3 md:grid-cols-2">
            {r.readings.map((rd, i) => (
              <Reading key={rd.source} rd={rd} unit={r.rule.adapter === "vision" ? "frames" : "plies"} label={i === 0 ? (r.rule.adapter === "vision" ? "Reader A" : "Source A") : r.rule.adapter === "vision" ? "Reader B" : "Source B"} />
            ))}
          </div>
          {r.frames && r.frames.length > 0 && (
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {r.frames.map((f) => (
                <figure key={f.url} className="overflow-hidden rounded-xl border border-border">
                  <img src={`${ENGINE_URL}${f.url}`} alt={f.summary} className="aspect-video w-full object-cover" loading="lazy" />
                  <figcaption className="px-3 py-2 text-[11px] text-muted-foreground">
                    {new Date(f.at).toLocaleTimeString()} · {f.reader}: {f.summary}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </Step>
        <Step n={3} title="Evidence and settlement" ok>
          <div className="space-y-2 text-sm">
            <Line k="Evidence (0G Merkle root)" v={<a className="font-mono text-xs underline decoration-border-strong underline-offset-4" href={`${ENGINE_URL}${r.storage.uri}`} target="_blank" rel="noreferrer">{short(r.evidenceRoot, 10)}</a>} />
            <Line k="Stored on" v={r.storage.provider === "0g" ? "0G Storage" : "Clutch (0G upload not configured)"} />
            {r.tx && <Line k="Settlement" v={explorerTx(r.tx) ? <a className="inline-flex items-center gap-1 font-mono text-xs" href={explorerTx(r.tx)} target="_blank" rel="noreferrer">{short(r.tx, 10)} <ArrowSquareOutIcon size={12} /></a> : <span className="font-mono text-xs">{short(r.tx, 10)}</span>} />}
            {r.blackout && <Line k="Blackout Guard" v={<span className="text-void">Sequencer outage during trading: voided</span>} />}
          </div>
          <a href={`${ENGINE_URL}${r.storage.uri}`} target="_blank" rel="noreferrer" className="mt-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <DatabaseIcon size={14} /> Download the evidence and replay the rule yourself
          </a>
        </Step>
        <Step n={4} title="Why this market existed" ok>
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <SparkleIcon size={16} className="mt-0.5 shrink-0" />
            <span>
              {r.ai.provider === "0g" ? `Opened by the 0G agent (${r.ai.model})` : "Opened by the offline base-rate model"}
              {r.ai.requestId ? `, request ${r.ai.requestId}` : ""}. {r.ai.rationale}
            </span>
          </div>
        </Step>
      </div>
    </section>
  );
}

function HashCheck({ rule, hash }: { rule: Receipt["rule"]; hash: string }) {
  const ok = ruleHash(rule) === hash;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-sunk px-3 py-2 text-xs">
      <span className="text-faint">Rule hash</span>
      <span className="font-mono text-muted-foreground">{short(hash, 12)}</span>
      <span className={cn("ml-auto flex items-center gap-1 font-medium", ok ? "text-yes" : "text-no")}>
        {ok ? <CheckCircleIcon weight="fill" size={14} /> : <XCircleIcon weight="fill" size={14} />}
        {ok ? "Recomputed in your browser: matches" : "Mismatch"}
      </span>
    </div>
  );
}

function Step({ n, title, ok, children }: { n: number; title: string; ok: boolean; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[28px_1fr] gap-3 py-3">
      <span className={cn("grid size-7 place-items-center rounded-full text-xs font-semibold", ok ? "bg-yes-soft text-yes" : "bg-void-soft text-void")}>{n}</span>
      <div className="min-w-0">
        <h3 className="mb-2 text-sm font-semibold">{title}</h3>
        {children}
      </div>
    </div>
  );
}

function Reading({ rd, label, unit }: { rd: SourceReading; label: string; unit: string }) {
  return (
    <div className="rounded-xl border border-border bg-sunk p-3.5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium">{label}</div>
          <div className="font-mono text-[11px] text-faint">{rd.source}</div>
        </div>
        <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-semibold", rd.evaluation === "YES" ? "bg-yes-soft text-yes" : rd.evaluation === "NO" ? "bg-no-soft text-no" : "bg-void-soft text-void")}>{rd.evaluation}</span>
      </div>
      <div className="mt-2 text-[11px] text-faint">
        {rd.plies} {unit} · {rd.status}
        {rd.winner ? ` · ${rd.winner} won` : ""}
      </div>
      {rd.excerpt.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {rd.excerpt.slice(0, 16).map((p, i) => (
            <span key={i} className="rounded bg-raised px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" title={`material ${p.material}`}>
              {p.san}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg bg-sunk px-3 py-2">
      <div className="text-faint">{k}</div>
      <div className="mt-0.5 font-medium">{v}</div>
    </div>
  );
}

function Line({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex flex-wrap justify-between gap-2">
      <span className="text-muted-foreground">{k}</span>
      <span>{v}</span>
    </div>
  );
}

function Verdict({ m }: { m: MarketView }) {
  const map: Record<string, [string, string]> = {
    trading: ["Trading", "bg-live/15 text-live"],
    locked: ["Trading closed", "bg-warn-soft text-warn"],
    window: ["Event playing out", "bg-warn-soft text-warn"],
    resolving: ["Checking result", "bg-info-soft text-info"],
    void: ["Void · refunded", "bg-void-soft text-void"],
  };
  const [label, cls] =
    m.phase === "settled" ? (m.outcome === "YES" ? ["Resolved YES", "bg-yes-soft text-yes"] : ["Resolved NO", "bg-no-soft text-no"]) : (map[m.phase] ?? [m.phase, "bg-raised text-muted-foreground"]);
  return <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px] font-bold", cls)}>{label}</span>;
}

function TxLink({ label, hash, pending }: { label: string; hash?: string; pending?: string }) {
  if (!hash) return <span className="text-faint">{label}: {pending ?? "—"}</span>;
  const url = explorerTx(hash);
  return url ? (
    <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground">
      {label} <span className="font-mono">{short(hash, 8)}</span> <ArrowSquareOutIcon size={12} />
    </a>
  ) : (
    <span className="text-muted-foreground">
      {label} <span className="font-mono">{short(hash, 8)}</span> <span className="text-faint">(local chain)</span>
    </span>
  );
}
