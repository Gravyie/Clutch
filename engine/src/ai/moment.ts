import { Chess } from "chess.js";
import { z } from "zod";
import { TEMPLATES, templateById, validate, type ChessFacts, type Template, type AiDecision, type Refusal } from "@clutch/shared";
import type { ZeroG } from "./zeroG";
import { log } from "../log";
import { config } from "../config";

export const SOURCES: [string, string] = ["lichess:tv-stream", "lichess:rest-export"];

export interface Features {
  ply: number;
  move: number;
  toMove: "white" | "black";
  material: number;
  capturesLast10: number;
  hangingValue: number;
  inCheck: boolean;
  whiteSec?: number;
  blackSec?: number;
  lastMoves: string[];
}

export function features(f: ChessFacts): Features {
  const last = f.plies[f.plies.length - 1];
  const fen = last?.fenAfter ?? new Chess().fen();
  const chess = new Chess(fen);
  const values: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  // Best material the side to move can grab right now: a cheap proxy for tactical tension.
  const hangingValue = chess
    .moves({ verbose: true })
    .filter((m) => m.captured)
    .reduce((mx, m) => Math.max(mx, values[m.captured!] ?? 0), 0);
  return {
    ply: f.plies.length,
    move: Math.floor(f.plies.length / 2) + 1,
    toMove: f.plies.length % 2 === 0 ? "white" : "black",
    material: last?.material ?? 0,
    capturesLast10: f.plies.slice(-10).filter((p) => p.san.includes("x")).length,
    hangingValue,
    inCheck: chess.inCheck(),
    whiteSec: f.whiteMs !== undefined ? Math.round(f.whiteMs / 1000) : undefined,
    blackSec: f.blackMs !== undefined ? Math.round(f.blackMs / 1000) : undefined,
    lastMoves: f.plies.slice(-8).map((p) => p.san),
  };
}

const clamp = (x: number, lo = 0.05, hi = 0.95) => Math.min(hi, Math.max(lo, x));
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));

/** Transparent base-rate model. Used when 0G is not configured, and as the prior the model can adjust. */
export function prior(t: Template<any>, p: any, x: Features): number {
  switch (t.id) {
    case "material_swing":
      return clamp(0.2 + 0.06 * x.capturesLast10 + (x.hangingValue >= 3 ? 0.25 : 0) + (x.inCheck ? 0.08 : 0));
    case "game_ends": {
      const low = Math.min(x.whiteSec ?? 999, x.blackSec ?? 999);
      return clamp(sigmoid((Math.abs(x.material) - 4) / 1.6) * 0.7 + (low < 20 ? 0.2 : 0));
    }
    case "side_wins": {
      const clockAdv = (x.whiteSec ?? 0) - (x.blackSec ?? 0);
      const white = sigmoid(x.material * 0.55 + clockAdv * 0.012);
      return clamp(p.side === "white" ? white : 1 - white);
    }
    case "flags": {
      const s = p.side === "white" ? x.whiteSec : x.blackSec;
      return clamp(s === undefined ? 0.3 : 0.75 - s / 40);
    }
    default:
      return 0.5;
  }
}

/** How much a moment deserves a market right now (0–1). */
export function interest(x: Features): number {
  const low = Math.min(x.whiteSec ?? 999, x.blackSec ?? 999);
  return Math.min(1, 0.15 + 0.12 * x.capturesLast10 + (x.hangingValue >= 3 ? 0.3 : 0) + (x.inCheck ? 0.15 : 0) + (low < 30 ? 0.25 : 0));
}

const Choice = z.object({
  template: z.string(),
  pYes: z.number().min(0).max(1),
  headline: z.string().max(90).optional(),
  rationale: z.string().max(400),
});

export interface Proposal {
  template: Template<any>;
  params: Record<string, unknown>;
  question: string;
  pYes: number;
  headline: string;
  ai: AiDecision;
}

