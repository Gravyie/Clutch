/**
 * The market grammar for video streams (any platform, any game).
 *
 * A perception model reads frames of the public stream into a small, category-specific state (scoreboard, round
 * phase, players alive, clock). Templates are predicates over that state. Two independent readers (different model,
 * different frames, different connection) must reach the same verdict, or the market voids and everyone is refunded.
 *
 * The AI chooses which template, when, and at what price. It never invents a question, and it never judges
 * anything a scoreboard can't show.
 */

export type Category = "fps" | "battle-royale" | "moba" | "sports" | "irl" | "other";

export const CATEGORIES: { id: Category; title: string; games: string[] }[] = [
  { id: "fps", title: "Shooters", games: ["Counter-Strike", "VALORANT", "Rainbow Six Siege", "Overwatch 2", "Call of Duty"] },
  { id: "battle-royale", title: "Battle royale", games: ["Fortnite", "Apex Legends", "PUBG: BATTLEGROUNDS", "Call of Duty: Warzone"] },
  { id: "moba", title: "MOBA", games: ["League of Legends", "Dota 2"] },
  { id: "sports", title: "Sports", games: ["Sports", "EA Sports FC 25", "NBA 2K25", "Rocket League"] },
  { id: "irl", title: "IRL", games: ["Just Chatting", "IRL", "Travel & Outdoors"] },
  { id: "other", title: "Other", games: [] },
];

/** Map a platform's game/category name to a Clutch category. */
export function categoryFor(game?: string): Category {
  if (!game) return "other";
  const g = game.toLowerCase();
  for (const c of CATEGORIES) if (c.games.some((x) => g.includes(x.toLowerCase()) || x.toLowerCase().includes(g))) return c.id;
  if (/counter|valorant|siege|overwatch|call of duty|halo|battlefield|deadlock/.test(g)) return "fps";
  if (/fortnite|apex|pubg|warzone|battleground/.test(g)) return "battle-royale";
  if (/league of legends|dota/.test(g)) return "moba";
  if (/fifa|fc 2|nba|nfl|madden|rocket league|football|soccer|basketball|tennis|cricket|hockey/.test(g)) return "sports";
  if (/chatting|irl|travel|music|art|asmr|cooking/.test(g)) return "irl";
  return "other";
}

/** What a perception model reports for one frame. Fields are null when not visible or not confident. */
export interface SceneState {
  /** game or broadcast actually on screen */
  scene: string;
  /** "gameplay" | "menu" | "replay" | "break" | "camera" … ; markets only open during live gameplay */
  mode: "gameplay" | "menu" | "replay" | "break" | "camera" | "other";
  scoreA: number | null;
  scoreB: number | null;
  teamA: string | null;
  teamB: string | null;
  /** fps: "buy" | "live" | "post"; sports: "live" | "stoppage" */
  phase: string | null;
  aliveA: number | null;
  aliveB: number | null;
  /** battle royale: players or teams remaining */
  remaining: number | null;
  /** seconds on the in-game clock, if shown */
  clock: number | null;
  /** fps (CS): "planted" | "none" | "defused" | "exploded" */
  bomb: string | null;
  /** is the player whose view we see alive? */
  povAlive: boolean | null;
  /** one short sentence, for the moment engine and the receipt */
  summary: string;
  /** 0..1, the reader's own confidence in the numbers above */
  confidence: number;
}

export interface Reading {
  /** wall-clock ms the frame was captured */
  at: number;
  /** sha256 of the JPEG */
  frame: string;
  state: SceneState;
  reader: string;
}

export type VisionField = "score" | "phase" | "alive" | "remaining" | "bomb" | "pov" | "clock";

export interface VisionTemplate<P extends Record<string, unknown> = Record<string, unknown>> {
  id: string;
  title: string;
  categories: Category[];
  /** 0 contested by opponents/chance … 1 one person decides it for free. Listed only if ≤ 0.5. */
  steerability: number;
  steerabilityReason: string;
  safety: "game" | "behaviour";
  requires: VisionField[];
  windowSeconds: number;
  eligible(s: SceneState): boolean;
  params(s: SceneState): P;
  question(p: P, s: SceneState): string;
  rule(p: P): string;
  /** Evaluate one reader's timeline. `start` is the reader's last state at or before window start. */
  evaluate(p: P, start: SceneState | undefined, during: Reading[], ended: boolean): "YES" | "NO" | "PENDING";
}

const has = (v: unknown) => v !== null && v !== undefined;
const scored = (s: SceneState) => has(s.scoreA) && has(s.scoreB);
const total = (s: SceneState) => (s.scoreA ?? 0) + (s.scoreB ?? 0);
const firstChange = (start: SceneState | undefined, during: Reading[]) => during.find((r) => scored(r.state) && start && total(r.state) > total(start));

