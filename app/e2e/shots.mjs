// Screenshots of pages in a real browser (rAF-driven animations run). Usage: node e2e/shots.mjs outDir path[:name] ...
import { chromium } from "playwright-core";
const [out, ...paths] = process.argv.slice(2);
const APP = process.env.APP_URL ?? "http://localhost:3000";
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const mobile = process.env.MOBILE === "1";
const ctx = await b.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true } : { viewport: { width: 1512, height: 982 } });
for (const p of paths) {
  const [path, name] = p.split(":");
  const page = await ctx.newPage();
  await page.goto(APP + path, { waitUntil: "domcontentloaded", timeout: 180_000 });
  await page.waitForTimeout(Number(process.env.WAIT ?? 7000));
  await page.screenshot({ path: `${out}/${name ?? path.replace(/\W+/g, "_")}.png` });
  await page.close();
}
await b.close();
