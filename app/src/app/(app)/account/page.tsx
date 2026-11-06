"use client";

import { DotType } from "@/components/dot-type";
import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { CheckCircleIcon, CircleNotchIcon, FingerprintIcon, HandPalmIcon, UserIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Avatar } from "@/components/brand";
import { useConfig, useAccount } from "@/lib/account";
import { api } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { useWallet } from "@/lib/wallet";
import { short, usd } from "@/lib/format";

export default function AccountPage() {
  const wallet = useWallet();
  const acct = useAccount();
  const open = useUI((s) => s.openOnboarding);
  const verify = useUI((s) => s.openVerify);
  const { data: cfg } = useConfig();
  if (!wallet.address) {
    return (
      <div className="mx-auto flex min-h-[60dvh] max-w-[420px] flex-col items-center justify-center px-6 text-center">
        <span className="grid size-14 place-items-center rounded-2xl bg-raised text-muted-foreground">
          <UserIcon size={26} />
        </span>
        <DotType as="h1" start speed={34} text="Your account" className="display mt-4 text-[2.2rem]" />
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">Sign in to see your wallet and network, your daily limit, optional World ID verification, and self-exclusion controls.</p>
        <Button className="mt-5 h-11 rounded-full bg-foreground px-6 font-medium text-background hover:bg-foreground/90" onClick={() => open()}>
          Sign in
        </Button>
        <p className="mt-3 text-xs text-faint">Testnet only. We never ask for a seed phrase or private key.</p>
      </div>
    );
  }
  const excluded = acct.excludedUntil > Date.now() / 1000;
  return (
    <div className="mx-auto max-w-[760px] space-y-6 px-4 py-6 sm:px-6">
      <DotType as="h1" start speed={34} text="Account" className="display text-[2.6rem]" />
      <Profile />

      <section className="surface p-5">
        <div className="flex items-center gap-3">
          <FingerprintIcon size={22} className="text-muted-foreground" />
          <div className="flex-1">
            <h2 className="text-sm font-semibold">Human verification</h2>
            <p className="text-sm text-muted-foreground">
              {acct.verified && acct.pass
                ? `Verified${acct.pass.dev ? " with the test verifier" : " with World ID"}. Pass renews in ${Math.max(0, Math.round((acct.pass.expiry - Date.now() / 1000) / 3600))}h.`
                : `Starter limit: ${usd(acct.pass?.dailyCap ?? 10, 0)} a day on this wallet. Verify with World ID for ${usd(cfg?.passDailyCap ?? 100, 0)} a day across all your wallets, free funds every day, and a place on the leaderboard.`}
            </p>
          </div>
          {acct.verified ? <CheckCircleIcon size={22} weight="fill" className="text-yes" /> : <Button size="sm" className="rounded-full" onClick={() => verify()}>Verify with World ID</Button>}
        </div>
      </section>

      <section className="surface p-5">
        <div className="flex items-center gap-3">
          <HandPalmIcon size={22} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Limits and breaks</h2>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {acct.verified
            ? "Your limit belongs to you as a person, not to a wallet: every wallet you use shares it, and a break covers them all."
            : "This wallet has a starter limit. Verify with World ID and one limit covers you across every wallet you use."}
        </p>
        {acct.pass && (
          <div className="mt-4">
            <div className="flex justify-between text-sm">
              <span>Staked today</span>
              <span className="tabular">
                {usd(acct.stakedToday, 0)} of {usd(acct.pass.dailyCap, 0)}
              </span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, (acct.stakedToday / acct.pass.dailyCap) * 100)}%` }} />
            </div>
            <p className="mt-1.5 text-xs text-faint">Resets at 00:00 UTC.</p>
          </div>
        )}
        <div className="mt-5 border-t border-border pt-5">{excluded ? <p className="text-sm text-void">You're on a break until {new Date(acct.excludedUntil * 1000).toLocaleString()}. Trading is blocked for your human ID on every wallet.</p> : <TakeABreak />}</div>
      </section>

      <section className="surface p-5 text-sm">
        <h2 className="font-semibold">Wallet</h2>
        <div className="mt-3 space-y-2 text-muted-foreground">
          <div className="flex justify-between">
            <span>Address</span>
            <span className="font-mono">{short(wallet.address, 10)}</span>
          </div>
          <div className="flex justify-between">
            <span>Type</span>
            <span>{wallet.kind === "privy" ? "Embedded wallet" : "Guest wallet (this browser)"}</span>
          </div>
          <div className="flex justify-between">
            <span>Gas balance</span>
            <span className="tabular">{acct.eth.toFixed(4)} ETH</span>
          </div>
        </div>
        <p className="mt-4 text-xs text-faint">
          Need help with gambling? <Link href="/responsible-play" className="underline underline-offset-4">Responsible play resources</Link>.
        </p>
      </section>
    </div>
  );
}

function Profile() {
  const wallet = useWallet();
  const acct = useAccount();
  const { data, refetch } = useQuery({
    queryKey: ["me", acct.token],
    queryFn: () => api<{ name: string | null; lichess: string | null }>("/me", { token: acct.token }),
    enabled: !!acct.token,
  });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      const token = await acct.signIn();
      await api("/me/profile", { body: { name }, token });
      await refetch();
      toast.success("Name saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface flex flex-col gap-4 p-5 sm:flex-row sm:items-end">
      <Avatar name={data?.name ?? wallet.address ?? "?"} size={56} />
      <div className="flex-1">
        <Label htmlFor="name" className="text-xs text-muted-foreground">
          Display name on the leaderboard
        </Label>
        <Input id="name" placeholder={data?.name ?? "Pick a name"} value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 h-10 rounded-lg" maxLength={20} />
      </div>
      <Button className="h-10 rounded-lg" onClick={save} disabled={busy || name.length < 3}>
        {busy ? <CircleNotchIcon className="animate-spin" /> : <UserIcon />} Save
      </Button>
    </section>
  );
}

function TakeABreak() {
  const acct = useAccount();
  const [days, setDays] = useState(7);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!acct.pass) return <p className="text-sm text-faint">Verify first to set a break.</p>;
  return (
    <div>
      <div className="text-sm font-medium">Take a break</div>
      <p className="mt-1 text-sm text-muted-foreground">Blocks all trading for your human ID. Breaks can be extended but never shortened.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {[1, 7, 30, 180].map((d) => (
          <button key={d} onClick={() => setDays(d)} className={`h-9 rounded-full px-4 text-sm ${days === d ? "bg-foreground text-background" : "bg-raised text-muted-foreground"}`}>
            {d === 1 ? "24 hours" : d === 180 ? "6 months" : `${d} days`}
          </button>
        ))}
      </div>
      {confirm ? (
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl bg-no-soft p-3 text-sm">
          <span className="flex-1">Start a {days}-day break now? This can't be undone.</span>
          <Button
            size="sm"
            variant="destructive"
            className="rounded-lg"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await acct.selfExclude(days);
                toast.success("Break started");
              } catch (e: any) {
                toast.error(e.shortMessage ?? e.message);
              } finally {
                setBusy(false);
                setConfirm(false);
              }
            }}
          >
            {busy ? <CircleNotchIcon className="animate-spin" /> : null} Start break
          </Button>
          <Button size="sm" variant="ghost" className="rounded-lg" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="secondary" className="mt-4 rounded-lg" onClick={() => setConfirm(true)}>
          Start a break
        </Button>
      )}
    </div>
  );
}
