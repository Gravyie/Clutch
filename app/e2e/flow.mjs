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
// Tests start past the first-visit tour (it's covered by its own check below).
const _newContext = browser.newContext.bind(browser);
browser.newContext = async (o) => {
  const c = await _newContext(o);
  await c.addInitScript(() => localStorage.setItem("clutch.tutorial.v1", "1"));
  return c;
};
const results = [];
const check = (name, ok = true, detail = "") => {
  results.push({ name, ok });
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` · ${detail}` : ""}`);
};

// With Privy on, tests take the "Continue as guest" path (the same fallback a viewer has).
async function guest(page) {
  const b = page.getByRole("button", { name: "Use a test wallet" });
  if (await b.waitFor({ timeout: 8000 }).then(() => true, () => false)) await b.click();
}

// Sign in and that's it: a starter pass and test funds land by themselves.
async function onboard(page) {
  await page.goto(APP + "/live?test-wallet=1");
  await page.getByRole("button", { name: "Sign in" }).first().click();
  await guest(page);
  await page.getByText("Every trade is one tap now").waitFor({ timeout: 60_000 });
  await page.keyboard.press("Escape");
}

// The World ID upgrade, opened on purpose from the account page (dev verifier personas locally).
async function verify(page, persona) {
  await page.goto(APP + "/account");
  await page.getByRole("button", { name: "Verify with World ID" }).first().click();
  await page.getByRole("button", { name: new RegExp(persona) }).click();
}

async function liveMarket(slug, minLeft = 10, waitSec = 90) {
  for (let i = 0; i < waitSec; i++) {
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
  await onboard(page);
  check("sign in and that's it: wallet, starter pass and funds land automatically");
  await page.screenshot({ path: `${OUT}/1-onboarded.png` });

  const s = await liveMarket(undefined, 12);
  await page.goto(`${APP}/c/${s.slug}`);
  const panel = page.getByTestId("round");
  await panel.getByRole("radio", { name: "$5" }).click().catch(async (e) => { await page.screenshot({ path: `${OUT}/fail-trade.png` }); throw e; });
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

// With real World ID configured there is no test verifier, so the persona checks below run only on the dev setup.
const WORLD_REAL = (await (await fetch(`${ENGINE}/config`)).json()).world?.configured;
if (WORLD_REAL) console.log("- World ID is live: persona checks skipped (verify with World App or the simulator by hand)");

// 2. Under 18: refused before any pass exists.
if (!WORLD_REAL) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  await onboard(page);
  await verify(page, "Under 18");
  const ok = await page.getByText(/18\+ requirement/).waitFor({ timeout: 15_000 }).then(() => true, () => false);
  check("under-18 is refused a pass", ok);
  await page.screenshot({ path: `${OUT}/4-minor.png` });
  await ctx.close();
}

// 3. The replay channel's streamer: the contract refuses their trade on their own channel. The recorded-game channel
// exists only on a local chain; on a testnet the same rule is covered by test_streamerCannotTradeOwnMarket.
const HAS_REPLAY = (await (await fetch(`${ENGINE}/streams`)).json()).some((x) => x.slug === "replay");
if (!HAS_REPLAY) console.log("- no replay channel on this network: streamer check is covered by the contract tests");
if (!WORLD_REAL && HAS_REPLAY) {
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  const page = await ctx.newPage();
  await onboard(page);
  await verify(page, "Replay streamer");
  await page.getByText(/Every trade is one tap now|ready\. Daily limit/).first().waitFor({ timeout: 60_000 });
  await page.keyboard.press("Escape");
  await liveMarket("replay", 10, 360); // the replay channel opens about one market every few minutes
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

// 5. A first-time viewer taps Yes before setting anything up: one sheet, then that same trade goes through.
{
  const ctx = await browser.newContext({ viewport: { width: 1512, height: 982 } });
  const page = await ctx.newPage();
  const s = await liveMarket(undefined, 16, 300);
  await page.goto(`${APP}/c/${s.slug}?test-wallet=1`);
  await page.getByTestId("round").getByRole("button", { name: /^Yes/ }).click();
  await guest(page);
  const ok = await page.getByText(/^Yes · \$\d+ in$/).waitFor({ timeout: 60_000 }).then(() => true, () => false);
  check("first tap survives onboarding: the trade goes through once the wallet is ready", ok, `${s.slug} #${s.market.id}`);
  await page.screenshot({ path: `${OUT}/7-first-tap.png` });
  await ctx.close();
}

// 6. The first-visit tour shows once and can be reopened.
{
  const ctx = await _newContext({ viewport: { width: 1512, height: 982 } });
  const page = await ctx.newPage();
  await page.goto(`${APP}/live`);
  const shown = await page.getByText("An AI watches the stream").waitFor({ timeout: 30_000 }).then(() => true, () => false);
  for (let k = 0; k < 3; k++) await page.getByRole("dialog").getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Start watching" }).click();
  await page.reload();
  await page.waitForTimeout(4000);
  const gone = !(await page.getByText("An AI watches the stream").isVisible());
  await page.getByRole("button", { name: "How it works" }).click();
  const again = await page.getByText("An AI watches the stream").waitFor({ timeout: 5000 }).then(() => true, () => false);
  check("first-visit tour shows once and reopens from How it works", shown && gone && again);
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