const scoreChange: VisionTemplate<{ seconds: number }> = {
  id: "score_change",
  title: "Next score",
  categories: ["fps", "sports", "moba", "other"],
  steerability: 0.1,
  steerabilityReason: "Scoring is contested by the other side.",
  safety: "game",
  requires: ["score"],
  windowSeconds: 75,
  eligible: (s) => s.mode === "gameplay" && scored(s),
  params: () => ({ seconds: 60 }),
  question: (p) => `Does the score change in the next ${p.seconds}s?`,
  rule: (p) => `YES if the on-screen score total is higher at any point in the ${p.seconds}s window than at window start. NO otherwise.`,
  evaluate(p, start, during, ended) {
    if (!start || !scored(start)) return ended ? "NO" : "PENDING";
    if (firstChange(start, during)) return "YES";
    return ended ? "NO" : "PENDING";
  },
};

const teamScoresNext: VisionTemplate<{ team: "A" | "B"; name: string; seconds: number }> = {
  id: "team_scores_next",
  title: "Who scores",
  categories: ["fps", "sports", "moba"],
  steerability: 0.15,
  steerabilityReason: "Contested by both teams.",
  safety: "game",
  requires: ["score"],
  windowSeconds: 120,
  eligible: (s) => s.mode === "gameplay" && scored(s) && has(s.teamA) && has(s.teamB),
  params: (s) => ({ team: (s.scoreA ?? 0) <= (s.scoreB ?? 0) ? "A" : "B", name: ((s.scoreA ?? 0) <= (s.scoreB ?? 0) ? s.teamA : s.teamB) ?? "Team", seconds: 110 }),
  question: (p) => `${p.name} scores next?`,
  rule: (p) => `YES if the next on-screen score change within ${p.seconds}s is a point for ${p.name}. NO if the other side scores first or nobody scores.`,
  evaluate(p, start, during, ended) {
    const c = firstChange(start, during);
    if (c && start) {
      const mine = p.team === "A" ? (c.state.scoreA ?? 0) > (start.scoreA ?? 0) : (c.state.scoreB ?? 0) > (start.scoreB ?? 0);
      return mine ? "YES" : "NO";
    }
    return ended ? "NO" : "PENDING";
  },
};

const roundEnds: VisionTemplate<{ seconds: number }> = {
  id: "round_ends",
  title: "Round over",
  categories: ["fps"],
  steerability: 0.2,
  steerabilityReason: "Ten players decide how a round ends.",
  safety: "game",
  requires: ["phase", "score"],
  windowSeconds: 50,
  eligible: (s) => s.mode === "gameplay" && s.phase === "live" && scored(s),
  params: () => ({ seconds: 40 }),
  question: (p) => `Round over in the next ${p.seconds}s?`,
  rule: (p) => `YES if the score changes or the round reaches its post-round phase within ${p.seconds}s of window start. NO otherwise.`,
  evaluate(p, start, during, ended) {
    if (firstChange(start, during) || during.some((r) => r.state.phase === "post")) return "YES";
    return ended ? "NO" : "PENDING";
  },
};

const clutch: VisionTemplate<{ side: "A" | "B"; name: string }> = {
  id: "clutch",
  title: "Clutch",
  categories: ["fps"],
  steerability: 0.25,
  steerabilityReason: "One player against several real opponents.",
  safety: "game",
  requires: ["alive", "score"],
  windowSeconds: 75,
  eligible: (s) => s.mode === "gameplay" && s.phase === "live" && ((s.aliveA === 1 && (s.aliveB ?? 0) >= 2) || (s.aliveB === 1 && (s.aliveA ?? 0) >= 2)),
  params: (s) => (s.aliveA === 1 ? { side: "A", name: s.teamA ?? "The last player" } : { side: "B", name: s.teamB ?? "The last player" }),
  question: (p, s) => `${p.name} wins this 1v${p.side === "A" ? s.aliveB : s.aliveA}?`,
  rule: (p) => `YES if the next score change is a round won by ${p.name}. NO if the other side wins the round.`,
  evaluate(p, start, during, ended) {
    const c = firstChange(start, during);
    if (c && start) return (p.side === "A" ? (c.state.scoreA ?? 0) > (start.scoreA ?? 0) : (c.state.scoreB ?? 0) > (start.scoreB ?? 0)) ? "YES" : "NO";
    return ended ? "NO" : "PENDING";
  },
};

const bombPlant: VisionTemplate<{ seconds: number }> = {
  id: "bomb_plant",
  title: "Bomb plant",
  categories: ["fps"],
  steerability: 0.3,
  steerabilityReason: "Attackers must fight through defenders to plant.",
  safety: "game",
  requires: ["bomb", "phase"],
  windowSeconds: 70,
  eligible: (s) => s.mode === "gameplay" && s.phase === "live" && s.bomb === "none" && (s.clock ?? 0) > 50,
  params: () => ({ seconds: 60 }),
  question: () => `Bomb planted this round?`,
  rule: (p) => `YES if the bomb is shown planted within ${p.seconds}s of window start. NO otherwise.`,
  evaluate(p, _start, during, ended) {
    if (during.some((r) => r.state.bomb === "planted" || r.state.bomb === "defused" || r.state.bomb === "exploded")) return "YES";
    return ended ? "NO" : "PENDING";
  },
};

