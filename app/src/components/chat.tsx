"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { PaperPlaneRightIcon, SparkleIcon, TwitchLogoIcon } from "@phosphor-icons/react";
import { toast } from "sonner";
import type { MarketView } from "@clutch/shared";
import { useConfig } from "@/lib/account";
import { useLive } from "@/lib/live";
import { cn } from "@/lib/utils";

/**
 * The streamer's real Twitch chat, beside the market. Reading uses Twitch's anonymous IRC socket (no login). Viewers
 * who connect Twitch can talk in that same chat (Helix "Send Chat Message"), and post their call on the live market
 * there, which is how a market reaches the people who aren't on Clutch yet.
 */

type Line = { id: string; kind: "chat"; user: string; color?: string; text: string; at: number } | { id: string; kind: "clutch"; text: string; tone: "open" | "yes" | "no" | "void"; at: number };

const TOKEN = "clutch.twitch.token";

export function useTwitchToken() {
  const [token, setToken] = useState<{ access: string; login: string; id: string } | null>(null);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(TOKEN);
      if (raw) setToken(JSON.parse(raw));
    } catch {}
  }, []);
  return {
    token,
    clear() {
      try {
        localStorage.removeItem(TOKEN);
      } catch {}
      setToken(null);
    },
  };
}

/** Sends the viewer to Twitch to authorize chatting as themselves, and back to this page. */
export function connectTwitch(clientId: string) {
  const redirect = `${location.origin}/twitch`;
  try {
    sessionStorage.setItem("clutch.twitch.return", location.pathname);
  } catch {}
  const url = new URL("https://id.twitch.tv/oauth2/authorize");
  url.search = new URLSearchParams({ response_type: "token", client_id: clientId, redirect_uri: redirect, scope: "user:write:chat user:read:chat" }).toString();
  location.href = url.toString();
}

