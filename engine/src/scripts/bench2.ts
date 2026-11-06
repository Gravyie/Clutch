import { readFileSync } from "node:fs";
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "https://router-api.0g.ai/v1", apiKey: process.env.ZG_API_KEY!, timeout: 90_000 });
const img = readFileSync(process.argv[2]).toString("base64");
const prompt = `Read only these values from this live-stream frame. Use null if a value is not clearly visible.
- team_a_score: left team's round score on the top scoreboard
- team_b_score: right team's round score on the top scoreboard
- clock_seconds: round clock, in seconds
Reply with one line of JSON, e.g. {"team_a_score":0,"team_b_score":0,"clock_seconds":0,"mode":"gameplay"}`;
for (const model of (process.argv[3] ?? "0gm-1.0-35b-a3b,claude-haiku-5.5").split(",")) {
  for (const extra of [{}, { reasoning_effort: "low" }, { reasoning_effort: "none" }]) {
    const t0 = Date.now();
    try {
      const r = await client.chat.completions.create({ model, max_tokens: 800, temperature: 0, ...(extra as any), messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } }, { type: "text", text: prompt }] }] });
      console.log(model, JSON.stringify(extra), `${Date.now() - t0}ms out=${r.usage?.completion_tokens}`, (r.choices[0]?.message?.content ?? "").replace(/\s+/g, " ").slice(0, 140));
    } catch (e: any) {
      console.log(model, JSON.stringify(extra), "ERROR", e.message.slice(0, 120));
    }
  }
}
