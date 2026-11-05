/**
 * The market grammar.
 *
 * Every market = subject + event + window + condition, chosen only from these templates. The AI picks *which*
 * template, *when*, and *at what opening price*; it never writes a question. Each template declares the fields it
 * reads, so a market is only listed if both independent sources emit those fields, and a deterministic
 * `evaluate` decides the outcome. Judgement can be argued; a scoreboard can't.
 */

export type Side = "white" | "black";
export type Verdict = "YES" | "NO";
export type Evaluation = Verdict | "PENDING";

export interface Ply {
  uci: string;
  san: string;
  /** ms since epoch when the source first observed this ply */
  at: number;
  fenAfter: string;
  /** material balance after the ply, white minus black, in pawns (P1 N3 B3 R5 Q9) */
  material: number;
  whiteMs?: number;
  blackMs?: number;
}

export type GameStatus = "started" | "mate" | "resign" | "outoftime" | "draw" | "stalemate" | "timeout" | "aborted" | "unknown";

/** What one source reports about one game. Two of these, from independent sources, settle a market. */
export interface ChessFacts {
  gameId: string;
  plies: Ply[];
  status: GameStatus;
  winner?: Side;
  endedAt?: number;
  white: { name: string; rating?: number; title?: string };
  black: { name: string; rating?: number; title?: string };
  whiteMs?: number;
  blackMs?: number;
  speed?: string;
  clock?: { initial: number; increment: number };
}

export type FactField = "plies" | "material" | "status" | "winner" | "clocks";

export interface WindowSpec {
  /** unix ms */
  start: number;
  /** unix ms */
  end: number;
}

export interface TemplateContext {
  facts: ChessFacts;
  now: number;
}

export interface Template<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  title: string;
  /** 0 (contested by opponents, clocks or chance) … 1 (one person decides it for free). Listed only if ≤ 0.5. */
  steerability: number;
  steerabilityReason: string;
  /** Safety class. "behaviour" markets (about a person's conduct) are never listed. */
  safety: "game" | "behaviour";
  requires: FactField[];
  /** Max length of the event window in seconds. */
  windowSeconds: number;
  eligible(ctx: TemplateContext): boolean;
  params(ctx: TemplateContext): P;
  question(p: P, facts: ChessFacts): string;
  /** Plain-language resolution rule, committed (hashed) with the market. */
  rule(p: P): string;
  /** Deterministic: same inputs, same answer. `now` decides whether a timed-out window counts as NO. */
  evaluate(p: P, facts: ChessFacts, w: WindowSpec, now: number): Evaluation;
}

export const STEERABILITY_LIMIT = 0.5;

const sideName = (f: ChessFacts, s: Side) => (s === "white" ? f.white.name : f.black.name);
const toMove = (f: ChessFacts): Side => (f.plies.length % 2 === 0 ? "white" : "black");
const ended = (f: ChessFacts) => f.status !== "started" && f.status !== "unknown";
const inWindow = (f: ChessFacts, w: WindowSpec) => f.plies.filter((p) => p.at >= w.start && p.at <= w.end);
const materialBefore = (f: ChessFacts, w: WindowSpec) => {
  const before = f.plies.filter((p) => p.at < w.start);
  return before.length ? before[before.length - 1].material : 0;
};

/** A material swing of ≥ threshold pawns within the first K plies of the window. */
const materialSwing: Template<{ plies: number; threshold: number }> = {
  id: "material_swing",
  title: "Material swing",
  steerability: 0.15,
  steerabilityReason: "Either player can sacrifice, but giving up material costs them the game.",
  safety: "game",
  requires: ["plies", "material", "status"],
  windowSeconds: 75,
  eligible: ({ facts }) => !ended(facts) && facts.plies.length >= 12,
  params: () => ({ plies: 4, threshold: 3 }),
  question: (p) => `Material swings by ${p.threshold}+ in the next ${p.plies / 2} moves?`,
  rule: (p) =>
    `YES if, within the first ${p.plies} plies observed at or after window start (and before window end), the material balance ` +
    `(P1 N3 B3 R5 Q9, white minus black) differs from its value at window start by ${p.threshold} or more at any ply. ` +
    `NO otherwise, including if the game ends first.`,
  evaluate(p, f, w, now) {
    const base = materialBefore(f, w);
    const win = inWindow(f, w).slice(0, p.plies);
    if (win.some((x) => Math.abs(x.material - base) >= p.threshold)) return "YES";
    if (win.length >= p.plies || ended(f) || now > w.end) return "NO";
    return "PENDING";
  },
};

