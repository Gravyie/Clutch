"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { BroadcastIcon, CheckIcon, CircleNotchIcon, CopyIcon, PauseIcon, PlayIcon, TwitchLogoIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import { ClutchHookAbi, STEERABILITY_LIMIT, TEMPLATES, VISION_TEMPLATES, toUsdc, type StreamState } from "@clutch/shared";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar } from "@/components/brand";
import { publicClient, useAccount, useConfig } from "@/lib/account";
import { api } from "@/lib/live";
import { useUI } from "@/lib/ui";
import { useWallet } from "@/lib/wallet";
import { chain } from "@/lib/env";
import { usd } from "@/lib/format";
import { cn } from "@/lib/utils";

interface Me {
  address: string;
  name: string | null;
  lichess: string | null;
  verifiedHuman: boolean;
  streams: StreamState[];
}

export default function Page() {
  return (
    <Suspense>
      <StudioPage />
    </Suspense>
  );
}

function StudioPage() {
  const wallet = useWallet();
  const acct = useAccount();
  const openOnboarding = useUI((s) => s.openVerify);
  const [token, setToken] = useState<string | undefined>(acct.token);
  useEffect(() => setToken(acct.token), [acct.token]);
  const me = useQuery({ queryKey: ["me", token], queryFn: () => api<Me>("/me", { token }), enabled: !!token });
  useLichessCallback(token, () => void me.refetch());

  if (!wallet.address) {
    return (
      <Hero>
        <Button size="lg" className="h-11 rounded-xl px-6 font-semibold" onClick={() => openOnboarding()}>
          Sign in to start
        </Button>
      </Hero>
    );
  }
  if (!token) {
    return (
      <Hero>
        <Button
          size="lg"
          className="h-11 rounded-xl px-6 font-semibold"
          onClick={async () => {
            try {
              setToken(await acct.signIn());
            } catch (e: any) {
              toast.error(e.message);
            }
          }}
        >
          Open the studio
        </Button>
        <p className="mt-3 text-xs text-faint">You'll sign a message to prove you own this wallet. No transaction, no cost.</p>
      </Hero>
    );
  }
  if (!me.data) return <div className="mx-auto max-w-4xl p-6"><div className="shimmer h-72 rounded-2xl bg-surface" /></div>;
  if (me.data.streams.length) return <Dashboard s={me.data.streams[0]} token={token} />;
  return <Setup me={me.data} token={token} onDone={() => void me.refetch()} />;
}

function Hero({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-2xl flex-col items-center justify-center px-4 text-center">
      <div className="grid size-14 place-items-center rounded-2xl bg-raised">
        <BroadcastIcon size={28} />
      </div>
      <h1 className="display mt-5 text-[2.9rem]">Turn your stream into markets</h1>
      <p className="mt-3 max-w-[50ch] text-muted-foreground">Twitch, Kick, YouTube or Lichess. Clutch's AI watches your stream, opens markets on the tense moments, and pays you 0.5% of every market's volume.</p>
      <div className="mt-7">{children}</div>
    </div>
  );
}

/** Lichess OAuth (PKCE). No client registration: any client id works, and we never keep the token. */
async function startLichess(clientId: string) {
  const verifier = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(48)))).replace(/[^a-zA-Z0-9]/g, "").slice(0, 64);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  const challenge = btoa(String.fromCharCode(...digest)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const state = crypto.randomUUID();
  sessionStorage.setItem("lichess.pkce", JSON.stringify({ verifier, state }));
  const redirect = `${location.origin}/studio`;
  location.href = `https://lichess.org/oauth?response_type=code&client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirect)}&code_challenge_method=S256&code_challenge=${challenge}&state=${state}`;
}

