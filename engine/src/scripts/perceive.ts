// Read one frame with the local model and (if ZG_API_KEY is set) with 0G. Usage: tsx --env-file=.env src/scripts/perceive.ts frame.jpg [category]
import { readFileSync } from "node:fs";
import { OpenAIVision } from "../video/perceive";
const jpeg = readFileSync(process.argv[2]);
const cat = (process.argv[3] ?? "fps") as any;
const readers = [new OpenAIVision("local", "http://127.0.0.1:8090/v1", "x", "qwen")];
if (process.env.ZG_API_KEY) readers.unshift(new OpenAIVision("0g", "https://router-api.0g.ai/v1", process.env.ZG_API_KEY, process.env.ZG_VISION_MODEL ?? "claude-haiku-5.5", undefined, false));
for (const r of readers) {
  try {
    const out = await r.read(jpeg, cat, "Counter-Strike");
    console.log(`${r.name} ${out.ms}ms req=${out.requestId}`, JSON.stringify(out.state));
  } catch (e: any) {
    console.log(r.name, "ERROR", e.message);
  }
}