/** The game is over within the first N plies of the window. */
const gameEnds: Template<{ plies: number }> = {
  id: "game_ends",
  title: "Game over",
  steerability: 0.3,
  steerabilityReason: "A player can resign, but only by losing; a draw needs both players.",
  safety: "game",
  requires: ["plies", "status"],
  windowSeconds: 120,
  eligible: ({ facts }) => !ended(facts) && facts.plies.length >= 40,
  params: () => ({ plies: 16 }),
  question: (p) => `Game over within the next ${p.plies / 2} moves?`,
  rule: (p) =>
    `YES if the game reaches a final status (mate, resign, flag, draw, stalemate) before ${p.plies} further plies are ` +
    `played after window start and before window end. NO otherwise.`,
  evaluate(p, f, w, now) {
    const win = inWindow(f, w);
    if (ended(f) && (f.endedAt ?? 0) >= w.start && (f.endedAt ?? 0) <= w.end && win.length <= p.plies) return "YES";
    if (ended(f) && (f.endedAt ?? 0) < w.start) return "NO";
    if (win.length > p.plies || now > w.end) return "NO";
    return "PENDING";
  },
};

/** One side wins the game. Window runs from window start to the end of the game. */
const sideWins: Template<{ side: Side }> = {
  id: "side_wins",
  title: "Winner",
  steerability: 0.2,
  steerabilityReason: "Throwing a rated game costs rating; the opponent fights back.",
  safety: "game",
  requires: ["status", "winner"],
  windowSeconds: 900,
  eligible: ({ facts }) => !ended(facts) && facts.plies.length >= 20,
  params: ({ facts }) => ({ side: facts.plies[facts.plies.length - 1]?.material >= 0 ? "white" : "black" }),
  question: (p, f) => `${sideName(f, p.side)} wins this game?`,
  rule: (p) => `YES if the game ends with ${p.side} as the winner. NO if ${p.side} loses or the game is drawn.`,
  evaluate(p, f) {
    if (!ended(f)) return "PENDING";
    return f.winner === p.side ? "YES" : "NO";
  },
};

/** A side in time trouble loses on time. */
const flags: Template<{ side: Side }> = {
  id: "flags",
  title: "Flag",
  steerability: 0.25,
  steerabilityReason: "Flagging on purpose means losing; the opponent's clock pressure is real.",
  safety: "game",
  requires: ["status", "winner", "clocks"],
  windowSeconds: 120,
  eligible: ({ facts }) => {
    if (ended(facts)) return false;
    const s = toMove(facts);
    const ms = s === "white" ? facts.whiteMs : facts.blackMs;
    return ms !== undefined && ms < 25_000 && ms > 4_000;
  },
  params: ({ facts }) => ({ side: toMove(facts) }),
  question: (p, f) => `${sideName(f, p.side)} flags?`,
  rule: (p) => `YES if the game ends with status "outoftime" and ${p.side} as the loser before window end. NO otherwise.`,
  evaluate(p, f, w, now) {
    if (ended(f)) return f.status === "outoftime" && f.winner && f.winner !== p.side ? "YES" : "NO";
    if (now > w.end) return "NO";
    return "PENDING";
  },
};

// ── Templates the engine may consider but that the validator must refuse. Shown in the refusal log. ──

const givesCheck: Template<{ side: Side }> = {
  id: "gives_check",
  title: "Check",
  steerability: 0.9,
  steerabilityReason: "The player to move can usually give check at no cost.",
  safety: "game",
  requires: ["plies"],
  windowSeconds: 30,
  eligible: ({ facts }) => !ended(facts),
  params: ({ facts }) => ({ side: toMove(facts) }),
  question: (p, f) => `${sideName(f, p.side)} gives check next move?`,
  rule: (p) => `YES if ${p.side}'s next move gives check.`,
  evaluate(p, f, w, now) {
    const m = inWindow(f, w)[0];
    return m ? (m.san.includes("+") || m.san.includes("#") ? "YES" : "NO") : "PENDING";
  },
};

