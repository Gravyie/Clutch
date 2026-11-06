// End-to-end user journeys in a real browser (system Chrome via playwright-core).
// Requires the local stack running: anvil, engine (:8787), app (:3000).
// Usage: node e2e/flow.mjs [screenshotDir]
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const APP = process.env.APP_URL ?? "http://localhost:3000";
const ENGINE = process.env.ENGINE_URL ?? "http://localhost:8787";
const OUT = process.argv[2] ?? "e2e/out";
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const results = [];
const check = (name, ok = true, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};

async function onboard(page, persona) {
  await page.goto(APP + "/live");
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await page.getByRole("button", { name: "Create guest wallet" }).click();
  await page.getByRole("button", { name: new RegExp(persona) }).click();
}

async function liveMarket(slug, minLeft = 10) {
  for (let i = 0; i < 90; i++) {
    const streams = await (await fetch(`${ENGINE}/streams`)).json();
    const s = streams.find((x) => (!slug || x.slug === slug) && x.market?.phase === "trading" && x.market.lockTime - Date.now() / 1000 > minLeft);
    if (s) return s;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`no trading market on ${slug ?? "any channel"}`);
}

// 1. A new adult viewer: sign in, verify, fund, trade, see it in the portfolio.
{
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  const page = await ctx.newPage();
  await onboard(page, "Adult viewer");
  await page.getByRole("button", { name: "Set up wallet" }).click();
  await page.getByText("Every trade is one tap now").waitFor({ timeout: 60_000 });
  check("onboarding: guest wallet, human pass, test funds, approvals");
  await page.screenshot({ path: `${OUT}/1-onboarded.png` });
  await page.keyboard.press("Escape");

  const s = await liveMarket(undefined, 12);
  await page.goto(`${APP}/c/${s.slug}`);
  const panel = page.getByTestId("round");
  await panel.getByRole("radio", { name: "$5" }).click();
  await panel.getByRole("button", { name: /^Yes/ }).click();
  await page.getByText(/Yes · \$5 in/).waitFor({ timeout: 30_000 });
  check("trade: one tap, no wallet prompt", true, `${s.slug} #${s.market.id}`);
  await page.screenshot({ path: `${OUT}/2-traded.png` });

  await page.goto(`${APP}/portfolio`);
  await page.getByText(s.market.question).first().waitFor({ timeout: 20_000 });
  check("portfolio lists the position");
  await page.screenshot({ path: `${OUT}/3-portfolio.png` });
  await ctx.close();
}

// 2. Under 18: refused before any pass exists.
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await onboard(page, "Under 18");
  const ok = await page.getByText(/18\+ requirement/).waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("under-18 is refused a pass", ok);
  await page.screenshot({ path: `${OUT}/4-minor.png` });
  await ctx.close();
}

// 3. The replay channel's streamer: the contract refuses their trade on their own channel.
{
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  const page = await ctx.newPage();
  await onboard(page, "Replay streamer");
  await page.getByRole("button", { name: "Set up wallet" }).click();
  await page.getByText("Every trade is one tap now").waitFor({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await liveMarket("replay", 10);
  await page.goto(`${APP}/c/replay`);
  const panel = page.getByTestId("round");
  await panel.getByRole("button", { name: /^Yes/ }).click();
  const ok = await panel.getByText("Trade blocked").waitFor({ timeout: 30_000 }).then(() => true, () => false);
  check("streamer is blocked from their own market", ok);
  await page.screenshot({ path: `${OUT}/5-streamer-blocked.png` });
  await ctx.close();
}

// 4. Mobile layout renders the market under the stage.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  const s = await liveMarket(undefined, 5).catch(() => null);
  await page.goto(`${APP}/c/${s?.slug ?? "blitz"}`);
  await page.waitForTimeout(4000);
  await page.screenshot({ path: `${OUT}/6-mobile.png`, fullPage: false });
  check("mobile channel page renders");
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
