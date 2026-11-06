"use client";

import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import NumberFlow from "@number-flow/react";
import { QRCodeSVG } from "qrcode.react";
import { isAddress, parseEther, type Hex } from "viem";
import { ArrowDownIcon, ArrowLeftIcon, ArrowUpIcon, CheckCircleIcon, CircleNotchIcon, CopyIcon, DropIcon, LinkIcon, QrCodeIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAccount, useConfig } from "@/lib/account";
import { useUI } from "@/lib/ui";
import { useWallet } from "@/lib/wallet";
import { chain, explorerTx } from "@/lib/env";
import { ORIGINS, browserWalletAddress, relayDestination, relayQuote, relayStatus, sendWithBrowserWallet } from "@/lib/relay";
import { short, usd } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * The wallet, in one sheet: what you have, add money, take it out. Modelled on consumer trading apps: one balance
 * in dollars, two buttons. Winnings land here by themselves (the engine pays every winner at settlement).
 */

type View = "home" | "deposit" | "receive" | "relay" | "withdraw";

export function WalletSheet() {
  const { wallet: open, setWallet } = useUI();
  const [view, setView] = useState<View>("home");
  useEffect(() => {
    if (open) setView(typeof open === "string" ? open : "home");
  }, [open]);
  return (
    <Dialog open={Boolean(open)} onOpenChange={(o) => !o && setWallet(false)}>
      <DialogContent className="gap-0 overflow-hidden rounded-[22px] border-border bg-surface p-0 sm:max-w-[420px]">
        <DialogTitle className="sr-only">Wallet</DialogTitle>
        <DialogDescription className="sr-only">Your Clutch balance, deposits and withdrawals</DialogDescription>
        <AnimatePresence mode="wait">
          <motion.div key={view} initial={{ opacity: 0, x: view === "home" ? -12 : 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }} className="p-6">
            {view === "home" && <Home go={setView} />}
            {view === "deposit" && <Deposit go={setView} />}
            {view === "receive" && <Receive go={setView} />}
            {view === "relay" && <RelayDeposit go={setView} />}
            {view === "withdraw" && <Withdraw go={setView} />}
          </motion.div>
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}

function Back({ go, title }: { go: (v: View) => void; title: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <button onClick={() => go("home")} className="grid size-8 place-items-center rounded-full bg-raised text-muted-foreground hover:text-foreground" aria-label="Back">
        <ArrowLeftIcon size={15} />
      </button>
      <h2 className="text-lg font-semibold">{title}</h2>
    </div>
  );
}

function Home({ go }: { go: (v: View) => void }) {
  const acct = useAccount();
  const wallet = useWallet();
  return (
    <div>
      <div className="text-xs text-muted-foreground">Balance</div>
      <NumberFlow value={acct.spendable} format={{ style: "currency", currency: "USD" }} className="display mt-1 text-5xl font-bold tabular" />
      <div className="mt-2 flex gap-3 font-mono text-[11px] text-faint">
        <span>{usd(acct.usdc)} USDC</span>
        <span>{acct.eth.toFixed(4)} ETH</span>
        <span>on {chain.name}</span>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button onClick={() => go("deposit")} className="h-12 rounded-full bg-brand text-[15px] font-semibold text-brand-foreground hover:bg-brand/90">
          <ArrowDownIcon weight="bold" /> Deposit
        </Button>
        <Button onClick={() => go("withdraw")} variant="secondary" className="h-12 rounded-full text-[15px] font-semibold">
          <ArrowUpIcon weight="bold" /> Withdraw
        </Button>
      </div>
      <button
        onClick={() => (navigator.clipboard.writeText(wallet.address ?? ""), toast.success("Address copied"))}
        className="mt-5 flex w-full items-center justify-between rounded-xl bg-sunk px-3 py-2.5 font-mono text-xs text-muted-foreground hover:text-foreground"
      >
        {short(wallet.address, 10)} <CopyIcon size={14} />
      </button>
      <p className="mt-3 text-center text-[11px] text-faint">Winnings and refunds land here automatically when a market settles.</p>
    </div>
  );
}

function Option({ icon, title, body, onClick, disabled, badge }: { icon: React.ReactNode; title: string; body: string; onClick?: () => void; disabled?: boolean; badge?: string }) {
  return (
    <button onClick={onClick} disabled={disabled} className="flex w-full items-center gap-4 rounded-2xl border border-border p-4 text-left transition hover:border-border-strong hover:bg-raised/40 disabled:cursor-not-allowed disabled:opacity-50">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-raised text-brand">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {title} {badge && <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand">{badge}</span>}
        </span>
        <span className="block text-xs text-muted-foreground">{body}</span>
      </span>
    </button>
  );
}

