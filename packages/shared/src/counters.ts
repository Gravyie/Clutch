/**
 * Counter markets: the general grammar for any stream with numbers on screen.
 *
 * Reader A lists every counter the HUD shows (scores, kills, players left, health, gold…). The agent picks one a real
 * opponent or chance controls, and a kind:
 *   goes_up      "Does {label} go up in the next {S}s?"          (kills, score, round)
 *   reaches      "{label} reaches {threshold} within {S}s?"
 *   drops_below  "{label} drops below {threshold} in {S}s?"       (players left, health)
 *   race         "{label} moves before {label2}?"                 (team A scores before team B)
 * The agent may phrase the question naturally, but settlement uses only this structured rule, evaluated by two
 * independent readers on their own frames. Disagreement or a missing reading voids the market.
 */

export interface Counter {
  key: string;
  label: string;
  value: number;
}

export type CounterKind = "goes_up" | "reaches" | "drops_below" | "race";

export interface CounterSpec {
  kind: CounterKind;
  key: string;
  label: string;
  key2?: string;
  label2?: string;
  threshold?: number;
  seconds: number;
}

export interface CounterReading {
  at: number;
  values: Record<string, number | null>;
}

/** Counters nobody should trade on: clocks only move one way; ammo/money are the player's own choice. */
const UNTRADEABLE = /(clock|time|timer|second|minute|ammo|bullet|mag|money|cash|credits?|gold_spent|fps|ping|viewers?|followers?|subs?|donation|bits)/i;

export function tradeable(key: string, label: string) {
  return !UNTRADEABLE.test(key) && !UNTRADEABLE.test(label);
}

export function counterRule(s: CounterSpec): string {
  switch (s.kind) {
    case "goes_up":
      return `YES if "${s.label}" on screen is higher than its value at window start at any reading within ${s.seconds}s. NO otherwise.`;
    case "reaches":
      return `YES if "${s.label}" on screen reaches ${s.threshold} or more within ${s.seconds}s of window start. NO otherwise.`;
    case "drops_below":
      return `YES if "${s.label}" on screen falls below ${s.threshold} within ${s.seconds}s of window start. NO otherwise.`;
    case "race":
      return `YES if "${s.label}" increases before "${s.label2}" does, within ${s.seconds}s of window start. NO if "${s.label2}" increases first or neither changes.`;
  }
}

export function defaultQuestion(s: CounterSpec): string {
  switch (s.kind) {
    case "goes_up":
      return `${s.label} goes up in the next ${s.seconds}s?`;
    case "reaches":
      return `${s.label} hits ${s.threshold} in ${s.seconds}s?`;
    case "drops_below":
      return `${s.label} drops below ${s.threshold} in ${s.seconds}s?`;
    case "race":
      return `${s.label} before ${s.label2}?`;
  }
}

const v = (r: CounterReading | undefined, k?: string) => (r && k ? r.values[k] ?? null : null);

/**
 * Evaluate one reader's view. `start` is its reading at (or just before) window start; `during` are its readings
 * inside the window, oldest first.
 */
export function evaluateCounter(s: CounterSpec, start: CounterReading | undefined, during: CounterReading[], ended: boolean): "YES" | "NO" | "PENDING" {
  const s0 = v(start, s.key);
  if (s0 === null) return ended ? "NO" : "PENDING";
  for (const r of during) {
    const x = v(r, s.key);
    if (s.kind === "race") {
      const b0 = v(start, s.key2);
      const y = v(r, s.key2);
      const aUp = x !== null && x > s0;
      const bUp = b0 !== null && y !== null && y > b0;
      if (aUp && !bUp) return "YES";
      if (bUp && !aUp) return "NO";
      if (aUp && bUp) return "NO"; // simultaneous at our sampling resolution: not "before"
      continue;
    }
    if (x === null) continue;
    if (s.kind === "goes_up" && x > s0) return "YES";
    if (s.kind === "reaches" && x >= (s.threshold ?? Infinity)) return "YES";
    if (s.kind === "drops_below" && x < (s.threshold ?? -Infinity)) return "YES";
  }
  return ended ? "NO" : "PENDING";
}
