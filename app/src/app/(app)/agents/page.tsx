"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { QRCodeSVG } from "qrcode.react";
import { CheckCircleIcon, CircleNotchIcon, CopyIcon, FingerprintIcon, ProhibitIcon, RobotIcon, TerminalWindowIcon, XCircleIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccount, useConfig } from "@/lib/account";
import { api } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { ago, short, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Start = { attempt: string; userCode: string; verificationUri: string; verificationUriComplete: string; expiresAt: number; agent: string; capUsdc: number; dev?: boolean };
type Poll = { attempt: string; status: "pending" | "approved" | "denied" | "expired"; reason?: string; dev: boolean };
type AgentRow = { address: string; name: string; capUsdc: number; authorizedAt: number; expiresAt: number; status: "active" | "revoked" | "expired" };

const RUN = "pnpm --filter @clutch/engine agent";

/**
 * Agents: let an AI trade for you, inside your limits. Authorizing one is the protected action, and it takes a fresh
 * World ID approval (World ID Agent Pass). The agent's pass carries your human ID, so it shares your daily cap.
 */
export default function AgentsPage() {
  const acct = useAccount();
  const { data: cfg } = useConfig();
  const open = useUI((s) => s.openVerify);
  const qc = useQueryClient();
  const [token, setToken] = useState<string>();
  const verified = acct.verified;

  const { data: agents } = useQuery({
    queryKey: ["agents", token],
    queryFn: () => api<AgentRow[]>("/agents", { token }),
    enabled: Boolean(token),
    refetchInterval: 15_000,
  });

  useEffect(() => {
    if (acct.token) setToken(acct.token);
  }, [acct.token]);

  const configured = cfg?.world.agentPass || cfg?.world.agentPassDev;

  return (
    <div className="mx-auto max-w-[1100px] space-y-10 px-4 py-8 sm:px-6">
      <header className="grid gap-6 lg:grid-cols-[1fr_380px] lg:items-end">
        <div>
          <div className="eyebrow flex items-center gap-2 text-brand">
            <RobotIcon size={14} weight="bold" /> World ID Agent Pass
          </div>
          <h1 className="display mt-3 text-[2.9rem] sm:text-[3.6rem]">Let an agent trade for you.</h1>
          <p className="mt-4 max-w-[58ch] text-[15px] leading-relaxed text-muted-foreground">
            Markets last thirty seconds, so agents will trade them. On Clutch an agent always acts for one verified person: you approve it with World ID, and
            its pass carries your human ID, so it shares your daily limit onchain. It can never spend past what you could.
          </p>
        </div>
        <ol className="surface space-y-3 p-5 text-sm">
          {[
            ["Run an agent", <code key="c" className="font-mono text-xs">{RUN}</code>],
            ["Paste its address below", "It prints its wallet when it starts."],
            ["Approve with World ID", "A fresh check in World App. Declining issues nothing."],
          ].map(([t, b], i) => (
            <li key={i} className="flex gap-3">
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-brand-soft font-mono text-xs font-semibold text-brand">{i + 1}</span>
              <div>
                <div className="font-medium">{t}</div>
                <div className="text-xs text-muted-foreground">{b}</div>
              </div>
            </li>
          ))}
        </ol>
      </header>

      {!verified ? (
        <section className="surface flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <FingerprintIcon size={28} className="text-brand" />
          <div className="flex-1">
            <div className="font-semibold">Verify yourself first</div>
            <p className="text-sm text-muted-foreground">An agent can only act for a verified person. One World ID check.</p>
          </div>
          <Button className="rounded-full bg-foreground px-5 font-medium text-background hover:bg-foreground/90" onClick={() => open()}>
            Verify with World ID
          </Button>
        </section>
      ) : !token ? (
        <section className="surface flex flex-col items-start gap-4 p-6 sm:flex-row sm:items-center">
          <RobotIcon size={28} className="text-brand" />
          <div className="flex-1">
            <div className="font-semibold">Sign in to manage agents</div>
            <p className="text-sm text-muted-foreground">A signature from your wallet proves it's you. No transaction.</p>
          </div>
          <Button className="rounded-full px-5 font-semibold" onClick={async () => setToken(await acct.signIn())}>
            Sign in
          </Button>
        </section>
      ) : !configured ? (
        <section className="surface p-6 text-sm text-muted-foreground">Agent Pass isn't configured on this server yet.</section>
      ) : (
        <Authorize token={token} cap={acct.pass?.dailyCap ?? 100} dev={!cfg?.world.agentPass} onDone={() => qc.invalidateQueries({ queryKey: ["agents"] })} />
      )}

      {token && (
        <section>
          <h2 className="display text-[2rem]">Your agents</h2>
          <div className="mt-4 divide-y divide-border overflow-hidden rounded-[18px] border border-border">
            {!agents?.length ? (
              <p className="p-6 text-sm text-faint">No agents yet. Authorized agents appear here, and you can revoke them at any time.</p>
            ) : (
              agents.map((a) => (
                <div key={a.address} className="flex flex-wrap items-center gap-4 bg-surface px-5 py-4">
                  <span className="grid size-10 place-items-center rounded-xl bg-raised">
                    <RobotIcon size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">{a.name}</div>
                    <div className="font-mono text-xs text-faint">{short(a.address, 10)}</div>
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    <div>Spends while your day is under {usd(a.capUsdc, 0)}</div>
                    <div className="text-faint">Approved {ago(a.authorizedAt)}</div>
                  </div>
                  <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", a.status === "active" ? "bg-yes-soft text-yes" : "bg-raised text-faint")}>{a.status}</span>
                  {a.status === "active" && (
                    <Button
                      variant="secondary"
                      size="sm"
                      className="rounded-full"
                      onClick={async () => {
                        await api(`/agents/${a.address}/revoke`, { body: {}, token });
                        toast.success("Agent revoked", { description: "It can't renew its pass. The current one lapses within the hour." });
                        void qc.invalidateQueries({ queryKey: ["agents"] });
                      }}
                    >
                      Revoke
                    </Button>
                  )}
                </div>
              ))
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function Authorize({ token, cap, dev, onDone }: { token: string; cap: number; dev: boolean; onDone: () => void }) {
  const [agent, setAgent] = useState("");
  const [name, setName] = useState("My agent");
  const [limit, setLimit] = useState(Math.min(20, cap));
  const [start, setStart] = useState<Start>();
  const [poll, setPoll] = useState<Poll>();
  const [err, setErr] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!start || (poll && poll.status !== "pending")) return;
    const t = setInterval(async () => {
      try {
        const p = await api<Poll>(`/agents/authorize/${start.attempt}`, { token });
        setPoll(p);
        if (p.status === "approved") onDone();
      } catch (e: any) {
        setErr(e.message);
      }
    }, 2000);
    return () => clearInterval(t);
  }, [start, poll, token, onDone]);

  async function begin() {
    setErr(undefined);
    setPoll(undefined);
    setBusy(true);
    try {
      setStart(await api<Start>("/agents/authorize", { body: { agent, name, capUsdc: limit }, token }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  async function devDecide(approve: boolean) {
    if (!start) return;
    setPoll(await api<Poll>(`/agents/authorize/${start.attempt}/dev`, { body: { approve }, token }));
    if (approve) onDone();
  }

  const status = poll?.status ?? (start ? "pending" : undefined);

  return (
    <section className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className="surface space-y-5 p-6">
        <div>
          <label className="text-xs font-medium text-muted-foreground" htmlFor="agent">
            Agent wallet address
          </label>
          <Input id="agent" value={agent} onChange={(e) => setAgent(e.target.value.trim())} placeholder="0x…" spellCheck={false} className="mt-1.5 h-11 rounded-xl font-mono" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="text-xs font-medium text-muted-foreground" htmlFor="name">
              Name
            </label>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} className="mt-1.5 h-11 rounded-xl" />
          </div>
          <div>
            <div className="flex items-center justify-between text-xs font-medium text-muted-foreground">
              <label htmlFor="cap">Stops when your day reaches</label>
              <span className="font-mono text-foreground">{usd(limit, 0)}</span>
            </div>
            <input id="cap" type="range" min={1} max={cap} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="mt-4 w-full accent-[var(--brand)]" />
          </div>
        </div>
        <Button onClick={begin} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(agent)} className="h-11 w-full rounded-full bg-foreground font-medium text-background hover:bg-foreground/90">
          {busy ? <CircleNotchIcon className="animate-spin" /> : <FingerprintIcon weight="bold" />}
          Approve with World ID
        </Button>
        {err && <p className="text-sm text-no">{err}</p>}
        <div className="flex items-center gap-2 rounded-xl bg-sunk px-3 py-2.5 font-mono text-xs text-muted-foreground">
          <TerminalWindowIcon size={14} />
          <span className="flex-1 truncate">{RUN}</span>
          <button onClick={() => (navigator.clipboard.writeText(RUN), toast.success("Copied"))} aria-label="Copy command" className="hover:text-foreground">
            <CopyIcon size={14} />
          </button>
        </div>
      </div>

      <div className="surface flex min-h-[320px] flex-col items-center justify-center p-6 text-center">
        <AnimatePresence mode="wait">
          {!status && (
            <motion.div key="idle" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-sm text-faint">
              <FingerprintIcon size={40} className="mx-auto mb-3 text-muted-foreground" />
              The World ID approval appears here.
            </motion.div>
          )}
          {status === "pending" && start && (
            <motion.div key="pending" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} className="w-full">
              {start.dev ? (
                <>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-warn">Dev approval · no World ID on this network</div>
                  <p className="mb-4 text-sm text-muted-foreground">On a testnet this is a QR code you approve in World App.</p>
                  <div className="grid grid-cols-2 gap-2">
                    <Button className="rounded-full" onClick={() => devDecide(true)}>
                      Approve
                    </Button>
                    <Button variant="secondary" className="rounded-full" onClick={() => devDecide(false)}>
                      Decline
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="mx-auto w-fit rounded-2xl bg-white p-3">
                    <QRCodeSVG value={start.verificationUriComplete} size={168} />
                  </div>
                  <div className="mt-4 text-sm font-medium">Scan with World App</div>
                  <div className="mt-1 font-mono text-lg tracking-[0.2em]">{start.userCode}</div>
                  <a href={start.verificationUriComplete} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-muted-foreground underline underline-offset-4">
                    Open on this device
                  </a>
                </>
              )}
              <div className="mt-4 flex items-center justify-center gap-2 text-xs text-faint">
                <CircleNotchIcon size={12} className="animate-spin" /> Waiting for approval
              </div>
            </motion.div>
          )}
          {status === "approved" && (
            <motion.div key="ok" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              <CheckCircleIcon size={48} weight="fill" className="mx-auto text-yes" />
              <div className="mt-3 font-semibold">Agent authorized</div>
              <p className="mt-1 text-sm text-muted-foreground">It picks up its pass within seconds and trades inside your {usd(start?.capUsdc ?? 0, 0)} day.</p>
            </motion.div>
          )}
          {(status === "denied" || status === "expired") && (
            <motion.div key="no" initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}>
              {status === "denied" ? <XCircleIcon size={48} weight="fill" className="mx-auto text-no" /> : <ProhibitIcon size={48} className="mx-auto text-warn" />}
              <div className="mt-3 font-semibold">{status === "denied" ? "Not authorized" : "Approval expired"}</div>
              <p className="mt-1 text-sm text-muted-foreground">{poll?.reason}</p>
              <Button variant="secondary" className="mt-4 rounded-full" onClick={begin}>
                Try again
              </Button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
