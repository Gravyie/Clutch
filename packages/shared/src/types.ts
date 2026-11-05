import type { ChessFacts, Evaluation, RefusalReason, Side } from "./grammar";
import type { Category, SceneState } from "./vision";

export type MarketPhase = "trading" | "locked" | "window" | "resolving" | "settled" | "void";
export type Outcome = "YES" | "NO" | "VOID";

/** The committed rule. Its keccak256 (over canonical JSON) is stored onchain before any trade. */
export interface Rule {
  v: 1;
  adapter: "chess" | "vision";
  template: string;
  params: Record<string, unknown>;
  subject: { gameId: string; white: string; black: string } | { stream: string; scene: string; teams: string[] };
  question: string;
  resolution: string;
  sources: [string, string];
  /** unix seconds, mirrored onchain */
  lockTime: number;
  windowStart: number;
  windowEnd: number;
  agreement: string;
}

export interface AiDecision {
  provider: "0g" | "heuristic";
  model: string;
  requestId?: string;
  latencyMs?: number;
  costUsd?: number;
  rationale: string;
  headline?: string;
}

export interface MarketView {
  id: number;
  slug: string;
  streamTitle: string;
  question: string;
  template: string;
  rule: Rule;
  ruleHash: `0x${string}`;
  phase: MarketPhase;
  openedAt: number;
  lockTime: number;
  windowStart: number;
  windowEnd: number;
  pYes0: number;
  priceYes: number;
  b: number;
  subsidy: number;
  volume: number;
  trades: number;
  traders: number;
  outcome?: Outcome;
  voidReason?: string;
  ai: AiDecision;
  tx: { open?: `0x${string}`; resolve?: `0x${string}` };
}

export interface SourceReading {
  source: string;
  evaluation: Evaluation | "MISSING";
  plies: number;
  status: string;
  winner?: Side;
  digest: `0x${string}`;
  excerpt: { san: string; at: number; material: number }[];
}

export interface Receipt {
  marketId: number;
  slug: string;
  question: string;
  rule: Rule;
  ruleHash: `0x${string}`;
  readings: [SourceReading, SourceReading];
  verdict: Outcome;
  voidReason?: string;
  blackout?: boolean;
  evidenceRoot: `0x${string}`;
  storage: { provider: "0g" | "local"; txHash?: string; uri: string };
  resolvedAt: number;
  tx?: `0x${string}`;
  ai: AiDecision;
  /** vision markets: the frames the second reader judged */
  frames?: { at: number; url: string; reader: string; summary: string }[];
}

export interface Refusal {
  at: number;
  slug: string;
  template: string;
  question: string;
  reason: RefusalReason;
  detail: string;
}

export interface Player {
  name: string;
  title?: string;
  rating?: number;
  ms?: number;
}

export type StreamKind = "lichess-tv" | "lichess-user" | "replay" | "video";
export type Media = { kind: "chess" } | { kind: "video"; platform: "twitch" | "kick" | "youtube"; channel: string };

/** What a channel card needs: enough to render the browse grid and the live rail. */
export interface StreamSummary {
  slug: string;
  kind: StreamKind;
  title: string;
  /** "Blitz 3+0", "Bullet 1+0", streamer's tagline */
  subtitle: string;
  media: Media;
  category: Category | "chess";
  /** the platform's game/category name */
  game?: string;
  /** the platform's live stream title */
  streamTitle?: string;
  /** reruns are watchable but never get markets */
  rerun?: boolean;
  /** what the AI currently sees (vision channels) */
  vision?: { state: SceneState; at: number; reader: string; ms: number };
  frameAt?: number;
  owner?: { address: `0x${string}`; lichess?: string; twitch?: string; verified: boolean };
  live: boolean;
  watching: number;
  gameId?: string;
  fen: string;
  lastMove?: string;
  orientation: Side;
  white: Player;
  black: Player;
  plies: number;
  status: string;
  market?: Pick<MarketView, "id" | "question" | "phase" | "priceYes" | "lockTime" | "volume" | "outcome">;
  settledToday: number;
  volumeToday: number;
}

export interface StreamState extends StreamSummary {
  latencyBufferSec: number;
  paused: boolean;
  vetoed: string[];
  poolId?: `0x${string}`;
  moments: { at: number; text: string; kind: "game" | "market" | "integrity" }[];
}

export interface AgentState {
  address: `0x${string}`;
  mode: "full" | "degraded" | "paused";
  provider: "0g" | "heuristic";
  model: string;
  requestsToday: number;
  spentTodayUsd: number;
  capTodayUsd: number;
  earnedUsd: number;
  lastRequestId?: string;
}

export interface ChainState {
  chainId: number;
  block: number;
  sequencerPhase: "Normal" | "Down" | "Recovering" | "Unknown";
  blocksIntoRecovery: number;
  blackoutFeePips: number;
  vault: { totalAssets: number; idle: number; outstanding: number; realizedPnl: number; marketsFunded: number };
}

export interface TradeEvent {
  marketId: number;
  slug: string;
  trader: `0x${string}`;
  yes: boolean;
  amount: number;
  shares: number;
  priceYesAfter: number;
  at: number;
  tx: `0x${string}`;
}

export interface PricePoint {
  t: number;
  p: number;
}

export interface Position {
  marketId: number;
  slug: string;
  question: string;
  phase: MarketPhase;
  outcome?: Outcome;
  priceYes: number;
  yes: number;
  no: number;
  cost: number;
  /** what the position is worth now: payout if settled, mark-to-market if open */
  value: number;
  claimable: number;
  claimed: boolean;
  openedAt: number;
}

export interface Portfolio {
  address: `0x${string}`;
  positions: Position[];
  stats: { volume: number; realizedPnl: number; openValue: number; claimable: number; markets: number; won: number; lost: number };
}

export interface LeaderRow {
  rank: number;
  address: `0x${string}`;
  name?: string;
  pnl: number;
  volume: number;
  markets: number;
  winRate: number;
}

export interface Profile {
  address: `0x${string}`;
  name?: string;
  createdAt: number;
}

/** WebSocket: clients subscribe to "global" and any number of "stream:<slug>" channels. */
export type ClientMessage = { type: "sub"; channels: string[] } | { type: "unsub"; channels: string[] };

export type ServerMessage =
  | { type: "hello"; streams: StreamSummary[]; markets: MarketView[]; receipts: Receipt[]; agent: AgentState; chain: ChainState }
  | { type: "streams"; streams: StreamSummary[] }
  | { type: "market"; market: MarketView }
  | { type: "receipt"; receipt: Receipt }
  | { type: "trade"; trade: TradeEvent }
  | { type: "agent"; agent: AgentState }
  | { type: "chain"; chain: ChainState }
  | { type: "stream"; stream: StreamState }
  | { type: "refusal"; refusal: Refusal };

export type { ChessFacts };
