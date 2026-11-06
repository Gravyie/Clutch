import { log } from "../log";
import OpenAI from "openai";
import sharp from "sharp";
import type { Category, SceneState } from "@clutch/shared";
import { config } from "../config";
import type { ZeroG } from "../ai/zeroG";

/**
 * Vision readers. Each turns one frame into a SceneState in two passes:
 *  1. HUD pass: the category's scoreboard region, cropped and upscaled, read for teams, score, clock, round, bomb.
 *  2. Scene pass: the whole frame, downscaled, read for mode (gameplay/replay/menu…), survival, players left, summary.
 * Values are sanity-bounded afterwards, so e.g. a health bar can never be read as "players alive".
 *
 * Two readers settle every market, both on 0G and from different model families:
 *  - Reader A, continuous: discovers the scene and every HUD counter (ZG_VISION_MODEL).
 *  - Reader B, checkpoints: reads only the market's counters on frames grabbed over its own connection
 *    (ZG_VERIFY_MODELS, with fallbacks when a provider is down).
 * Without a 0G key no video market opens: there is no fallback that guesses.
 */
export interface VisionReader {
  name: string;
  read(jpeg: Buffer, category: Category, hint?: string): Promise<{ state: SceneState; requestId?: string; costUsd?: number; ms: number }>;
  /** One pass over the whole frame: mode, survival, and every counter the HUD shows. */
  discover(jpeg: Buffer, hint?: string): Promise<{ state: SceneState; requestId?: string; ms: number }>;
  /** Read only the named counters (fast). Values are null when not clearly visible. */
  readKeys(jpeg: Buffer, keys: { key: string; label: string }[]): Promise<{ mode: SceneState["mode"]; values: Record<string, number | null>; requestId?: string; ms: number }>;
}

const DISCOVER_PROMPT = `Read this live-stream frame. Return one JSON object only, no prose:
{"mode":"gameplay|menu|replay|break|camera|other","game":string,"povAlive":true|false|null,
 "counters":[{"key":"snake_case_id","label":"Short label","value":number}],
 "teams":[string,string]|null,"summary":"one short factual sentence","confidence":0..1}
counters: every number shown on the HUD or scoreboard that can change during play (team scores, round, kills/eliminations, players or teams left, health, shield, gold, goals…), max 10. Use the team or player name in the label when shown (e.g. "TYLOO score", "Clix eliminations"). Keep keys stable: lowercase words joined by underscores, team/player name first. Convert clocks to seconds with key ending in _clock. Only include values you can clearly read.
Battle royale HUDs (Fortnite, Apex, Warzone, PUBG): the players-left/alive counter and the player's eliminations are usually near the top-right minimap; always include them when visible (keys players_left, eliminations).
mode "replay" for instant replays/killcams, "menu" for lobbies/loading/end screens, "camera" for a person talking with no game.`;

const DISCOVER_SCHEMA = {
  type: "object",
  properties: {
    mode: { enum: ["gameplay", "menu", "replay", "break", "camera", "other"] },
    game: { type: "string" },
    povAlive: { type: ["boolean", "null"] },
    counters: { type: "array", items: { type: "object", properties: { key: { type: "string" }, label: { type: "string" }, value: { type: "number" } }, required: ["key", "label", "value"] } },
    teams: { type: ["array", "null"], items: { type: "string" } },
    summary: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["mode", "game", "povAlive", "counters", "teams", "summary", "confidence"],
};

const slug = (k: string) => k.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 40);

/** Where each category's scoreboard usually lives, as fractions of the frame: [left, top, width, height]. */
const HUD: Record<Category, [number, number, number, number] | null> = {
  fps: [0.28, 0, 0.44, 0.15],
  moba: [0.3, 0, 0.4, 0.1],
  sports: [0, 0, 0.42, 0.16],
  "battle-royale": [0.7, 0, 0.3, 0.42], // minimap column: Fortnite/Apex/Warzone show players left beside or under it
  irl: null,
  other: [0.25, 0, 0.5, 0.15],
};