const fieldShrinks: VisionTemplate<{ below: number; seconds: number }> = {
  id: "field_shrinks",
  title: "Players left",
  categories: ["battle-royale"],
  steerability: 0.05,
  steerabilityReason: "The whole lobby decides how fast players fall.",
  safety: "game",
  requires: ["remaining"],
  windowSeconds: 100,
  eligible: (s) => s.mode === "gameplay" && (s.remaining ?? 0) > 6,
  params: (s) => ({ below: Math.max(2, Math.floor((s.remaining ?? 20) * 0.85)), seconds: 90 }),
  question: (p) => `Fewer than ${p.below} left in ${p.seconds}s?`,
  rule: (p) => `YES if the players-remaining counter shows fewer than ${p.below} within ${p.seconds}s. NO otherwise.`,
  evaluate(p, _start, during, ended) {
    if (during.some((r) => has(r.state.remaining) && (r.state.remaining as number) < p.below)) return "YES";
    return ended ? "NO" : "PENDING";
  },
};

const povSurvives: VisionTemplate<{ seconds: number }> = {
  id: "pov_survives",
  title: "Survival",
  categories: ["battle-royale", "fps"],
  steerability: 0.45,
  steerabilityReason: "Opponents decide this as much as the player; dying on purpose costs the game.",
  safety: "game",
  requires: ["pov"],
  windowSeconds: 75,
  eligible: (s) => s.mode === "gameplay" && s.povAlive === true,
  params: () => ({ seconds: 60 }),
  question: (p) => `Streamer survives the next ${p.seconds}s?`,
  rule: (p) => `YES if the player we're watching is still alive at window end (${p.seconds}s). NO if they're eliminated first.`,
  evaluate(_p, _start, during, ended) {
    if (during.some((r) => r.state.povAlive === false)) return "NO";
    return ended ? "YES" : "PENDING";
  },
};

// Refused by design: one person decides these at no cost, or they're about a person rather than a game.
const saysWord: VisionTemplate = {
  id: "says_word",
  title: "Says a word",
  categories: ["irl", "other"],
  steerability: 1,
  steerabilityReason: "The streamer decides what they say.",
  safety: "game",
  requires: [],
  windowSeconds: 60,
  eligible: (s) => s.mode === "camera",
  params: () => ({}),
  question: () => `Streamer says "chat" in the next minute?`,
  rule: () => "Not listable.",
  evaluate: () => "PENDING",
};

const endsStream: VisionTemplate = {
  id: "ends_stream",
  title: "Stream ends",
  categories: ["irl", "other", "fps", "battle-royale", "moba", "sports"],
  steerability: 1,
  steerabilityReason: "Only the streamer decides when the stream ends.",
  safety: "behaviour",
  requires: [],
  windowSeconds: 600,
  eligible: () => true,
  params: () => ({}),
  question: () => `Stream ends in the next 10 minutes?`,
  rule: () => "Not listable.",
  evaluate: () => "PENDING",
};

export const VISION_TEMPLATES: VisionTemplate<any>[] = [scoreChange, teamScoresNext, roundEnds, clutch, bombPlant, fieldShrinks, povSurvives, saysWord, endsStream];
export const visionTemplateById = (id: string) => VISION_TEMPLATES.find((t) => t.id === id);

const FIELD_OK: Record<VisionField, (s: SceneState) => boolean> = {
  score: scored,
  phase: (s) => has(s.phase),
  alive: (s) => has(s.aliveA) && has(s.aliveB),
  remaining: (s) => has(s.remaining),
  bomb: (s) => has(s.bomb),
  pov: (s) => has(s.povAlive),
  clock: (s) => has(s.clock),
};

/** A template is resolvable only if both readers currently see every field it needs, confidently. */
export function readable(t: VisionTemplate, a: SceneState, b?: SceneState) {
  const ok = (s: SceneState) => s.confidence >= 0.6 && t.requires.every((f) => FIELD_OK[f](s));
  return ok(a) && (!b || ok(b));
}

export const PERCEPTION_SCHEMA = `{
  "scene": string,            // the game or broadcast on screen, e.g. "Counter-Strike 2", "Fortnite", "football broadcast", "streamer on camera"
  "mode": "gameplay" | "menu" | "replay" | "break" | "camera" | "other",
  "teamA": string | null, "teamB": string | null,   // names/abbreviations as shown on the scoreboard, left team = A
  "scoreA": number | null, "scoreB": number | null, // scoreboard numbers (rounds, goals, kills…); null if not clearly visible
  "phase": string | null,     // shooters: "buy" | "live" | "post"; sports: "live" | "stoppage"; else null
  "aliveA": number | null, "aliveB": number | null, // players alive per team if the HUD shows it
  "remaining": number | null, // battle royale: players/teams remaining counter
  "clock": number | null,     // in-game clock in seconds if visible
  "bomb": string | null,      // Counter-Strike/VALORANT: "planted" | "none" | "defused" | "exploded"
  "povAlive": boolean | null, // is the player whose view we see alive (not spectating, not dead screen)?
  "summary": string,          // one short factual sentence
  "confidence": number        // 0..1, how sure you are of the numbers
}`;
