// Benchmark 0G vision models on a frame with a known answer. Usage: tsx --env-file=.env src/scripts/bench.ts frame.jpg
import { readFileSync } from "node:fs";
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "https://router-api.0g.ai/v1", apiKey: process.env.ZG_API_KEY!, timeout: 90_000 });
const img = readFileSync(process.argv[2]).toString("base64");
const prompt = `Read this live-stream frame. Return JSON only:
{"mode":"gameplay|menu|replay|break|camera|other","game":string,"povAlive":bool|null,
 "counters":[{"key":"snake_case id","label":"short label","value":number}],  // every number on the HUD/scoreboard that could change during play: scores, round, clock_seconds, kills, players_left, health, shield, gold…
 "teams":[string,string]|null, "summary":string}`;
const models = (process.argv[3] ?? "claude-haiku-5.5,0gm-1.0-35b-a3b,deepseek-v4-flash-vision-exp").split(",");
await Promise.all(
  models.map(async (model) => {
    const t0 = Date.now();
    try {
      const r = await client.chat.completions.create({
        model,
        max_tokens: 1500,
        temperature: 0,
        ...(model.startsWith("claude") ? { reasoning_effort: "low" as any } : {}),
        messages: [{ role: "user", content: [{ type: "image_url", image_url: { url: `data:image/jpeg;base64,${img}` } }, { type: "text", text: prompt }] }],
      });
      const txt = r.choices[0]?.message?.content ?? "";
      console.log(`\n## ${model} ${Date.now() - t0}ms in=${r.usage?.prompt_tokens} out=${r.usage?.completion_tokens}\n${txt.replace(/```json|```/g, "").trim().slice(0, 700)}`);
    } catch (e: any) {
      console.log(`\n## ${model} ERROR ${e.message.slice(0, 200)}`);
    }
  }),
);