function Deposit({ go }: { go: (v: View) => void }) {
  const acct = useAccount();
  const { data: cfg } = useConfig();
  const [busy, setBusy] = useState(false);
  return (
    <div>
      <Back go={go} title="Deposit" />
      <div className="space-y-2">
        <Option
          icon={<LinkIcon size={20} weight="bold" />}
          title="From another chain"
          badge="Relay"
          body={relayDestination ? "ETH from Ethereum, Arbitrum, Base and more, in one step. No bridge, no exchange." : `Works when Clutch runs on Base or Unichain (this is ${chain.name}).`}
          disabled={!relayDestination}
          onClick={() => go("relay")}
        />
        <Option icon={<QrCodeIcon size={20} weight="bold" />} title={`Send on ${chain.name}`} body="Your Clutch address, with a QR code. USDC or ETH." onClick={() => go("receive")} />
        {(cfg?.local || chain.testnet) && (
          <Option
            icon={busy ? <CircleNotchIcon size={20} className="animate-spin" /> : <DropIcon size={20} weight="bold" />}
            title="Free test funds"
            body="This is a test network: get test USDC and gas."
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await acct.fund();
                toast.success("Test funds added");
                go("home");
              } catch (e: any) {
                toast.error(e.message);
              } finally {
                setBusy(false);
              }
            }}
          />
        )}
      </div>
    </div>
  );
}

function Receive({ go }: { go: (v: View) => void }) {
  const wallet = useWallet();
  return (
    <div>
      <Back go={go} title={`Send on ${chain.name}`} />
      <div className="mx-auto w-fit rounded-2xl bg-white p-3">
        <QRCodeSVG value={wallet.address ?? ""} size={180} />
      </div>
      <button
        onClick={() => (navigator.clipboard.writeText(wallet.address ?? ""), toast.success("Address copied"))}
        className="mt-4 flex w-full items-center justify-between gap-2 rounded-xl bg-sunk px-3 py-3 font-mono text-xs break-all text-foreground"
      >
        {wallet.address} <CopyIcon size={14} className="shrink-0" />
      </button>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">Only send on {chain.name}. From any other chain, use Relay instead, so the money arrives here.</p>
    </div>
  );
}

