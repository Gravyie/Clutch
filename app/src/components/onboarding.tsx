"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { IDKitRequestWidget, proofOfHuman } from "@worldcoin/idkit";
import { ArrowRightIcon, CheckIcon, CircleNotchIcon, FingerprintIcon, SignInIcon, WalletIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LogoMark } from "@/components/brand";
import { useAccount, useConfig, type Pass } from "@/lib/account";
import { api } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { useWallet } from "@/lib/wallet";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

type Step = "signin" | "starter" | "human" | "fund" | "done";

const PERSONAS = [
  { id: "alice", label: "Adult viewer", note: "Passes every check" },
  { id: "bob", label: "Second adult", note: "A different person" },
  { id: "streamer", label: "Replay streamer", note: "Blocked on their own channel" },
  { id: "minor", label: "Under 18", note: "Refused before any pass" },
];

/** Sign in → verify you're a unique adult → fund → done. Resumes at whatever step is still missing. */
export function Onboarding() {
  const { onboarding, closeOnboarding } = useUI();
  const wallet = useWallet();
  const acct = useAccount();
  // Sign in, and that's it: a guest wallet is created silently, a starter pass and free test funds follow on their
  // own. World ID is an upgrade the viewer opens on purpose (free daily funds, the leaderboard, a per-person limit), never a gate.
  const verifying = useUI((s) => s.verifying);
  const step: Step =
    !wallet.address && wallet.kind === "privy" ? "signin" : verifying && !acct.verified ? "human" : !acct.pass ? "starter" : !acct.onboarded ? "fund" : "done";
  const steps: { id: Step; label: string }[] = verifying
    ? [{ id: "human", label: "Verify with World ID" }]
    : [
        ...(wallet.kind === "privy" ? [{ id: "signin" as Step, label: "Sign in" }] : []),
        { id: "starter", label: "Wallet" },
        { id: "fund", label: "Ready to trade" },
      ];
  const idx = steps.findIndex((s) => s.id === step);
  useEffect(() => {
    if (onboarding && wallet.kind === "guest" && wallet.ready && !wallet.address) wallet.login();
  }, [onboarding, wallet]);

  return (
    <Dialog open={onboarding} onOpenChange={(o) => !o && closeOnboarding()}>
      <DialogContent className="gap-0 overflow-hidden rounded-2xl border-border bg-surface p-0 sm:max-w-[440px]">
        <div className="flex items-center gap-3 border-b border-border px-6 pb-4 pt-6">
          <LogoMark className="size-8" />
          <div>
            <DialogTitle className="text-base font-semibold">{verifying ? "Raise your limits" : step === "done" ? "You're in" : "Setting up"}</DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">{verifying ? "One World ID check. Your limit follows you, not your wallet." : "A few seconds. Every trade is one tap after this."}</DialogDescription>
          </div>
        </div>
        <ol className="flex gap-1.5 px-6 pt-4" aria-label="Progress">
          {steps.map((s, i) => (
            <li key={s.id} className="flex-1">
              <div className={cn("h-1 rounded-full transition-colors", i < idx || step === "done" ? "bg-yes" : i === idx ? "bg-foreground" : "bg-raised")} />
              <span className={cn("mt-1.5 block text-[11px]", i === idx ? "text-foreground" : "text-faint")}>{s.label}</span>
            </li>
          ))}
        </ol>
        <div className="min-h-[300px] px-6 pb-6 pt-5">
          <AnimatePresence mode="wait">
            <motion.div key={step} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2 }}>
              {step === "signin" && <SignInStep />}
              {step === "starter" && <StarterStep />}
              {step === "human" && <HumanStep />}
              {step === "fund" && <FundStep />}
              {step === "done" && <DoneStep onClose={closeOnboarding} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepHead({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="mb-5">
      <div className="mb-3 grid size-10 place-items-center rounded-xl bg-raised text-foreground">{icon}</div>
      <h3 className="text-lg font-semibold tracking-tight">{title}</h3>
      <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </div>
  );
}

function SignInStep() {
  const wallet = useWallet();
  return (
    <div>
      <StepHead
        icon={<SignInIcon size={20} />}
        title="Sign in"
        body={wallet.kind === "privy" ? "Use your email or Google. We create a wallet for you, so trades never need a pop-up." : "Start with a guest wallet kept in this browser. It's yours, and you can trade immediately."}
      />
      <Button size="lg" className="h-11 w-full rounded-[10px] text-sm font-semibold" onClick={wallet.login} disabled={!wallet.ready}>
        {wallet.kind === "privy" ? "Continue with email or Google" : "Create guest wallet"}
        <ArrowRightIcon />
      </Button>
      {wallet.kind === "guest" && <p className="mt-3 text-xs text-faint">Guest wallets live in this browser only. Clearing site data removes it.</p>}
      {wallet.continueAsGuest && (
        <button onClick={() => wallet.continueAsGuest?.()} className="mt-4 w-full text-center text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">
          Use a test wallet
        </button>
      )}
    </div>
  );
}

/** No World ID needed to start: a small, wallet-bound pass is issued right away. */
function StarterStep() {
  const wallet = useWallet();
  const acct = useAccount();
  const verify = useUI((s) => s.openVerify);
  const [err, setErr] = useState<string | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (!wallet.address) return;
    let live = true;
    setErr(null);
    api<Pass>("/pass/starter", { body: { wallet: wallet.address } })
      .then((p) => live && acct.setPass(p))
      .catch((e: any) => live && setErr(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet.address, tries]);
  return (
    <div>
      <StepHead icon={<WalletIcon size={20} />} title="Creating your wallet" body="It lives in this browser and signs trades for you, so there are no pop-ups." />
      <ul className="mb-5 space-y-2 text-sm">
        <Check done={Boolean(wallet.address)} active={!wallet.address} label="Wallet" />
        <Check done={Boolean(acct.pass)} active={Boolean(wallet.address) && !err} label="Trading pass" />
      </ul>
      {err && (
        <div className="space-y-3">
          <p className="text-sm text-no">{err}</p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" className="rounded-full" onClick={() => setTries((t) => t + 1)}>
              Try again
            </Button>
            <Button className="rounded-full" onClick={() => verify()}>
              Verify with World ID
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function HumanStep() {
  const wallet = useWallet();
  const acct = useAccount();
  const { data: cfg } = useConfig();
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rp, setRp] = useState<any>(null);
  const [open, setOpen] = useState(false);

  async function world() {
    setErr(null);
    try {
      setRp(await api("/pass/context", { body: {} }));
      setOpen(true);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function dev(persona: string) {
    setErr(null);
    setBusy(persona);
    try {
      acct.setPass(await api<Pass>("/pass/dev", { body: { persona, wallet: wallet.address } }));
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <StepHead
        icon={<FingerprintIcon size={20} />}
        title="Prove you're one real person"
        body="One World ID check, Proof of Human only. It unlocks free test funds every day, a place on the leaderboard and a higher daily limit, each once per person however many wallets you use. We never see your name or documents."
      />
      {cfg?.world.configured ? (
        <Button size="lg" className="h-11 w-full rounded-[10px] text-sm font-semibold" onClick={world}>
          Verify with World ID
          <ArrowRightIcon />
        </Button>
      ) : (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Test verifier</span>
            <span className="text-[11px] text-faint">World ID isn't configured on this network</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {PERSONAS.map((p) => (
              <button
                key={p.id}
                onClick={() => dev(p.id)}
                disabled={busy !== null}
                className="rounded-[10px] border border-border bg-raised px-3 py-2.5 text-left transition hover:border-border-strong active:scale-[0.98] disabled:opacity-60"
              >
                <div className="flex items-center gap-1.5 text-sm font-medium">
                  {busy === p.id && <CircleNotchIcon className="animate-spin" size={14} />}
                  {p.label}
                </div>
                <div className="text-[11px] text-faint">{p.note}</div>
              </button>
            ))}
          </div>
        </div>
      )}
      {err && (
        <p className="mt-4 flex gap-2 rounded-[10px] border border-no/30 bg-no-soft px-3 py-2.5 text-sm text-no">
          <WarningCircleIcon size={18} className="mt-px shrink-0" weight="fill" />
          {err}
        </p>
      )}
      {cfg?.world.configured && rp && !rp.dev && wallet.address && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={rp.app_id}
          action={rp.action}
          rp_context={rp.rp_context}
          allow_legacy_proofs={true}
          environment={rp.environment}
          preset={proofOfHuman({ signal: wallet.address })}
          handleVerify={async (result: unknown) => {
            acct.setPass(await api<Pass>("/pass/verify", { body: { result, wallet: wallet.address } }));
          }}
          onSuccess={() => setOpen(false)}
          onError={(e: unknown) => setErr(/cancel|reject|closed/i.test(String((e as any)?.message ?? e)) ? "Verification cancelled. Nothing was shared and no pass was issued, so trading stays locked." : String((e as any)?.message ?? e))}
        />
      )}
    </div>
  );
}

/** Runs by itself: free test funds land, and the viewer is ready. No buttons, no approvals. */
function FundStep() {
  const acct = useAccount();
  const verify = useUI((s) => s.openVerify);
  const [err, setErr] = useState<{ message: string; code?: string } | null>(null);
  const [tries, setTries] = useState(0);
  useEffect(() => {
    let live = true;
    setErr(null);
    acct.fund().catch((e: any) => live && setErr({ message: e.message, code: e.code }));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tries]);
  return (
    <div>
      <StepHead icon={<WalletIcon size={20} />} title="Setting up your wallet" body="Clutch runs on a test network, so your first funds are free. Winnings pay out in USDC." />
      <ul className="mb-5 space-y-2 text-sm">
        <Check done={Boolean(acct.pass)} active={false} label={acct.verified ? "Verified human pass" : "Trading pass"} />
        <Check done={acct.spendable > 1} active={!err && acct.spendable <= 1} label={acct.spendable > 1 ? `${usd(acct.spendable)} ready to trade` : "Adding free test funds"} />
      </ul>
      {err && (
        <div className="space-y-3">
          <p className={cn("text-sm", err.code === "verify" ? "text-muted-foreground" : "text-no")}>{err.message}</p>
          {err.code === "verify" ? (
            <Button className="h-10 w-full rounded-full bg-foreground font-medium text-background hover:bg-foreground/90" onClick={() => verify()}>
              Verify with World ID
            </Button>
          ) : (
            <Button variant="secondary" className="h-10 w-full rounded-full" onClick={() => setTries((t) => t + 1)}>
              Try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function Check({ done, active, label }: { done: boolean; active: boolean; label: string }) {
  return (
    <li className="flex items-center gap-2.5">
      <span className={cn("grid size-5 place-items-center rounded-full border", done ? "border-yes bg-yes text-background" : "border-border-strong")}>
        {done ? <CheckIcon size={12} weight="bold" /> : active ? <CircleNotchIcon size={12} className="animate-spin" /> : null}
      </span>
      <span className={done ? "text-foreground" : "text-muted-foreground"}>{label}</span>
    </li>
  );
}

function DoneStep({ onClose }: { onClose: () => void }) {
  const acct = useAccount();
  const pending = useUI((s) => s.pending);
  useEffect(() => {
    // Finish what they tapped: the trade goes through as soon as they're ready.
    const t = setTimeout(() => {
      onClose();
      pending?.();
    }, pending ? 900 : 2400);
    return () => clearTimeout(t);
  }, [onClose, pending]);
  return (
    <div className="flex flex-col items-center py-6 text-center">
      <motion.div initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: "spring", stiffness: 260, damping: 18 }} className="grid size-14 place-items-center rounded-full bg-yes text-background">
        <CheckIcon size={28} weight="bold" />
      </motion.div>
      <h3 className="mt-4 text-lg font-semibold">{pending ? "Placing your trade…" : "Every trade is one tap now"}</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        {usd(acct.spendable)} ready. Daily limit {usd(acct.pass?.dailyCap ?? 0, 0)}
        {acct.verified ? "." : " on this wallet."}
      </p>
    </div>
  );
}

/** Opens onboarding if the user can't trade yet, remembering what they tapped. Returns true when ready. */
export function useEnsureReady() {
  const acct = useAccount();
  const open = useUI((s) => s.openOnboarding);
  return (then?: () => void) => {
    if (acct.onboarded) return true;
    open(then);
    return false;
  };
}
