import OpenAI from "openai";
import { config } from "../config";
import { log } from "../log";
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

  constructor() {
    if (config.zgApiKey) this.client = new OpenAI({ baseURL: config.zgRouterUrl, apiKey: config.zgApiKey });
    void this.loadPricing();
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

  private async loadPricing() {
    try {
      const res = await fetch(`${config.zgRouterUrl}/models`);
      const { data } = (await res.json()) as { data: { id: string; pricing_usd?: { prompt: string; completion: string } }[] };
      const m = data.find((x) => x.id === config.zgModel);
      if (m?.pricing_usd) this.price = { prompt: Number(m.pricing_usd.prompt), completion: Number(m.pricing_usd.completion) };
      else log.warn(`0G model ${config.zgModel} not in router catalog`);
    } catch (e: any) {
      log.warn("0G pricing unavailable", e.message);
    }
  }

  /** Book an inference made elsewhere (e.g. a vision read) against the daily budget, priced from token usage. */
  record(usage: { prompt_tokens?: number; completion_tokens?: number } | undefined, requestId?: string) {
    this.rollDay();
    this.requestsToday++;
    this.spentTodayUsd += (usage?.prompt_tokens ?? 0) * this.price.prompt + (usage?.completion_tokens ?? 0) * this.price.completion;
    if (requestId) this.lastRequestId = requestId;
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
    const text = completion.choices[0]?.message?.content ?? "{}";
    const data = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1)) as T;
    return { data, requestId, latencyMs: Date.now() - t0, costUsd };
  }
}