function useIrc(channel: string) {
  const [lines, setLines] = useState<Line[]>([]);
  const [status, setStatus] = useState<"connecting" | "live" | "closed">("connecting");
  useEffect(() => {
    let ws: WebSocket | undefined;
    let stop = false;
    let retry = 1000;
    const open = () => {
      ws = new WebSocket("wss://irc-ws.chat.twitch.tv:443");
      ws.onopen = () => {
        retry = 1000;
        ws!.send("CAP REQ :twitch.tv/tags");
        ws!.send("PASS SCHMOOPIIE");
        ws!.send(`NICK justinfan${Math.floor(10000 + Math.random() * 80000)}`);
        ws!.send(`JOIN #${channel.toLowerCase()}`);
        setStatus("live");
      };
      ws.onmessage = (e) => {
        for (const raw of String(e.data).split("\r\n")) {
          if (raw.startsWith("PING")) ws!.send("PONG :tmi.twitch.tv");
          const m = raw.match(/^(?:@(\S+) )?:(\w+)!\S+ PRIVMSG #\S+ :(.*)$/);
          if (!m) continue;
          const tags = Object.fromEntries((m[1] ?? "").split(";").map((t) => t.split("=")));
          setLines((l) => [...l.slice(-149), { id: tags.id ?? crypto.randomUUID(), kind: "chat", user: tags["display-name"] || m[2], color: tags.color || undefined, text: m[3], at: Date.now() }]);
        }
      };
      ws.onclose = () => {
        setStatus("closed");
        if (!stop) setTimeout(open, (retry = Math.min(retry * 2, 15_000)));
      };
    };
    open();
    return () => {
      stop = true;
      ws?.close();
    };
  }, [channel]);
  return { lines, setLines, status };
}

async function helix<T>(path: string, token: string, clientId: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`https://api.twitch.tv/helix/${path}`, { ...init, headers: { "Client-Id": clientId, Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const body: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.message ?? `Twitch said ${r.status}`);
  return body as T;
}

export function TwitchChat({ channel, slug, className }: { channel: string; slug: string; className?: string }) {
  const { data: cfg } = useConfig();
  const clientId = cfg?.twitchClientId;
  const { lines, setLines, status } = useIrc(channel);
  const { token, clear } = useTwitchToken();
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const broadcasterId = useRef<string | undefined>(undefined);

  // Clutch's own market events, inline with the chat.
  const markets = useLive((s) => s.markets);
  const seen = useRef(new Map<number, string>());
  useEffect(() => {
    for (const m of Object.values(markets) as MarketView[]) {
      if (m.slug !== slug) continue;
      const key = m.phase === "settled" || m.phase === "void" ? `done:${m.outcome}` : "open";
      if (seen.current.get(m.id) === key) continue;
      const first = !seen.current.has(m.id);
      seen.current.set(m.id, key);
      if (first && key !== "open") continue; // don't replay history
      const line: Line =
        key === "open"
          ? { id: `m${m.id}`, kind: "clutch", tone: "open", text: `New market: ${m.question} Yes ${Math.round(m.priceYes * 100)}¢`, at: Date.now() }
          : { id: `r${m.id}`, kind: "clutch", tone: m.outcome === "YES" ? "yes" : m.outcome === "NO" ? "no" : "void", text: `${m.question} → ${m.outcome === "VOID" ? "void, everyone refunded" : m.outcome}`, at: Date.now() };
      setLines((l) => [...l.slice(-149), line]);
    }
  }, [markets, slug, setLines]);

  useEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [lines]);

  async function send(message: string) {
    if (!token || !clientId || !message.trim()) return;
    setSending(true);
    try {
      broadcasterId.current ??= (await helix<{ data: { id: string }[] }>(`users?login=${encodeURIComponent(channel)}`, token.access, clientId)).data[0]?.id;
      const r = await helix<{ data: { is_sent: boolean; drop_reason?: { message: string } }[] }>("chat/messages", token.access, clientId, {
        method: "POST",
        body: JSON.stringify({ broadcaster_id: broadcasterId.current, sender_id: token.id, message: message.slice(0, 480) }),
      });
      if (!r.data[0]?.is_sent) throw new Error(r.data[0]?.drop_reason?.message ?? "Twitch didn't send it");
      setText("");
    } catch (e: any) {
      if (/401|invalid|token/i.test(e.message)) clear();
      toast.error("Message not sent", { description: e.message });
    } finally {
      setSending(false);
    }
  }

  const live = useMemo(() => Object.values(markets).find((m) => m.slug === slug && m.phase === "trading"), [markets, slug]);

  return (
    <section className={cn("surface flex min-h-0 flex-col overflow-hidden", className)}>
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-sm font-semibold">
          <TwitchLogoIcon size={16} weight="fill" className="text-[#a970ff]" /> Stream chat
        </span>
        <span className={cn("text-[11px]", status === "live" ? "text-faint" : "text-warn")}>{status === "live" ? `#${channel}` : status}</span>
      </header>
      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
        className="scrollbar-none min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3 text-[13px] leading-snug"
      >
        {lines.length === 0 && <p className="py-8 text-center text-xs text-faint">{status === "live" ? "Waiting for chat…" : "Connecting to chat…"}</p>}
        {lines.map((l) =>
          l.kind === "chat" ? (
            <p key={l.id} className="break-words">
              <span className="font-semibold" style={{ color: l.color ?? "var(--muted-foreground)" }}>
                {l.user}
              </span>
              <span className="text-faint">: </span>
              <span className="text-foreground/90">{l.text}</span>
            </p>
          ) : (
            <p
              key={l.id}
              className={cn(
                "flex items-start gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium",
                l.tone === "open" ? "bg-brand-soft text-brand" : l.tone === "yes" ? "bg-yes-soft text-yes" : l.tone === "no" ? "bg-no-soft text-no" : "bg-void-soft text-void",
              )}
            >
              <SparkleIcon size={13} weight="fill" className="mt-px shrink-0" /> {l.text}
            </p>
          ),
        )}
      </div>
      <footer className="border-t border-border p-3">
        {token ? (
          <>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(text);
              }}
              className="flex items-center gap-2"
            >
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={`Chat as ${token.login}`}
                maxLength={480}
                className="h-10 min-w-0 flex-1 rounded-full border border-border bg-raised px-4 text-sm outline-none focus:border-border-strong"
              />
              <button disabled={sending || !text.trim()} className="grid size-10 place-items-center rounded-full bg-[#9146ff] text-white transition disabled:opacity-40" aria-label="Send">
                <PaperPlaneRightIcon size={16} weight="fill" />
              </button>
            </form>
            {live && (
              <button
                onClick={() => send(`Calling it on Clutch: "${live.question}" is at ${Math.round(live.priceYes * 100)}% right now → ${location.origin}/c/${slug}`)}
                className="mt-2 w-full truncate rounded-full border border-dashed border-border-strong px-3 py-1.5 text-xs text-muted-foreground transition hover:text-foreground"
              >
                Share the live market in chat
              </button>
            )}
          </>
        ) : clientId ? (
          <button onClick={() => connectTwitch(clientId)} className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-[#9146ff] text-sm font-semibold text-white transition hover:bg-[#7c3aed]">
            <TwitchLogoIcon size={16} weight="fill" /> Connect Twitch to chat
          </button>
        ) : (
          <p className="text-center text-xs text-faint">Chat is read-only here.</p>
        )}
      </footer>
    </section>
  );
}
