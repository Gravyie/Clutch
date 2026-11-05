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
 * Two readers settle every market:
 *  - Reader A, continuous: a 0G vision model when ZG_API_KEY is set, otherwise the local open-weights model.
 *  - Reader B, checkpoints: the local open-weights model (llama.cpp) on frames grabbed over its own connection.
 */
export interface VisionReader {
  name: string;
  read(jpeg: Buffer, category: Category, hint?: string): Promise<{ state: SceneState; requestId?: string; costUsd?: number; ms: number }>;
}

/** Where each category's scoreboard usually lives, as fractions of the frame: [left, top, width, height]. */
const HUD: Record<Category, [number, number, number, number] | null> = {
  fps: [0.28, 0, 0.44, 0.15],
  moba: [0.3, 0, 0.4, 0.1],
  sports: [0, 0, 0.42, 0.16],
  "battle-royale": [0.62, 0, 0.38, 0.22],
  irl: null,
  other: [0.25, 0, 0.5, 0.15],
};

const HUD_PROMPT: Record<Category, string> = {
  fps: "This is the scoreboard of a shooter broadcast. Read the two team names or tags (left = A, right = B), each team's round score, the round clock in seconds, the round number, and whether a bomb/spike icon shows planted.",
  moba: "This is the top bar of a MOBA. Read each team's kill score (left = A, right = B) and the game clock in seconds.",
  sports: "This is a sports score bug. Read the two team abbreviations (first/left = A), their scores, and the match clock in seconds.",
  "battle-royale": "This is the top-right of a battle royale HUD. Read the players (or teams) remaining counter.",
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
  s = s.replace(/:\s*"?(\d{1,2}):(\d{2})"?(\s*[,}])/g, (_m, mm, ss, end) => `: ${Number(mm) * 60 + Number(ss)}${end}`);
  return JSON.parse(s);
}

const num = (v: any, max: number) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= max ? Math.round(v) : null);
const text = (v: any) => (typeof v === "string" && v.trim().length > 1 && !/^(null|none|n\/a|unknown|team ?[ab12])$/i.test(v.trim()) ? v.trim().slice(0, 24) : null);

/** Any OpenAI-compatible vision endpoint (0G Router, llama.cpp's llama-server). */
export class OpenAIVision implements VisionReader {
  private client: OpenAI;
  constructor(
    readonly name: string,
    baseURL: string,
    apiKey: string,
    private readonly model: string,
    private readonly onCost?: (usd: number, requestId?: string) => void,
    private readonly constrained = true,
  ) {
    this.client = new OpenAI({ baseURL, apiKey, timeout: 60_000, maxRetries: 1 });
  }

  private async ask(img: Buffer, prompt: string, schema: object) {
    const { data, response } = await this.client.chat.completions
      .create({
        model: this.model,
        temperature: 0,
        max_tokens: 300,
        response_format: (this.constrained ? { type: "json_schema", json_schema: { name: "read", schema } } : { type: "json_object" }) as any,
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
    this.onCost?.(0, requestId);
    return { json: parseJson(data.choices[0]?.message?.content ?? "{}"), requestId };
  }

  async read(jpeg: Buffer, category: Category, hint?: string) {
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
      confidence: Math.max(0, Math.min(1, Number(s.confidence ?? 0.5) || 0)) * (legible ? 1 : 0.5),
    };
    return { state, requestId: scene.requestId, ms: Date.now() - t0 };
  }
}

export function makeReaders(zg: ZeroG): { a: VisionReader; b: VisionReader; independent: string } {
  const local = (suffix = "") => new OpenAIVision(`local:${config.localVisionModel}${suffix}`, config.localVisionUrl, "local", config.localVisionModel);
  if (config.zgApiKey) {
    const zero = new OpenAIVision(`0g:${config.zgVisionModel}`, config.zgRouterUrl, config.zgApiKey, config.zgVisionModel, (usd, id) => zg.record(usd, id), false);
    return { a: zero, b: local(), independent: "different model families, different frames, different connections" };
  }
  return { a: local(), b: local("#b"), independent: "same open-weights model on different frames over a separate connection (add a 0G key for a second model family)" };
}
