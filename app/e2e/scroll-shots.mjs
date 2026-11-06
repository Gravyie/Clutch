// Scroll through a page like a visitor and capture each screen, so scroll-triggered animation is visible.
// Usage: node e2e/scroll-shots.mjs outDir path [WxH]
import { chromium } from "playwright-core";
const [out, path = "/", vp = "1440x900"] = process.argv.slice(2);
const [width, height] = vp.split("x").map(Number);
const mobile = width < 768;
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const page = await (await b.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile })).newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto((process.env.APP_URL ?? "http://localhost:3000") + path, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(Number(process.env.WAIT ?? 4500));
const total = await page.evaluate(() => document.documentElement.scrollHeight);
let y = 0, k = 0;
while (y < total) {
  await page.screenshot({ path: `${out}/${String(k).padStart(2, "0")}-${vp}.png` });
  y += Math.round(height * 0.85); k++;
  await page.mouse.wheel(0, Math.round(height * 0.85));
  await page.waitForTimeout(Number(process.env.STEP ?? 1800));
}
// any element poking past the viewport (ignoring marquees and intentionally clipped scrollers)
const wide = await page.evaluate(() => {
  const vw = window.innerWidth, bad = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || r.right <= vw + 1) continue;
    if (el.closest("[data-allow-overflow],.overflow-hidden,.overflow-x-auto,.scrollbar-none") || getComputedStyle(el).position === "fixed") continue;
    if (el.closest(".group\\/marquee, [class*='animate-marquee']")) continue;
    bad.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} +${Math.round(r.right - vw)}px`);
  }
  return bad.slice(0, 6);
});
console.log(`${k} shots, page ${total}px tall`, wide.length ? `\nOVERFLOW:\n  ${wide.join("\n  ")}` : "· no overflow", errors.length ? `\nERRORS: ${errors.join(" | ")}` : "");
await b.close();
