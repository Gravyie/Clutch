// Visual review screenshots at the four review viewports.
// Usage: node e2e/design-shots.mjs outDir path[:name] ...   ("@trading" as a path = whichever channel has a market open now)
import { chromium } from "playwright-core";

const [out, ...paths] = process.argv.slice(2);
const APP = process.env.APP_URL ?? "http://localhost:3000";
const ENGINE = process.env.ENGINE_URL ?? "http://localhost:8787";
const VIEWPORTS = (process.env.VP ?? "390x844,768x1024,1440x900,1920x1080").split(",");

async function tradingSlug() {
  for (let i = 0; i < 40; i++) {
    const streams = await fetch(`${ENGINE}/streams`).then((r) => r.json());
    const s = streams.find((x) => x.market?.phase === "trading" && x.market.lockTime - Date.now() / 1000 > 12);
    if (s) return s.slug;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return "blitz";
}

const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
for (const vp of VIEWPORTS) {
  const [width, height] = vp.split("x").map(Number);
  const mobile = width < 768;
  const ctx = await b.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile });
  for (const p of paths) {
    let [path, name] = p.split(":");
    if (path === "@trading") path = `/c/${await tradingSlug()}`;
    const page = await ctx.newPage();
    if (process.env.THEME) await page.addInitScript((t) => localStorage.setItem("theme", t), process.env.THEME);
    await page.goto(APP + path, { waitUntil: "domcontentloaded", timeout: 180_000 });
    await page.waitForTimeout(Number(process.env.WAIT ?? 5000));
    const file = `${out}/${name ?? path.replace(/\W+/g, "_")}-${vp}.png`;
    await page.screenshot({ path: file, fullPage: process.env.FULL === "1" });
    const wide = await page.evaluate(() => {
      const vw = window.innerWidth;
      const bad = [];
      for (const el of document.querySelectorAll("main *")) {
        const r = el.getBoundingClientRect();
        if (r.width && r.right > vw + 1 && getComputedStyle(el).position !== "fixed" && !el.closest(".overflow-x-auto,.scrollbar-none,[data-allow-overflow]")) bad.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ").slice(0, 3).join(".")} → ${Math.round(r.right - vw)}px`);
      }
      return bad.slice(0, 3);
    });
    if (wide.length) console.log(`OVERFLOW ${path} @ ${vp}:`, wide.join(" | "));
    if (process.env.SCROLL) {
      await page.mouse.wheel(0, Number(process.env.SCROLL));
      await page.waitForTimeout(800);
      await page.screenshot({ path: file.replace(".png", "-scrolled.png") });
    }
    console.log(file, path);
    await page.close();
  }
  await ctx.close();
}
await b.close();
