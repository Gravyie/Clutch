"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ArrowUpRightIcon, CircleNotchIcon, CubeIcon, LightningIcon, SignOutIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/live";
import { cn } from "@/lib/utils";

/**
 * "Call a market": a viewer asks the AI to open a market on this stream right now, and the 0G inference that reads
 * the frame and writes the market is billed to the viewer's own 0G account. The key stays in this browser and is
 * sent with each call only; the engine never stores it.
 */

const KEY = "clutch.zg.key";
const SPENT = "clutch.zg.spent";

type CallResult = { ok: true; marketId: number; question: string; costUsd: number; requestId?: string };

function read<T>(k: string, fallback: T): T {
  try {
    const v = localStorage.getItem(k);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function write(k: string, v: unknown) {
  try {
    if (v === undefined) localStorage.removeItem(k);
    else localStorage.setItem(k, JSON.stringify(v));
  } catch {}
}

export function useZgKey() {
  const [key, setKey] = useState<string | undefined>();
  const [spent, setSpent] = useState<{ usd: number; calls: number }>({ usd: 0, calls: 0 });
  useEffect(() => {
    setKey(read<string | undefined>(KEY, undefined));
    setSpent(read(SPENT, { usd: 0, calls: 0 }));
  }, []);
  return {
    key,
    spent,
    connect: (k: string) => (write(KEY, k), setKey(k)),
    disconnect: () => (write(KEY, undefined), write(SPENT, undefined), setKey(undefined), setSpent({ usd: 0, calls: 0 })),
    record: (usd: number) =>
      setSpent((s) => {
        const n = { usd: s.usd + usd, calls: s.calls + 1 };
        write(SPENT, n);
        return n;
      }),
  };
}

export function CallMarket({ slug, className }: { slug: string; className?: string }) {
  const zg = useZgKey();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<CallResult | { ok: false; reason: string } | null>(null);

  async function call() {
    if (!zg.key) return setOpen(true);
    setBusy(true);
    setLast(null);
    try {
      const r = await api<CallResult>(`/streams/${slug}/call`, { body: { zgKey: zg.key } });
      zg.record(r.costUsd);
      setLast(r);
      toast.success("Your market is live", { description: r.question });
    } catch (e: any) {
      setLast({ ok: false, reason: String(e?.message ?? e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn("rounded-2xl border border-dashed border-border-strong p-4", className)}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto]">
        <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">
          <CubeIcon size={18} weight="duotone" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">Don't want to wait? Call one.</div>
          <div className="text-xs text-muted-foreground">
            {zg.key
              ? `Billed to your 0G credits${zg.spent.calls ? ` · you've spent $${zg.spent.usd.toFixed(4)} on ${zg.spent.calls} call${zg.spent.calls === 1 ? "" : "s"}` : ""}`
              : "The AI reads the stream now and opens a market, paid for by your own 0G credits."}
          </div>
        </div>
        <Button onClick={call} disabled={busy} className="col-span-2 h-10 rounded-full bg-brand px-4 font-semibold text-brand-foreground hover:bg-brand/90 sm:col-span-1">
          {busy ? <CircleNotchIcon className="animate-spin" /> : <LightningIcon weight="fill" />}
          {busy ? "Reading the stream…" : zg.key ? "Call a market" : "Connect 0G"}
        </Button>
      </div>

      <AnimatePresence>
        {last && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            {last.ok ? (
              <div className="mt-3 rounded-xl bg-sunk px-3 py-2.5 font-mono text-[11px] text-muted-foreground">
                <div className="truncate text-foreground">#{last.marketId} · {last.question}</div>
                <div className="mt-1 flex flex-wrap gap-x-4">
                  <span>cost ${last.costUsd.toFixed(5)}</span>
                  {last.requestId && <span className="truncate">request {last.requestId}</span>}
                  <a href="https://pc.0g.ai" target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-brand hover:underline">
                    0G activity <ArrowUpRightIcon size={11} />
                  </a>
                </div>
              </div>
            ) : (
              <p className="mt-3 text-xs text-warn">{last.reason}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {zg.key && (
        <button onClick={zg.disconnect} className="mt-2 inline-flex items-center gap-1 text-[11px] text-faint hover:text-foreground">
          <SignOutIcon size={11} /> Disconnect 0G
        </button>
      )}

      <ConnectDialog open={open} onOpenChange={setOpen} onConnect={(k) => (zg.connect(k), setOpen(false))} />
    </div>
  );
}

function ConnectDialog({ open, onOpenChange, onConnect }: { open: boolean; onOpenChange: (o: boolean) => void; onConnect: (k: string) => void }) {
  const [v, setV] = useState("");
  const valid = /^sk-[A-Za-z0-9-]{20,}$/.test(v.trim());
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl border-border bg-surface sm:max-w-[440px]">
        <span className="grid size-11 place-items-center rounded-2xl bg-brand-soft text-brand">
          <CubeIcon size={22} weight="duotone" />
        </span>
        <DialogTitle className="display text-2xl font-bold">Use your 0G credits</DialogTitle>
        <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
          Calling a market runs two vision models on 0G Private Computer: one reads the stream and writes the market, the other checks it can be settled. That inference is billed to your 0G account, usually well under a cent.
        </DialogDescription>
        <ol className="space-y-2 text-sm text-muted-foreground">
          <li>
            1. Open{" "}
            <a href="https://pc.0g.ai" target="_blank" rel="noreferrer" className="font-medium text-foreground underline underline-offset-4">
              pc.0g.ai
            </a>{" "}
            and sign in. New accounts get free daily credits.
          </li>
          <li>2. Go to API keys and create one.</li>
          <li>3. Paste it here. It stays in this browser and is only sent with your calls.</li>
        </ol>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (valid) onConnect(v.trim());
          }}
          className="space-y-3"
        >
          <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="sk-…" autoComplete="off" spellCheck={false} className="h-11 rounded-xl font-mono" aria-label="0G API key" />
          <Button type="submit" disabled={!valid} className="h-11 w-full rounded-full bg-brand font-semibold text-brand-foreground hover:bg-brand/90">
            Connect
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