function useLichessCallback(token: string | undefined, onDone: () => void) {
  const params = useSearchParams();
  const router = useRouter();
  useEffect(() => {
    const code = params.get("code");
    const state = params.get("state");
    const saved = sessionStorage.getItem("lichess.pkce");
    if (!code || !token || !saved) return;
    const { verifier, state: want } = JSON.parse(saved);
    sessionStorage.removeItem("lichess.pkce");
    router.replace("/studio");
    if (state !== want) return void toast.error("Lichess sign-in expired. Try again.");
    api("/studio/lichess", { body: { code, verifier, redirectUri: `${location.origin}/studio` }, token })
      .then(() => {
        toast.success("Lichess connected");
        onDone();
      })
      .catch((e) => toast.error(e.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params, token]);
}

function Setup(props: { me: Me; token: string; onDone: () => void }) {
  const [mode, setMode] = useState<"video" | "lichess">("video");
  return (
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8 sm:px-6">
      <div>
        <h1 className="display text-[2.6rem]">Bring your stream</h1>
        <p className="mt-1 text-muted-foreground">Clutch's AI watches your stream and opens markets on the tense moments. You earn 0.5% of every market's volume.</p>
      </div>
      <div className="flex gap-2">
        {(
          [
            ["video", "Twitch, Kick or YouTube"],
            ["lichess", "Lichess games"],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setMode(id)} className={cn("h-9 rounded-full px-4 text-sm font-medium", mode === id ? "bg-foreground text-background" : "bg-raised text-muted-foreground hover:text-foreground")}>
            {label}
          </button>
        ))}
      </div>
      {mode === "video" ? <VideoSetup {...props} /> : <LichessSetup {...props} />}
    </div>
  );
}

function VideoSetup({ me, token, onDone }: { me: Me; token: string; onDone: () => void }) {
  const openOnboarding = useUI((s) => s.openVerify);
  const acct = useAccount();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const verified = me.verifiedHuman || acct.verified;
  const { data: code } = useQuery({ queryKey: ["claim", token], queryFn: () => api<{ code: string }>("/studio/claim-code", { body: {}, token }) });
  async function create() {
    setBusy(true);
    try {
      await api("/studio/video", { body: { url, title: title || undefined }, token });
      toast.success("Your channel is on Clutch");
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <ol className="space-y-3">
      <li className="surface flex items-start gap-4 p-4">
        <StepDot n={1} done={verified} />
        <div className="flex-1">
          <div className="text-sm font-semibold">Verify you're a unique human</div>
          <p className="mt-0.5 text-sm text-muted-foreground">Your verified ID is what blocks you from trading your own markets.</p>
        </div>
        {!verified && (
          <Button size="sm" className="rounded-lg" onClick={() => openOnboarding()}>
            Verify
          </Button>
        )}
      </li>
      <li className={cn("surface space-y-3 p-4", !verified && "pointer-events-none opacity-50")}>
        <div className="flex items-start gap-4">
          <StepDot n={2} done={false} />
          <div>
            <div className="text-sm font-semibold">Prove it's your channel</div>
            <p className="mt-0.5 text-sm text-muted-foreground">Go live with this code anywhere in your stream title. You can remove it once you're set up.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-sunk px-3 py-2">
          <code className="flex-1 font-mono text-sm font-semibold tracking-wide">{code?.code ?? "…"}</code>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 rounded-md"
            onClick={() => {
              void navigator.clipboard.writeText(code?.code ?? "");
              toast.success("Code copied");
            }}
          >
            <CopyIcon /> Copy
          </Button>
        </div>
      </li>
      <li className={cn("surface space-y-4 p-4", !verified && "pointer-events-none opacity-50")}>
        <div className="flex items-start gap-4">
          <StepDot n={3} done={false} />
          <div>
            <div className="text-sm font-semibold">Connect your channel</div>
            <p className="mt-0.5 text-sm text-muted-foreground">Shooters, battle royale, MOBA and sports get markets. On IRL streams the AI refuses anything you could decide yourself.</p>
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-[1.4fr_1fr]">
          <div>
            <Label htmlFor="url" className="text-xs text-muted-foreground">Channel link</Label>
            <Input id="url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="twitch.tv/yourname" className="mt-1.5 h-10 rounded-lg" />
          </div>
          <div>
            <Label htmlFor="vtitle" className="text-xs text-muted-foreground">Display name (optional)</Label>
            <Input id="vtitle" value={title} onChange={(e) => setTitle(e.target.value)} className="mt-1.5 h-10 rounded-lg" maxLength={40} />
          </div>
        </div>
        <Button className="h-11 w-full rounded-xl font-semibold" onClick={create} disabled={busy || url.length < 6}>
          {busy ? <CircleNotchIcon className="animate-spin" /> : null}
          {busy ? "Checking your stream and creating your market pool…" : "Verify and create channel"}
        </Button>
      </li>
    </ol>
  );
}

function StepDot({ n, done }: { n: number; done: boolean }) {
  return <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", done ? "bg-yes text-background" : "bg-raised")}>{done ? <CheckIcon size={14} weight="bold" /> : n}</span>;
}

function LichessSetup({ me, token, onDone }: { me: Me; token: string; onDone: () => void }) {
  const { data: cfg } = useConfig();
  const openOnboarding = useUI((s) => s.openVerify);
  const acct = useAccount();
  const [twitch, setTwitch] = useState("");
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const verified = me.verifiedHuman || acct.verified;
  const steps = [
    { done: verified, title: "Verify you're a unique human", body: "Your verified ID is what blocks you from trading your own markets.", action: !verified && <Button size="sm" className="rounded-lg" onClick={() => openOnboarding()}>Verify</Button> },
    {
      done: !!me.lichess,
      title: me.lichess ? `Lichess connected: ${me.lichess}` : "Connect your Lichess account",
      body: "Markets open on the games you play. We read your public games; we never move pieces or keep your token.",
      action: !me.lichess && cfg && (
        <Button size="sm" className="rounded-lg" onClick={() => void startLichess(cfg.lichessClientId)}>
          Connect Lichess
        </Button>
      ),
    },
  ];

  async function create() {
    setBusy(true);
    try {
      await api("/studio/channel", { body: { twitch: twitch || undefined, title: title || undefined }, token });
      toast.success("Your channel is live on Clutch");
      onDone();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <ol className="space-y-3">
        {steps.map((s, i) => (
          <li key={i} className="surface flex items-start gap-4 p-4">
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold", s.done ? "bg-yes text-background" : "bg-raised")}>{s.done ? <CheckIcon size={14} weight="bold" /> : i + 1}</span>
            <div className="flex-1">
              <div className="text-sm font-semibold">{s.title}</div>
              <p className="mt-0.5 text-sm text-muted-foreground">{s.body}</p>
            </div>
            {s.action}
          </li>
        ))}
        <li className={cn("surface space-y-4 p-4", !(verified && me.lichess) && "pointer-events-none opacity-50")}>
          <div className="flex items-start gap-4">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-raised text-xs font-semibold">3</span>
            <div>
              <div className="text-sm font-semibold">Create your channel</div>
              <p className="mt-0.5 text-sm text-muted-foreground">Optional: show your Twitch stream on the channel page. We widen the safety buffer for Twitch's delay automatically.</p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="title" className="text-xs text-muted-foreground">Channel name</Label>
              <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder={me.lichess ?? ""} className="mt-1.5 h-10 rounded-lg" maxLength={40} />
            </div>
            <div>
              <Label htmlFor="twitch" className="text-xs text-muted-foreground">Twitch channel (optional)</Label>
              <div className="relative mt-1.5">
                <TwitchLogoIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-faint" size={16} />
                <Input id="twitch" value={twitch} onChange={(e) => setTwitch(e.target.value)} placeholder="yourname" className="h-10 rounded-lg pl-9" />
              </div>
            </div>
          </div>
          <Button className="h-11 w-full rounded-xl font-semibold" onClick={create} disabled={busy}>
            {busy ? <CircleNotchIcon className="animate-spin" /> : null}
            {busy ? "Creating your market pool onchain…" : "Create channel"}
          </Button>
        </li>
      </ol>
    </div>
  );
}

function Dashboard({ s, token }: { s: StreamState; token: string }) {
  const acct = useAccount();
  const wallet = useWallet();
  const { data: cfg } = useConfig();
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  const owed = useQuery({
    queryKey: ["owed", acct.address],
    queryFn: async () => toUsdc(await publicClient.readContract({ address: cfg!.deployment.clutchHook, abi: ClutchHookAbi, functionName: "owed", args: [acct.address!] })),
    enabled: !!cfg && !!acct.address,
    refetchInterval: 15_000,
  });
  const overlay = `${origin}/overlay/${s.slug}`;

  async function togglePause() {
    if (!cfg || !s.poolId) return;
    setBusy(true);
    try {
      const c = await wallet.client();
      const hash = await c.writeContract({ chain, account: c.account!, address: cfg.deployment.clutchHook, abi: ClutchHookAbi, functionName: "setPaused", args: [s.poolId, !s.paused] });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(s.paused ? "Markets resumed" : "Markets paused");
    } catch (e: any) {
      toast.error(e.shortMessage ?? e.message);
    } finally {
      setBusy(false);
    }
  }

  async function withdraw() {
    if (!cfg) return;
    const c = await wallet.client();
    const hash = await c.writeContract({ chain, account: c.account!, address: cfg.deployment.clutchHook, abi: ClutchHookAbi, functionName: "withdrawOwed" });
    await publicClient.waitForTransactionReceipt({ hash });
    toast.success("Earnings sent to your wallet");
    void owed.refetch();
  }

  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6 sm:px-6">
      <div className="flex flex-wrap items-center gap-4">
        <Avatar name={s.title} size={56} />
        <div className="flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{s.title}</h1>
          <p className="text-sm text-muted-foreground">{s.live ? "Live now. The AI is watching for moments." : s.media?.kind === "video" ? "Offline. Go live and markets start automatically." : "Offline. Start a game on Lichess and your channel goes live."}</p>
        </div>
        <Button variant="secondary" className="rounded-xl" asChild>
          <Link href={`/c/${s.slug}`}>View channel</Link>
        </Button>
        <Button className={cn("rounded-xl", s.paused && "bg-yes text-background hover:bg-yes/90")} onClick={togglePause} disabled={busy}>
          {busy ? <CircleNotchIcon className="animate-spin" /> : s.paused ? <PlayIcon weight="fill" /> : <PauseIcon weight="fill" />}
          {s.paused ? "Resume markets" : "Pause markets"}
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="surface p-4">
          <div className="text-xs text-muted-foreground">Earnings to withdraw</div>
          <div className="mt-1 flex items-end justify-between">
            <span className="text-2xl font-semibold tabular">{usd(owed.data ?? 0)}</span>
            <Button size="sm" variant="secondary" className="rounded-lg" disabled={!owed.data} onClick={() => void withdraw().catch((e) => toast.error(e.message))}>
              Withdraw
            </Button>
          </div>
        </div>
        <div className="surface p-4">
          <div className="text-xs text-muted-foreground">Markets today</div>
          <div className="mt-1 text-2xl font-semibold tabular">{s.settledToday}</div>
        </div>
        <div className="surface p-4">
          <div className="text-xs text-muted-foreground">Safety buffer</div>
          <div className="mt-1 text-2xl font-semibold tabular">{s.latencyBufferSec}s</div>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <section className="surface overflow-hidden">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Market types on your channel</h2>
            <p className="text-xs text-muted-foreground">Turn off anything you don't want. Types one person could decide are never listed.</p>
          </div>
          <ul className="divide-y divide-border">
            {(s.media?.kind === "video" ? VISION_TEMPLATES : TEMPLATES).map((t: any) => {
              const blocked = t.safety !== "game" || t.steerability > STEERABILITY_LIMIT;
              const on = !blocked && !s.vetoed.includes(t.id);
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium">{t.title}</div>
                    <div className="truncate text-xs text-faint">{blocked ? "Never listed: " : ""}{t.steerabilityReason}</div>
                  </div>
                  <Switch
                    checked={on}
                    disabled={blocked}
                    onCheckedChange={async (v) => {
                      const vetoed = v ? s.vetoed.filter((x) => x !== t.id) : [...s.vetoed, t.id];
                      try {
                        await api(`/studio/${s.slug}/veto`, { body: { vetoed }, token });
                      } catch (e: any) {
                        toast.error(e.message);
                      }
                    }}
                  />
                </li>
              );
            })}
          </ul>
        </section>
        <section className="surface space-y-4 p-4">
          <div>
            <h2 className="text-sm font-semibold">Put markets on your stream</h2>
            <p className="mt-1 text-sm text-muted-foreground">In OBS, add a Browser Source at 1920 × 1080 with this URL. A card with the live market and a QR code appears during markets and hides between them.</p>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-sunk px-3 py-2">
            <code className="min-w-0 flex-1 truncate font-mono text-xs">{overlay}</code>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 rounded-md"
              onClick={() => {
                void navigator.clipboard.writeText(overlay);
                toast.success("Overlay URL copied");
              }}
            >
              <CopyIcon /> Copy
            </Button>
          </div>
          <div className="rounded-lg bg-sunk p-3 text-xs leading-relaxed text-muted-foreground">
            You can't trade your own markets: the contract checks your verified human ID on every trade. You earn 0.5% of volume whichever way markets go, so there's never a reason to throw.
          </div>
        </section>
      </div>
    </div>
  );
}