const castles: Template<{ side: Side }> = {
  id: "castles",
  title: "Castle",
  steerability: 0.95,
  steerabilityReason: "Castling is one player's free choice.",
  safety: "game",
  requires: ["plies"],
  windowSeconds: 60,
  eligible: ({ facts }) => !ended(facts) && facts.plies.length < 30,
  params: ({ facts }) => ({ side: toMove(facts) }),
  question: (p, f) => `${sideName(f, p.side)} castles in the next 3 moves?`,
  rule: (p) => `YES if ${p.side} castles within 6 plies.`,
  evaluate(p, f, w, now) {
    const win = inWindow(f, w).slice(0, 6);
    if (win.some((m) => m.san.startsWith("O-O"))) return "YES";
    return win.length >= 6 ? "NO" : "PENDING";
  },
};

const tilts: Template<{ side: Side }> = {
  id: "tilts",
  title: "Tilt",
  steerability: 1,
  steerabilityReason: "About a person's behaviour, and entirely theirs to decide.",
  safety: "behaviour",
  requires: [],
  windowSeconds: 60,
  eligible: () => true,
  params: ({ facts }) => ({ side: toMove(facts) }),
  question: (p, f) => `${sideName(f, p.side)} rage-quits?`,
  rule: () => "Not listable.",
  evaluate: () => "PENDING",
};

export const TEMPLATES: Template<any>[] = [materialSwing, gameEnds, sideWins, flags, givesCheck, castles, tilts];
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

/** Fields each of our chess sources emits. A template is resolvable only if both sources cover its `requires`. */
export const SOURCE_FIELDS: Record<string, FactField[]> = {
  "lichess:tv-stream": ["plies", "material", "status", "winner", "clocks"],
  "lichess:rest-export": ["plies", "material", "status", "winner", "clocks"],
  "vision:0g": ["status", "winner", "clocks"],
};

export type RefusalReason =
  | "steerable"
  | "unsafe"
  | "not-uncertain"
  | "not-resolvable"
  | "not-forward"
  | "paced"
  | "vetoed"
  | "budget";

export interface ValidationInput {
  template: { id: string; safety: "game" | "behaviour"; steerability: number; steerabilityReason: string; requires: readonly string[] };
  pYes: number;
  sources: [string, string];
  vetoedCategories: string[];
  /** vision markets: whether both readers currently see the fields the template needs */
  fieldsOk?: boolean;
}

/** The engine's rules for a valid market. Returns null if the market may be listed. */
export function validate({ template, pYes, sources, vetoedCategories, fieldsOk }: ValidationInput): { reason: RefusalReason; detail: string } | null {
  if (template.safety !== "game") return { reason: "unsafe", detail: "Markets about a person's behaviour are never listed." };
  if (vetoedCategories.includes(template.id)) return { reason: "vetoed", detail: "The streamer vetoed this category." };
  if (template.steerability > STEERABILITY_LIMIT)
    return { reason: "steerable", detail: `${template.steerabilityReason} (steerability ${template.steerability.toFixed(2)} > ${STEERABILITY_LIMIT})` };
  const covered = (s: string) => (template.requires as string[]).every((f) => SOURCE_FIELDS[s]?.includes(f as FactField));
  if (fieldsOk === false || (fieldsOk === undefined && (!covered(sources[0]) || !covered(sources[1]))))
    return { reason: "not-resolvable", detail: `Both sources must emit ${template.requires.join(", ")}.` };
  if (pYes < 0.15 || pYes > 0.85)
    return { reason: "not-uncertain", detail: `Opening probability ${(pYes * 100).toFixed(0)}% is outside 15–85%.` };
  return null;
}

/** Material balance (white minus black) from a FEN. */
export function materialFromFen(fen: string): number {
  const v: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9 };
  let m = 0;
  for (const ch of fen.split(" ")[0]) {
    const lower = ch.toLowerCase();
    if (v[lower] === undefined) continue;
    m += ch === lower ? -v[lower] : v[lower];
  }
  return m;
}