function RelayDeposit({ go }: { go: (v: View) => void }) {
  const wallet = useWallet();
  const acct = useAccount();
  const [origin, setOrigin] = useState(ORIGINS[0]?.id);
  const [amount, setAmount] = useState("0.005");
  const [quote, setQuote] = useState<Awaited<ReturnType<typeof relayQuote>>>();
  const [stage, setStage] = useState<"idle" | "quoting" | "signing" | "bridging" | "done">("idle");
  const [err, setErr] = useState<string>();
  const [from, setFrom] = useState<Hex>();

  async function getQuote() {
    setErr(undefined);
    setStage("quoting");
    try {
      const user = from ?? (await browserWalletAddress());
      if (!user) throw new Error("Connect a browser wallet that holds ETH on that chain.");
      setFrom(user);
      setQuote(await relayQuote({ user, recipient: wallet.address!, originChainId: origin!, amountWei: parseEther(amount) }));
      setStage("idle");
    } catch (e: any) {
      setErr(e.message);
      setStage("idle");
    }
  }

  async function go2() {
    if (!quote) return;
    setErr(undefined);
    try {
      setStage("signing");
      const step = quote.steps[0];
      await sendWithBrowserWallet(step);
      setStage("bridging");
      for (let i = 0; i < 90; i++) {
        const st = await relayStatus(step.requestId!);
        if (st === "success") {
          setStage("done");
          void acct.refresh();
          return;
        }
        if (st === "failure" || st === "refund") throw new Error(st === "refund" ? "Relay refunded the deposit on the origin chain." : "The bridge failed.");
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("Still bridging. It will land in your balance when Relay finishes.");
    } catch (e: any) {
      setErr(e.shortMessage ?? e.message);
      setStage("idle");
    }
  }

  return (
    <div>
      <Back go={go} title="From another chain" />
      {stage === "done" ? (
        <div className="py-6 text-center">
          <CheckCircleIcon size={48} weight="fill" className="mx-auto text-yes" />
          <div className="mt-3 font-semibold">Deposited</div>
          <p className="mt-1 text-sm text-muted-foreground">{quote?.details?.currencyOut?.amountFormatted} ETH landed in your Clutch wallet.</p>
          <Button className="mt-5 rounded-full" variant="secondary" onClick={() => go("home")}>
            Back to wallet
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-[1fr_120px] gap-2">
            <select value={origin} onChange={(e) => (setOrigin(Number(e.target.value)), setQuote(undefined))} className="h-11 rounded-xl border border-border bg-raised px-3 text-sm">
              {ORIGINS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
            <Input value={amount} onChange={(e) => (setAmount(e.target.value), setQuote(undefined))} inputMode="decimal" className="h-11 rounded-xl text-right font-mono" aria-label="Amount in ETH" />
          </div>
          {quote && (
            <dl className="space-y-1.5 rounded-xl bg-sunk p-3 text-xs">
              <Row k="You get" v={`${Number(quote.details?.currencyOut?.amountFormatted ?? 0).toFixed(5)} ETH ≈ ${usd(Number(quote.details?.currencyOut?.amountFormatted ?? 0) * acct.ethUsd)}`} />
              <Row k="Relay fee" v={`$${Number(quote.fees?.relayer?.amountUsd ?? 0).toFixed(3)}`} />
              <Row k="Arrives in" v={`~${quote.details?.timeEstimate ?? 2}s`} />
              <Row k="To" v={`your Clutch wallet on ${chain.name}`} />
            </dl>
          )}
          {err && <p className="text-sm text-no">{err}</p>}
          {!quote ? (
            <Button onClick={getQuote} disabled={stage === "quoting" || !(Number(amount) > 0)} className="h-12 w-full rounded-full font-semibold">
              {stage === "quoting" && <CircleNotchIcon className="animate-spin" />} Get quote
            </Button>
          ) : (
            <Button onClick={go2} disabled={stage !== "idle"} className="h-12 w-full rounded-full bg-brand font-semibold text-brand-foreground hover:bg-brand/90">
              {stage !== "idle" && <CircleNotchIcon className="animate-spin" />}
              {stage === "signing" ? "Confirm in your wallet…" : stage === "bridging" ? "Bridging…" : "Deposit"}
            </Button>
          )}
          <p className="text-center text-[11px] text-faint">Powered by Relay. One transaction on the chain you pay from; a solver fills here in seconds.</p>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-faint">{k}</dt>
      <dd className="text-right font-mono text-foreground">{v}</dd>
    </div>
  );
}

function Withdraw({ go }: { go: (v: View) => void }) {
  const acct = useAccount();
  const [asset, setAsset] = useState<"usdc" | "eth">("usdc");
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const max = asset === "usdc" ? acct.usdc : Math.max(0, acct.eth - 0.0003);
  const n = Number(amount);
  const ok = isAddress(to) && n > 0 && n <= max;
  return (
    <div>
      <Back go={go} title="Withdraw" />
      <div className="mb-4 grid grid-cols-2 gap-1 rounded-full bg-raised p-1">
        {(["usdc", "eth"] as const).map((a) => (
          <button key={a} onClick={() => setAsset(a)} className={cn("h-9 rounded-full text-sm font-semibold transition", asset === a ? "bg-foreground text-background" : "text-muted-foreground")}>
            {a.toUpperCase()}
          </button>
        ))}
      </div>
      <div className="space-y-3">
        <Input value={to} onChange={(e) => setTo(e.target.value.trim())} placeholder="Send to 0x…" spellCheck={false} className="h-11 rounded-xl font-mono" aria-label="Destination address" />
        <div className="relative">
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" inputMode="decimal" className="h-11 rounded-xl pr-16 font-mono" aria-label="Amount" />
          <button onClick={() => setAmount(String(Math.floor(max * (asset === "usdc" ? 100 : 1e5)) / (asset === "usdc" ? 100 : 1e5)))} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-brand">
            Max
          </button>
        </div>
        <Button
          disabled={!ok || busy}
          className="h-12 w-full rounded-full font-semibold"
          onClick={async () => {
            setBusy(true);
            try {
              const tx = await acct.send({ to: to as Hex, asset, amount: n });
              toast.success(`Sent ${asset === "usdc" ? usd(n) : `${n} ETH`}`, { description: explorerTx(tx) ? "View on explorer" : short(tx, 10) });
              go("home");
            } catch (e: any) {
              toast.error(e.shortMessage ?? e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy && <CircleNotchIcon className="animate-spin" />} Withdraw {asset === "usdc" ? "USDC" : "ETH"}
        </Button>
        <p className="text-center text-[11px] text-faint">Sends on {chain.name}. Double-check the address: onchain transfers can't be reversed.</p>
      </div>
    </div>
  );
}