const HUD_PROMPT: Record<Category, string> = {
  fps: "This is the scoreboard of a shooter broadcast. Read the two team names or tags (left = A, right = B), each team's round score, the round clock in seconds, the round number, and whether a bomb/spike icon shows planted.",
  moba: "This is the top bar of a MOBA. Read each team's kill score (left = A, right = B) and the game clock in seconds.",
  sports: "This is a sports score bug. Read the two team abbreviations (first/left = A), their scores, and the match clock in seconds.",
  "battle-royale": "This is the top-right of a battle royale HUD (minimap area). Read the players (or teams) remaining counter, usually a number next to a person icon. Set legible true if that counter is readable.",
  irl: "",
  other: "Read any scoreboard: team names, scores and clock.",
};

const SCENE_PROMPT = `Classify this live-stream frame.
mode: "gameplay" (live play), "replay" (instant replay / slow motion / killcam), "menu" (lobby, loading, scoreboard screen), "break" (break/intermission/ads/starting soon), "camera" (a person talking to camera, no game), or "other".
povAlive: true if we see the player's own live first/third-person view, false if a death/spectating/eliminated screen, null if not a player's view.
remaining: players-or-teams-remaining number if a battle royale counter is visible, else null.
summary: one short factual sentence about what is happening.
confidence: 0..1 how sure you are.`;

const int = { type: ["integer", "null"] };
const str = { type: ["string", "null"] };
const HUD_SCHEMA = {
  type: "object",
  properties: { teamA: str, teamB: str, scoreA: int, scoreB: int, clock: int, round: int, bomb: { enum: ["planted", "none", null] }, remaining: int, legible: { type: "boolean" } },
  required: ["teamA", "teamB", "scoreA", "scoreB", "clock", "round", "bomb", "remaining", "legible"],
};
const SCENE_SCHEMA = {
  type: "object",
  properties: {
    scene: { type: "string" },
    mode: { enum: ["gameplay", "menu", "replay", "break", "camera", "other"] },
    povAlive: { type: ["boolean", "null"] },
    remaining: int,
    summary: { type: "string" },
    confidence: { type: "number" },
  },
  required: ["scene", "mode", "povAlive", "remaining", "summary", "confidence"],
};

function parseJson(text: string) {
  let s = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  // Models without constrained decoding sometimes write clocks as 1:17; turn bare mm:ss into seconds.
  s = s.replace(/:\s*"?(\d{1,2}):(\d{2})"?(\s*[,}\]])/g, (_m, mm, ss, end) => `: ${Number(mm) * 60 + Number(ss)}${end}`);
  try {
    return JSON.parse(s);
  } catch {
    // Common slips: trailing commas, comments, single quotes.
    return JSON.parse(s.replace(/\/\/[^\n]*/g, "").replace(/,\s*([}\]])/g, "$1").replace(/'/g, '"'));
  }
}

const num = (v: any, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null);
const text = (v: any) => (typeof v === "string" && v.trim().length > 1 && !/^(null|none|n\/a|unknown|team ?[ab12])$/i.test(v.trim()) ? v.trim().slice(0, 24) : null);

/** A vision model behind the 0G Router (OpenAI-compatible). */
export class OpenAIVision implements VisionReader {
  private client: OpenAI;
  /** fallbacks, in order; the reader moves to the next one when a provider is down and retries the primary later */
  private readonly models: string[];
  private current = 0;
  private retryPrimaryAt = 0;
  get name() {
    return `${this.prefix}:${this.models[this.current]}`;
  }
  private get model() {
    return this.models[this.current];
  }
  constructor(
    private readonly prefix: string,
    baseURL: string,
    apiKey: string,
    model: string | string[],
    private readonly onCost?: (usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, requestId?: string) => void,
    private readonly constrained = true,
    private readonly reasoning: "none" | "low" = "low",
  ) {
    this.client = new OpenAI({ baseURL, apiKey, timeout: 60_000, maxRetries: 1 });
    this.models = Array.isArray(model) ? model : [model];
  }

