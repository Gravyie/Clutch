import { readFileSync } from "node:fs";
import { OpenAIVision } from "../video/perceive";
const r = new OpenAIVision("local", "http://127.0.0.1:8090/v1", "x", "qwen");
const jpeg = readFileSync(process.argv[2]);
for (let i = 0; i < 2; i++) {
  const out = await r.read(jpeg, "fps", "Counter-Strike");
  console.log(out.ms + "ms", JSON.stringify(out.state));
}