const SYSTEM = `You are the moment engine for Clutch, a live prediction product on chess streams.
You may only pick from the candidate templates provided; you never write questions.
Prefer variety: avoid repeating a template listed recently unless it is clearly the best moment.
Pick the single template whose outcome is most genuinely uncertain and most exciting right now, and give a calibrated
probability that it resolves YES (be honest; viewers trade against your number, and liquidity providers lose if you are biased).
Respond with JSON: {"template": "<id>", "pYes": <0..1>, "headline": "<=8 words describing the moment, broadcast tone>", "rationale": "<one or two sentences>"}.`;

export async function propose(
  facts: ChessFacts,
  zg: ZeroG,
  vetoed: string[],
  onRefusal: (r: Omit<Refusal, "slug">) => void,
  recent: string[] = [],
): Promise<Proposal | null> {
  const x = features(facts);
  const ctx = { facts, now: Date.now() };
  // Rounds stay short: a market whose window runs for most of a game ("X wins this game?", 15 minutes) would hold the
  // channel while trading lasts seconds, so the agent only picks templates that settle within a couple of minutes.
  const eligible = TEMPLATES.filter((t) => t.eligible(ctx) && t.windowSeconds <= MAX_WINDOW_SEC);

  // Everything eligible goes through the validator; refusals are logged so the integrity story is visible.
  const candidates: { t: Template<any>; params: any; question: string; prior: number }[] = [];
  for (const t of eligible) {
    const params = t.params(ctx);
    const question = t.question(params, facts);
    const pr = prior(t, params, x);
    const refusal = validate({ template: t, pYes: pr, sources: SOURCES, vetoedCategories: vetoed });
    if (refusal && refusal.reason !== "not-uncertain") {
      onRefusal({ at: Date.now(), template: t.id, question, reason: refusal.reason, detail: refusal.detail });
      continue;
    }
    candidates.push({ t, params, question, prior: pr });
  }
  if (!candidates.length) return null;
  // Hard variety rule: the last two templates on this channel sit out whenever anything else is eligible.
  const fresh = candidates.filter((c) => !recent.slice(0, 2).includes(c.t.id)); // recent is newest first
  if (fresh.length) candidates.splice(0, candidates.length, ...fresh);

  let choice: z.infer<typeof Choice>;
  let ai: AiDecision;
  if (zg.provider === "0g" && zg.mode !== "paused") {
    const user = JSON.stringify({
      game: { white: facts.white, black: facts.black, ...x },
      recentlyListed: recent,
      candidates: candidates.map((c) => ({ id: c.t.id, question: c.question, rule: c.t.rule(c.params), basePrior: Number(c.prior.toFixed(2)) })),
    });
    try {
      const r = await zg.json<unknown>(SYSTEM, user);
      choice = Choice.parse(r.data);
      ai = { provider: "0g", model: config.zgModel, requestId: r.requestId, latencyMs: r.latencyMs, costUsd: r.costUsd, rationale: choice.rationale };
    } catch (e: any) {
      log.warn("0G moment call failed; skipping this moment", e.message);
      return null; // never invent a market without the agent
    }
  } else if (zg.provider === "heuristic") {
    const best = candidates
      .filter((c) => c.prior >= 0.15 && c.prior <= 0.85)
      .map((c) => ({ c, score: Math.abs(c.prior - 0.5) + 0.2 * recent.filter((r) => r === c.t.id).length }))
      .sort((a, b) => a.score - b.score)[0]?.c;
    if (!best) return null;
    choice = { template: best.t.id, pYes: best.prior, rationale: "Offline base-rate model (0G not configured): closest-to-even eligible template." };
    ai = { provider: "heuristic", model: "base-rates-v1", rationale: choice.rationale };
  } else {
    return null; // budget spent
  }

  const c = candidates.find((k) => k.t.id === choice.template);
  if (!c) return null;
  const pYes = Math.round(choice.pYes * 100) / 100;
  const refusal = validate({ template: c.t, pYes, sources: SOURCES, vetoedCategories: vetoed });
  if (refusal) {
    onRefusal({ at: Date.now(), template: c.t.id, question: c.question, reason: refusal.reason, detail: refusal.detail });
    return null;
  }
  return { template: c.t, params: c.params, question: c.question, pYes, headline: choice.headline ?? c.t.title, ai };
}

const MAX_WINDOW_SEC = Number(process.env.CHESS_MAX_WINDOW_SEC ?? 150);

export { templateById };