  async discover(jpeg: Buffer, hint?: string) {
    this.gate?.();
    const t0 = Date.now();
    const img = await sharp(jpeg).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const { json: j, requestId } = await this.ask(img, `${DISCOVER_PROMPT}${hint ? `\nThe stream's category is "${hint}".` : ""}`, DISCOVER_SCHEMA);
    const seen = new Set<string>();
    const counters = (Array.isArray(j.counters) ? j.counters : [])
      .map((c: any) => ({ key: slug(String(c?.key ?? c?.label ?? "")), label: String(c?.label ?? c?.key ?? "").trim().slice(0, 32), value: Number(c?.value) }))
      .filter((c: any) => c.key && c.label && Number.isFinite(c.value) && c.value >= 0 && c.value < 100000 && !seen.has(c.key) && seen.add(c.key))
      .slice(0, 10);
    const mode = ["gameplay", "menu", "replay", "break", "camera", "other"].includes(j.mode) ? j.mode : "other";
    const teams = Array.isArray(j.teams) && j.teams.length === 2 ? j.teams.map((t: any) => text(t)) : [null, null];
    const state: SceneState = {
      scene: text(j.game) ?? hint ?? "unknown",
      game: text(j.game) ?? undefined,
      mode,
      teamA: teams[0],
      teamB: teams[1],
      scoreA: null,
      scoreB: null,
      phase: null,
      aliveA: null,
      aliveB: null,
      remaining: null,
      clock: null,
      bomb: null,
      povAlive: typeof j.povAlive === "boolean" ? j.povAlive : null,
      summary: typeof j.summary === "string" ? j.summary.slice(0, 160) : "",
      confidence: Math.max(0, Math.min(1, Number(j.confidence ?? 0.7) || 0)),
      counters,
    };
    return { state, requestId, ms: Date.now() - t0 };
  }

  async readKeys(jpeg: Buffer, keys: { key: string; label: string }[]) {
    this.gate?.();
    const t0 = Date.now();
    const img = await sharp(jpeg).resize({ width: 1024, withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    const props: Record<string, object> = { mode: { enum: ["gameplay", "menu", "replay", "break", "camera", "other"] } };
    for (const k of keys) props[k.key] = { type: ["number", "null"] };
    const prompt = `Read only these values from this live-stream frame. Use null if a value is not clearly visible.\n${keys.map((k) => `- ${k.key}: ${k.label}`).join("\n")}\n- mode: gameplay, menu, replay, break, camera or other\nReply with one line of JSON with exactly these keys.`;
    const { json: j, requestId } = await this.ask(img, prompt, { type: "object", properties: props, required: Object.keys(props) });
    const values: Record<string, number | null> = {};
    for (const k of keys) {
      const x = Number(j[k.key]);
      values[k.key] = j[k.key] === null || j[k.key] === undefined || !Number.isFinite(x) ? null : x;
    }
    const mode = ["gameplay", "menu", "replay", "break", "camera", "other"].includes(j.mode) ? j.mode : "other";
    return { mode, values, requestId, ms: Date.now() - t0 };
  }

  private async ask(img: Buffer, prompt: string, schema: object) {
    if (this.current > 0 && Date.now() > this.retryPrimaryAt) this.current = 0;
    for (;;) {
      try {
        return await this.askOnce(img, prompt, schema);
      } catch (e: any) {
        // A provider outage (5xx, connection reset) moves to the next model; anything else is a real error.
        const outage = (e.status ?? 0) >= 500 || /EOF|ECONNRESET|Connection error|timed out/i.test(e.message ?? "");
        if (!outage || this.current >= this.models.length - 1) throw e;
        log.warn(`${this.name} unavailable (${String(e.message).slice(0, 60)}); falling back to ${this.models[this.current + 1]}`);
        this.current++;
        this.retryPrimaryAt = Date.now() + 5 * 60_000;
      }
    }
  }

  private async askOnce(img: Buffer, prompt: string, schema: object) {
    const { data, response } = await this.client.chat.completions
      .create({
        model: this.model,
        temperature: 0,
        // 0G's Claude models think adaptively by default; keep it brief and leave room for the answer.
        max_tokens: this.constrained ? 300 : 1500,
        ...(this.constrained ? {} : { reasoning_effort: this.reasoning as any }),
        // Constrained decoding where supported (llama.cpp). 0G's Claude models reject JSON mode, so for them the
        // prompt asks for JSON only and the parser extracts it.
        ...(this.constrained ? { response_format: { type: "json_schema", json_schema: { name: "read", schema } } as any } : {}),
        messages: [
          { role: "system", content: "You read live-stream frames into strict JSON. Report only what is clearly visible; use null when unsure. Never guess numbers. Reply with JSON only." },
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${img.toString("base64")}` } },
              { type: "text", text: `${prompt}\nJSON keys: ${Object.keys((schema as any).properties).join(", ")}.` },
            ],
          },
        ],
      })
      .withResponse();
    const requestId = response.headers.get("x-request-id") ?? data.id;
    this.onCost?.(data.usage ?? undefined, requestId);
    return { json: parseJson(data.choices[0]?.message?.content ?? "{}"), requestId };
  }

  /** Optional guard, e.g. the daily 0G budget; throws to skip a read. */
  gate?: () => void;

  async read(jpeg: Buffer, category: Category, hint?: string) {
    this.gate?.();
    const t0 = Date.now();
    const img = sharp(jpeg);
    const meta = await img.metadata();
    const W = meta.width ?? 896;
    const H = meta.height ?? 504;
    const scene = await this.ask(await sharp(jpeg).resize({ width: 640 }).jpeg({ quality: 80 }).toBuffer(), `${SCENE_PROMPT}${hint ? `\nThe stream's category is "${hint}".` : ""}`, SCENE_SCHEMA);
    const s = scene.json;
    let hud: any = {};
    const box = HUD[category];
    if (box && s.mode !== "camera") {
      const [l, t, w, h] = box;
      const crop = await sharp(jpeg)
        .extract({ left: Math.round(l * W), top: Math.round(t * H), width: Math.round(w * W), height: Math.round(h * H) })
        .resize({ width: Math.round(w * W * 2) })
        .jpeg({ quality: 90 })
        .toBuffer();
      hud = (await this.ask(crop, HUD_PROMPT[category], HUD_SCHEMA)).json;
    }
    const legible = hud.legible !== false;
    const state: SceneState = {
      scene: text(s.scene) ?? hint ?? "unknown",
      mode: ["gameplay", "menu", "replay", "break", "camera", "other"].includes(s.mode) ? s.mode : "other",
      teamA: legible ? text(hud.teamA) : null,
      teamB: legible ? text(hud.teamB) : null,
      scoreA: legible ? num(hud.scoreA, 400) : null,
      scoreB: legible ? num(hud.scoreB, 400) : null,
      // Live round phase is inferred from a running clock; "post" is detected by the score changing.
      phase: legible && num(hud.clock, 7200) !== null ? "live" : null,
      aliveA: null,
      aliveB: null,
      remaining: category === "battle-royale" ? num(hud.remaining ?? s.remaining, 200) : null,
      clock: legible ? num(hud.clock, 7200) : null,
      bomb: category === "fps" && legible ? (hud.bomb === "planted" ? "planted" : hud.bomb === "none" ? "none" : null) : null,
      povAlive: typeof s.povAlive === "boolean" ? s.povAlive : null,
      summary: typeof s.summary === "string" ? s.summary.slice(0, 160) : "",
      // Confidence is about the scene read. An unreadable scoreboard nulls the scoreboard fields above instead of
      // discounting what was read reliably (mode, whether the player is alive).
      confidence: Math.max(0, Math.min(1, Number(s.confidence ?? 0.5) || 0)),
    };
    return { state, requestId: scene.requestId, ms: Date.now() - t0 };
  }
}

export function makeReaders(zg: ZeroG): { a: VisionReader; b: VisionReader; independent: string } | undefined {
  if (!config.zgApiKey) return undefined;
  const gate = () => {
    if (zg.mode === "paused") throw new Error("daily 0G budget spent; markets pause until 00:00 UTC");
  };
  const a = new OpenAIVision("0g", config.zgRouterUrl, config.zgApiKey, config.zgVisionModel, (usage, id) => zg.record(usage, id), false, "none");
  const b = new OpenAIVision("0g", config.zgRouterUrl, config.zgApiKey, config.zgVerifyModels, (usage, id) => zg.record(usage, id), false, "none");
  a.gate = gate;
  b.gate = gate;
  return { a, b, independent: `two model families on 0G (${config.zgVisionModel} and ${config.zgVerifyModels.join(" / ")}), different frames, different connections` };
}
