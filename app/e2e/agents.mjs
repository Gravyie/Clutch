// Agent Pass flow in a real browser: a verified human authorizes an agent (declined first, then approved).
// Usage: AGENT=0x... node e2e/agents.mjs
import { chromium } from "playwright-core";
const APP = process.env.APP_URL ?? "http://localhost:3000";
const AGENT = process.env.AGENT;
const OUT = new URL("./out/", import.meta.url).pathname;
const b = await chromium.launch({ executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
const ctx = await b.newContext({ viewport: { width: 1512, height: 982 } });
const page = await ctx.newPage();
const ok = (n, v = true) => console.log(`${v ? "✓" : "✗"} ${n}`);

await page.goto(`${APP}/agents`);
await page.getByRole("button", { name: "Verify with World ID" }).first().click();
await page.getByRole("button", { name: /Second adult/ }).click();
await page.getByText(/Every trade is one tap now|ready\. Daily limit/).first().waitFor({ timeout: 90_000 });
ok("onboarded in one sheet: guest wallet, pass, funds");
await page.keyboard.press("Escape");

await page.getByRole("button", { name: "Sign in" }).last().click();
await page.getByLabel("Agent wallet address").fill(AGENT);
await page.getByRole("button", { name: "Approve with World ID" }).click();
await page.getByRole("button", { name: "Decline" }).click();
ok("declined approval issues nothing", await page.getByText("Not authorized", { exact: true }).waitFor({ timeout: 15_000 }).then(() => true, () => false));
const pass1 = await fetch(`${process.env.ENGINE ?? "http://localhost:8787"}/agents/${AGENT}/pass`);
ok("agent has no pass after a decline", pass1.status === 404);

await page.getByRole("button", { name: "Try again" }).click();
await page.getByRole("button", { name: "Approve", exact: true }).click();
ok("approval authorizes the agent", await page.getByText("Agent authorized").waitFor({ timeout: 15_000 }).then(() => true, () => false));
await page.getByText("active").first().waitFor({ timeout: 15_000 });
await page.screenshot({ path: `${OUT}/agents.png` });
const pass2 = await (await fetch(`${process.env.ENGINE ?? "http://localhost:8787"}/agents/${AGENT}/pass`)).json();
ok(`agent pass carries the human's nullifier (cap $${pass2.capUsdc})`, Boolean(pass2.gateData && pass2.nullifier));
await b.close();
