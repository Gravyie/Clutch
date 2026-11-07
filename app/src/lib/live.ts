"use client";

import { useEffect, useState } from "react";
import { create } from "zustand";
import type { AgentState, ChainState, MarketView, Receipt, Refusal, ServerMessage, StreamState, StreamSummary, TradeEvent } from "@clutch/shared";
import { ENGINE_URL } from "./env";

/**
 * Live state from the engine's WebSocket. One socket per tab; components subscribe to channels they render
 * ("global" always, "stream:<slug>" while a channel page is open).
 */
interface LiveState {
  connected: boolean;
  streams: Record<string, StreamSummary>;
  streamStates: Record<string, StreamState>;
  markets: Record<number, MarketView>;
  receipts: Receipt[];
  trades: TradeEvent[];
  refusals: Record<string, Refusal[]>;
  agent?: AgentState;
  chain?: ChainState;
}

export const useLive = create<LiveState>(() => ({ connected: false, streams: {}, streamStates: {}, markets: {}, receipts: [], trades: [], refusals: {} }));

const listeners = new Set<(m: ServerMessage) => void>();
export const onServerMessage = (fn: (m: ServerMessage) => void) => {
  listeners.add(fn);
  return () => void listeners.delete(fn);
};

function apply(m: ServerMessage) {
  useLive.setState((s) => {
    switch (m.type) {
      case "hello":
        return {
          connected: true,
          streams: Object.fromEntries(m.streams.map((x) => [x.slug, x])),
          markets: { ...s.markets, ...Object.fromEntries(m.markets.map((x) => [x.id, x])) },
          receipts: m.receipts,
          agent: m.agent,
          chain: m.chain,
        };
      case "streams":
        return { streams: Object.fromEntries(m.streams.map((x) => [x.slug, x])) };
      case "stream":
        return { streamStates: { ...s.streamStates, [m.stream.slug]: m.stream } };
      case "market":
        return { markets: { ...s.markets, [m.market.id]: m.market } };
      case "receipt":
        return { receipts: [m.receipt, ...s.receipts.filter((r) => r.marketId !== m.receipt.marketId)].slice(0, 40) };
      case "trade":
        return { trades: [m.trade, ...s.trades].slice(0, 80) };
      case "refusal":
        return { refusals: { ...s.refusals, [m.refusal.slug]: [m.refusal, ...(s.refusals[m.refusal.slug] ?? [])].slice(0, 20) } };
      case "agent":
        return { agent: m.agent };
      case "chain":
        return { chain: m.chain };
    }
  });
  for (const fn of listeners) fn(m);
}

let ws: WebSocket | undefined;
const wanted = new Map<string, number>();
let started = false;

function connect() {
  ws = new WebSocket(ENGINE_URL.replace(/^http/, "ws") + "/ws");
  ws.onopen = () => {
    retry = 500;
    ws?.send(JSON.stringify({ type: "sub", channels: [...wanted.keys()] }));
  };
  ws.onmessage = (e) => apply(JSON.parse(e.data));
  ws.onclose = () => {
    useLive.setState({ connected: false });
    setTimeout(connect, (retry = Math.min(retry * 2, 8000)));
  };
}
let retry = 500;

function sub(channel: string) {
  wanted.set(channel, (wanted.get(channel) ?? 0) + 1);
  if (!started && typeof window !== "undefined") {
    started = true;
    connect();
  } else if (wanted.get(channel) === 1 && ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "sub", channels: [channel] }));
}

function unsub(channel: string) {
  const n = (wanted.get(channel) ?? 1) - 1;
  if (n > 0) return void wanted.set(channel, n);
  wanted.delete(channel);
  if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "unsub", channels: [channel] }));
}

export function useChannel(channel: string | undefined) {
  useEffect(() => {
    if (!channel) return;
    sub(channel);
    return () => unsub(channel);
  }, [channel]);
}

/** Current unix time in seconds, re-rendering on an interval. */
export function useNow(ms = 250) {
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export async function api<T = any>(path: string, opts: { body?: unknown; token?: string } = {}): Promise<T> {
  const res = await fetch("/api/engine" + path, {
    method: opts.body === undefined ? "GET" : "POST",
    headers: { ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}), ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(j.message ?? j.error ?? "Request failed"), { code: j.error, status: res.status });
  return j as T;
}
