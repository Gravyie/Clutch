import OpenAI from "openai";
import { config } from "../config";
import { log } from "../log";
import { kvGet, kvSet } from "../db";
import type { AgentState } from "@clutch/shared";

/**
 * Inference on 0G Compute through the Router (OpenAI-compatible), with a hard daily spend cap.
 *
 * Budget-aware by design: the agent pays for its own inference and earns the resolver fee on every settled
 * market. Over 80% of the cap it slows down (fewer, higher-interest moments); at the cap it stops opening
 * markets. Resolution never needs inference, so settlement keeps working with zero budget.
 */
export class ZeroG {
  private client?: OpenAI;
  private price = { prompt: 0, completion: 0 };
  private day = new Date().toISOString().slice(0, 10);
  requestsToday = 0;
  spentTodayUsd = 0;
  lastRequestId?: string;

  /** @param apiKey defaults to the platform key; a viewer's own key makes their account pay for the call. */
  constructor(readonly apiKey: string | undefined = config.zgApiKey, readonly payer: "platform" | "viewer" = "platform") {
    if (apiKey) this.client = new OpenAI({ baseURL: config.zgRouterUrl, apiKey, timeout: 45_000, maxRetries: 0 });
    void this.loadPricing();
    if (payer === "platform") void this.restore();
  }

  /** The platform budget survives restarts, so a crash loop can't reset the daily cap. */
  private async restore() {
    const saved = JSON.parse((await kvGet("zg:budget").catch(() => undefined)) ?? "null") as { day: string; requests: number; spent: number; last?: string } | null;
    if (saved?.day !== this.day) return;
    this.requestsToday += saved.requests;
    this.spentTodayUsd += saved.spent;
    this.lastRequestId ??= saved.last;
  }

  private persist() {
    if (this.payer !== "platform") return;
    void kvSet("zg:budget", JSON.stringify({ day: this.day, requests: this.requestsToday, spent: this.spentTodayUsd, last: this.lastRequestId })).catch(() => {});
  }

  get provider(): AgentState["provider"] {
    return this.client ? "0g" : "heuristic";
  }

  get mode(): AgentState["mode"] {
    this.rollDay();
    if (!this.client) return "full";
    if (this.spentTodayUsd >= config.zgDailyCapUsd) return "paused";
    if (this.spentTodayUsd >= config.zgDailyCapUsd * 0.8) return "degraded";
    return "full";
  }

  private rollDay() {
    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.day) {
      this.day = today;
      this.requestsToday = 0;
      this.spentTodayUsd = 0;
    }
  }

  private static pricing?: Promise<Record<string, { prompt: number; completion: number }>>;

  private async loadPricing() {
    ZeroG.pricing ??= fetch(`${config.zgRouterUrl}/models`)
      .then((r) => r.json())
      .then(({ data }: any) => Object.fromEntries(data.filter((m: any) => m.pricing_usd).map((m: any) => [m.id, { prompt: Number(m.pricing_usd.prompt), completion: Number(m.pricing_usd.completion) }])))
      .catch(() => ({}));
    const p = (await ZeroG.pricing)[config.zgModel];
    if (p) this.price = p;
    else log.warn(`0G model ${config.zgModel} not in router catalog`);
  }

  /** Book an inference made elsewhere (e.g. a vision read) against the daily budget, priced from token usage. */
  record(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, requestId?: string) {
    this.rollDay();
    this.requestsToday++;
    this.spentTodayUsd += (usage?.prompt_tokens ?? 0) * this.price.prompt + (usage?.completion_tokens ?? 0) * this.price.completion;
    if (requestId) this.lastRequestId = requestId;
    this.persist();
  }

  /** One JSON-mode completion. Returns the parsed object plus the 0G request id for receipts. */
  async json<T>(system: string, user: string, maxTokens = 1500): Promise<{ data: T; requestId: string; latencyMs: number; costUsd: number }> {
    if (!this.client) throw new Error("0G not configured");
    if (this.mode === "paused") throw new Error("daily inference budget spent");
    const t0 = Date.now();
    const { data: completion, response } = await this.client.chat.completions
      .create({
        model: config.zgModel,
        max_tokens: maxTokens,
        temperature: 0.2,
        reasoning_effort: "low" as any,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      })
      .withResponse();
    const requestId = response.headers.get("x-request-id") ?? response.headers.get("zg-res-key") ?? completion.id;
    const u = completion.usage;
    const costUsd = (u?.prompt_tokens ?? 0) * this.price.prompt + (u?.completion_tokens ?? 0) * this.price.completion;
    this.requestsToday++;
    this.spentTodayUsd += costUsd;
    this.lastRequestId = requestId;
    this.persist();
    const text = completion.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T;
    return { data, requestId, latencyMs: Date.now() - t0, costUsd };
  }
}
