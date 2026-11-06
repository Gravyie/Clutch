// Clutch pitch deck (ETHGlobal Mumbai). node build.js → Clutch-pitch.pptx
const pptxgen = require("pptxgenjs");
const path = require("path");
const { applyTheme } = require("/Users/garv/.claude/skills/synced/33e4aab4-3593-406c-bb7a-06b70870967d_73365d7f-e751-401c-9d7a-c35a85c7ff3f/pptx/scripts/apply_theme.js");

const REPO = "/Users/garv/Documents/Projects/clutch";
const SCR = "/private/tmp/claude-501/-Users-garv-Documents-Projects/6e29f724-0f54-44ae-9daa-1a2870a12270/scratchpad/deck";
const IMG = {
  home: `${REPO}/design/iterations/final/home-1440x900.png`,
  channel: `${SCR}/channel.png`,
  arch: `${REPO}/docs/diagrams/architecture.png`,
};

// A dark theme, natively: background1 (lt1) is the near-black stage, text1 (dk1) the light ink.
const THEME = {
  name: "Clutch",
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  colors: {
    dk1: "F2F5F6", lt1: "080B10", dk2: "9AA3AD", lt2: "0F141B",
    accent1: "B8F36B", accent2: "4AD6B0", accent3: "FF8585", accent4: "161C24", accent5: "6B7480", accent6: "232B35",
    hlink: "B8F36B", folHlink: "4AD6B0",
  },
};
const HEX = { bg: "080B10", surface: "0F141B", raised: "161C24", border: "232B35", ink: "F2F5F6", muted: "9AA3AD", faint: "6B7480", lime: "B8F36B", limeInk: "101808", yes: "4AD6B0", no: "FF8585" };

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333 x 7.5
pres.title = "Clutch: every moment is a market";
pres.author = "Team Clutch";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const MONO = "Courier New";
const W = 13.333, M = 0.6, CW = W - 2 * M;

// ─── Layouts ──────────────────────────────────────────────────────────────────────────────────
const footer = () => [
  { text: { text: "clutch.  ·  ETHGlobal Mumbai 2026", options: { x: M, y: 7.02, w: 6, h: 0.3, fontSize: 10, color: C.accent5, margin: 0 } } },
];
pres.defineSlideMaster({
  title: "Content",
  background: { color: HEX.bg },
  objects: [
    ...footer(),
    { placeholder: { options: { name: "title", type: "title", x: M, y: 0.82, w: CW, h: 1.05, fontSize: 32, bold: true, color: C.text1, valign: "top", align: "left", margin: 0 }, text: "" } },
  ],
  slideNumber: { x: W - M - 0.6, y: 7.02, w: 0.6, h: 0.3, fontSize: 10, color: C.accent5, align: "right" },
});
pres.defineSlideMaster({ title: "Statement", background: { color: HEX.lime }, objects: [] });
pres.defineSlideMaster({ title: "Blank", background: { color: HEX.bg }, objects: [] });

// ─── Helpers ──────────────────────────────────────────────────────────────────────────────────
const eyebrow = (s, text, color = C.accent1) => s.addText(text.toUpperCase(), { x: M, y: 0.45, w: CW, h: 0.3, fontSize: 12, bold: true, charSpacing: 3, color, margin: 0, isTextBox: true, objectName: "Eyebrow" });
const card = (s, x, y, w, h, name, fill = C.accent4) =>
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x, y, w, h, rectRadius: 0.14, fill: { color: fill }, line: { color: C.accent6, width: 0.75 }, objectName: name });
const text = (s, t, o) => s.addText(t, { margin: 0, isTextBox: true, valign: "top", ...o });
const num = (s, n, x, y, d = 0.5) => {
  s.addShape(pres.shapes.OVAL, { x, y, w: d, h: d, fill: { color: C.accent1 }, line: { type: "none" }, objectName: `Step ${n} badge` });
  text(s, String(n), { x, y, w: d, h: d, fontSize: 16, bold: true, color: C.background1, align: "center", valign: "middle", objectName: `Step ${n} number` });
};
const stat = (s, x, y, w, value, label, color = C.text1) => {
  text(s, value, { x, y, w, h: 0.95, fontSize: 54, bold: true, color, objectName: `Stat ${value}` });
  text(s, label, { x, y: y + 1.0, w, h: 0.7, fontSize: 14, color: C.text2, objectName: `Stat label ${value}` });
};
const content = (section, title) => {
  const s = pres.addSlide({ masterName: "Content", sectionTitle: section });
  s.addText(title, { placeholder: "title" });
  return s;
};

// ─── 1 · Cover ────────────────────────────────────────────────────────────────────────────────
pres.addSection({ title: "Why" });
{
  const s = pres.addSlide({ masterName: "Blank", sectionTitle: "Why" });
  s.addShape(pres.shapes.ROUNDED_RECTANGLE, { x: M, y: 0.6, w: 0.42, h: 0.42, rectRadius: 0.1, fill: { color: C.accent1 }, line: { type: "none" }, objectName: "Logo mark" });
  text(s, "c", { x: M, y: 0.6, w: 0.42, h: 0.42, fontSize: 20, bold: true, color: C.background1, align: "center", valign: "middle", objectName: "Logo letter" });
  text(s, "clutch.", { x: M + 0.55, y: 0.6, w: 3, h: 0.42, fontSize: 22, bold: true, color: C.text1, valign: "middle", objectName: "Wordmark" });
  text(s, [
    { text: "Every moment", options: { breakLine: true } },
    { text: "is a " },
    { text: "market.", options: { color: C.accent1 } },
  ], { x: M, y: 1.95, w: 6.6, h: 2.2, fontSize: 60, bold: true, color: C.text1, objectName: "Cover title" });
  text(s, "An AI watches live streams, opens a yes-or-no market the moment something is about to happen, and two independent models settle it in seconds.", {
    x: M, y: 4.3, w: 6.0, h: 1.2, fontSize: 18, color: C.text2, objectName: "Cover subtitle",
  });
  text(s, "UNISWAP V4  ·  0G PRIVATE COMPUTER  ·  WORLD ID", { x: M, y: 6.35, w: 6.4, h: 0.35, fontSize: 12, bold: true, charSpacing: 2, color: C.accent1, fontFace: MONO, objectName: "Tracks" });
  card(s, 6.98, 1.28, 5.85, 3.78, "Hero frame", C.accent4);
  s.addImage({ path: IMG.home, x: 7.08, y: 1.38, w: 5.65, h: 3.53, rounding: false, altText: "Clutch landing page: a live market card and a settlement receipt over a stream", objectName: "Hero image" });
  text(s, "Live on Base Sepolia · github.com/Gravyie/Clutch", { x: 6.98, y: 5.25, w: 5.85, h: 0.35, fontSize: 12, color: C.accent5, align: "right", objectName: "Cover caption" });
  s.addNotes("Hook, ten seconds: millions of people already bet on live streams with Twitch channel points, and the person on camera decides who wins. Clutch lets an AI open the market and two different AIs settle it, with real money and a public receipt.");
}

// ─── 2 · Problem ──────────────────────────────────────────────────────────────────────────────
{
  const s = content("Why", "Viewers already bet on streams. Someone on the stream decides who wins");
  eyebrow(s, "The problem");
  const items = [
    ["Twitch Predictions", "A habit built into the player. But the streamer writes every question by hand and clicks the winner. Channel points only, one prediction at a time, no proof."],
    ["CRSHMARKET", "Real money, 60-second markets, $10M+ traded in its first months. The main criticism: people close to the stream can steer outcomes, with no auditable record."],
  ];
  items.forEach(([h, b], i) => {
    const x = M + i * (CW / 2 + 0.15), w = CW / 2 - 0.15;
    card(s, x, 2.25, w, 2.35, `Problem card ${i + 1}`);
    text(s, h, { x: x + 0.4, y: 2.6, w: w - 0.8, h: 0.5, fontSize: 22, bold: true, color: C.text1, objectName: `Problem title ${i + 1}` });
    text(s, b, { x: x + 0.4, y: 3.25, w: w - 0.8, h: 1.2, fontSize: 16, color: C.text2, objectName: `Problem body ${i + 1}` });
  });
  text(s, [
    { text: "Clutch: ", options: { bold: true, color: C.accent1 } },
    { text: "nobody on the stream writes the market or calls the result." },
  ], { x: M, y: 5.05, w: CW, h: 0.5, fontSize: 20, color: C.text1, objectName: "Problem takeaway" });
  s.addNotes("Demand is proven twice: Twitch built predictions into its player, and CRSHMARKET raised a seed round on 60-second livestream markets. Both share one flaw: someone close to the stream writes the market and decides the result. That is what we remove.");
}

// ─── 3 · Why now ──────────────────────────────────────────────────────────────────────────────
{
  const s = content("Why", "Live attention and live markets are both at records");
  eyebrow(s, "Why now");
  const stats = [
    ["31.7B", "hours of livestreams watched in Q3 2026, a record"],
    ["$50.6B", "traded on Kalshi and Polymarket in July 2026 alone"],
    ["73%", "of March Madness prediction volume was traded live, during the games"],
  ];
  const w = (CW - 2 * 0.5) / 3;
  stats.forEach(([v, l], i) => {
    const x = M + i * (w + 0.5);
    s.addShape(pres.shapes.LINE, { x, y: 2.55, w, h: 0, line: { color: C.accent1, width: 2 }, objectName: `Stat rule ${i + 1}` });
    stat(s, x, 2.85, w, v, l, i === 1 ? C.accent1 : C.text1);
  });
  text(s, "Live, in-the-moment markets are where the volume is, and nobody serves the long tail of live streams.", { x: M, y: 5.25, w: CW, h: 0.5, fontSize: 18, color: C.text1, objectName: "Why now takeaway" });
  text(s, "Sources: Streams Charts, Q3 2026 livestreaming landscape · combined Kalshi + Polymarket monthly volume, July 2026 · Citizens via Blockworks Research", { x: M, y: 6.45, w: CW, h: 0.35, fontSize: 10, color: C.accent5, objectName: "Sources" });
  s.addNotes("Three numbers. People watch more live video than ever. Prediction markets moved fifty billion dollars in one month. And most of that money moves while the event is happening. Nobody serves the millions of live streams outside major sports.");
}

// ─── 4 · Solution statement ───────────────────────────────────────────────────────────────────
pres.addSection({ title: "Product" });
{
  const s = pres.addSlide({ masterName: "Statement", sectionTitle: "Product" });
  text(s, "THE SOLUTION", { x: M, y: 1.3, w: CW, h: 0.35, fontSize: 13, bold: true, charSpacing: 3, color: HEX.limeInk, objectName: "Statement eyebrow" });
  text(s, "The AI opens the market.\nYou call it.\nTwo AIs settle it.", { x: M, y: 1.85, w: CW, h: 3.3, fontSize: 56, bold: true, color: HEX.limeInk, objectName: "Statement" });
  text(s, "Any Twitch, Kick or YouTube stream, or a Lichess game. 30 to 60 second markets, a public receipt for every result, and nobody on the stream decides anything.", {
    x: M, y: 5.35, w: 10.5, h: 0.9, fontSize: 18, color: "2E3A12", objectName: "Statement detail",
  });
  s.addNotes("The whole product in one line. The streamer does nothing: the AI watches every channel at once, and only opens a market on a number that is on screen and that opponents or chance control.");
}

// ─── 5 · How a market works ───────────────────────────────────────────────────────────────────
{
  const s = content("Product", "Life of a market, in about a minute");
  eyebrow(s, "How it works");
  const steps = [
    ["Watch", "A vision model on 0G reads the score, kill feed and every number on the HUD"],
    ["Open", "The agent picks a contested number, fixes the rule and prices it; the rule hash goes onchain"],
    ["Trade", "Viewers tap Yes or No; an LMSR curve in a Uniswap v4 hook prices every trade"],
    ["Lock", "Trading closes; the window starts after the stream-delay buffer, so nobody bets on what they've seen"],
    ["Settle", "A second model family reads its own frames. Agree: pay. Disagree or missing: refund"],
    ["Receipt", "Rule, both verdicts, frames, 0G request IDs and the evidence root, public"],
  ];
  const gap = 0.2, w = (CW - 5 * gap) / 6;
  steps.forEach(([h, b], i) => {
    const x = M + i * (w + gap);
    card(s, x, 2.25, w, 3.35, `Step ${i + 1} card`);
    num(s, i + 1, x + 0.25, 2.5);
    text(s, h, { x: x + 0.25, y: 3.2, w: w - 0.45, h: 0.45, fontSize: 18, bold: true, color: C.text1, objectName: `Step ${i + 1} title` });
    text(s, b, { x: x + 0.25, y: 3.75, w: w - 0.45, h: 1.75, fontSize: 13, color: C.text2, objectName: `Step ${i + 1} body` });
  });
  s.addNotes("Walk the six steps quickly. The two that matter for judges: Lock, because the forward-only window is enforced in the hook, and Settle, because two different model families must agree or everyone is refunded.");
}

// ─── 6 · Product, live ────────────────────────────────────────────────────────────────────────
{
  const s = content("Product", "A real market on a real stream");
  eyebrow(s, "Product, live");
  card(s, M, 2.0, 7.24, 4.7, "Screenshot frame");
  s.addImage({ path: IMG.channel, x: M + 0.08, y: 2.08, w: 7.08, h: 4.54, altText: "Clutch channel page on an ESL Counter-Strike stream: settled market, live Twitch chat with the market inline, and what the AI sees", objectName: "Product screenshot" });
  const notes = [
    ["32K viewers", "ESL Counter-Strike, IEM Beijing quarterfinal, live on Twitch"],
    ["5–5 on the scoreboard", "The AI read the score and opened “Will the left team score its next point before the right?”"],
    ["Settled NO", "Both readers agreed on their own frames; the market opened and settled inside the stream’s own chat"],
  ];
  notes.forEach(([h, b], i) => {
    const y = 2.05 + i * 1.6;
    text(s, h, { x: 8.3, y, w: 4.43, h: 0.45, fontSize: 20, bold: true, color: i === 2 ? C.accent3 : C.accent1, objectName: `Callout ${i + 1} title` });
    text(s, b, { x: 8.3, y: y + 0.5, w: 4.43, h: 1.1, fontSize: 14, color: C.text2, objectName: `Callout ${i + 1} body` });
  });
  s.addNotes("This is a screenshot from our running build, not a mockup. Left: the stream with its market. Right: the streamer's real Twitch chat with our market events inline, and what the AI saw. If the venue network allows, switch to the live app here.");
}

// ─── 7 · The viewer's flow ────────────────────────────────────────────────────────────────────
{
  const s = content("Product", "Sign in and you’re trading");
  eyebrow(s, "The viewer’s flow");
  const steps = [
    ["Sign in", "Email, Google or a wallet. A wallet, a starter pass and free test funds appear on their own."],
    ["Tap Yes", "One tap, no pop-up. Paying in ETH swaps and bets in a single transaction."],
    ["Watch it settle", "The panel tracks the live number the market settles on, second by second."],
    ["Get paid", "Winnings land in your balance at settlement. Nothing to claim."],
  ];
  const gap = 0.3, w = (CW - 3 * gap) / 4;
  steps.forEach(([h, b], i) => {
    const x = M + i * (w + gap);
    card(s, x, 2.25, w, 2.45, `Flow ${i + 1} card`);
    text(s, `0${i + 1}`, { x: x + 0.35, y: 2.55, w: 1, h: 0.4, fontSize: 14, bold: true, fontFace: MONO, color: C.accent1, objectName: `Flow ${i + 1} number` });
    text(s, h, { x: x + 0.35, y: 3.05, w: w - 0.7, h: 0.5, fontSize: 20, bold: true, color: C.text1, objectName: `Flow ${i + 1} title` });
    text(s, b, { x: x + 0.35, y: 3.6, w: w - 0.7, h: 1.0, fontSize: 14, color: C.text2, objectName: `Flow ${i + 1} body` });
  });
  card(s, M, 5.0, CW, 0.95, "World note", C.background2);
  text(s, [
    { text: "Real people get more.  ", options: { bold: true, color: C.accent1 } },
    { text: "One World ID check unlocks free funds every day, a place on the leaderboard and a higher limit, once per person." },
  ], { x: M + 0.35, y: 5.0, w: CW - 0.7, h: 0.95, fontSize: 16, color: C.text1, valign: "middle", objectName: "World note text" });
  s.addNotes("We studied consumer trading apps like fomo: one balance in dollars, two buttons, no claim step. Everything that isn't needed for the first trade is an upgrade, not a gate.");
}

// ─── 8 · Fair by construction ─────────────────────────────────────────────────────────────────
{
  const s = content("Product", "Fair by construction, not by promise");
  eyebrow(s, "Integrity");
  const g = [
    ["No peeking", "windowStart < lockTime + latencyBuffer reverts in the hook. A market can’t be about a moment anyone has already seen."],
    ["No single judge", "Two model families, separate frames, separate connections. No data means no verdict: the market voids and refunds."],
    ["No throwing it", "Clutch never opens markets the person on camera controls, like whether they survive. Only scores, rounds and races opponents decide."],
    ["No trust needed", "Every result has a receipt: the committed rule, both readings, frames, 0G request IDs and an evidence root onchain."],
  ];
  const gap = 0.3, w = (CW - gap) / 2, h = 1.95;
  g.forEach(([t, b], i) => {
    const x = M + (i % 2) * (w + gap), y = 2.15 + Math.floor(i / 2) * (h + gap);
    card(s, x, y, w, h, `Guarantee ${i + 1}`);
    s.addShape(pres.shapes.OVAL, { x: x + 0.35, y: y + 0.38, w: 0.22, h: 0.22, fill: { color: C.accent1 }, line: { type: "none" }, objectName: `Guarantee ${i + 1} dot` });
    text(s, t, { x: x + 0.75, y: y + 0.28, w: w - 1.1, h: 0.45, fontSize: 20, bold: true, color: C.text1, objectName: `Guarantee ${i + 1} title` });
    text(s, b, { x: x + 0.75, y: y + 0.8, w: w - 1.1, h: 1.05, fontSize: 14, color: C.text2, objectName: `Guarantee ${i + 1} body` });
  });
  s.addNotes("This is where we differ from every competitor. No peeking: enforced in the contract. No single judge: two different AIs. No throwing it: we simply don't open markets the streamer controls. No trust needed: every result has a public receipt.");
}

// ─── 9 · Architecture ─────────────────────────────────────────────────────────────────────────
pres.addSection({ title: "How it's built" });
{
  const s = content("How it's built", "Sources, engine, chain, people");
  eyebrow(s, "Architecture");
  card(s, M, 1.95, CW, 4.9, "Diagram frame", "F4F5F2");
  s.addImage({ path: IMG.arch, x: 1.06, y: 2.0, w: 11.22, h: 4.83, altText: "System architecture: live video, Lichess and Twitch chat feed the Clutch engine; two 0G readers and a market agent open and settle markets on Uniswap v4 hooks; viewers and Relay solvers trade through ClutchRouter", objectName: "Architecture diagram" });
  s.addNotes("Left to right. The engine captures frames; reader A on 0G lists every number on the HUD; the agent opens a market onchain. Reader B, a different model, reads its own frames, and the resolver settles only if both agree. Onchain, each market is a Uniswap v4 pool behind ClutchHook; both of our hooks share one SequencerGuard.");
}

// ─── 10 · Uniswap ─────────────────────────────────────────────────────────────────────────────
{
  const s = content("How it's built", "Every market is a Uniswap v4 pool");
  eyebrow(s, "Uniswap v4 · Build with Uniswap");
  const cols = [
    ["ClutchHook", "Replaces the curve with an LMSR in beforeSwap, so a 40-second market has a price at second zero. Stakes are ERC-6909 claims; an LP vault funds the exact worst case up front."],
    ["Blackout Guard", "A sequencer-aware fee hook on the ETH/USDC pool: after an L2 outage it runs a 40-block fee auction so LPs keep the stale-price arbitrage. ClutchHook voids any market the outage overlapped."],
    ["One tap from ETH", "backWithEth swaps through the Blackout pool and buys shares in the market pool inside one unlock. Flash accounting nets the USDC: no approval, one transaction."],
  ];
  const gap = 0.3, w = (CW - 2 * gap) / 3;
  cols.forEach(([h, b], i) => {
    const x = M + i * (w + gap);
    card(s, x, 2.2, w, 2.75, `Uniswap card ${i + 1}`);
    text(s, h, { x: x + 0.35, y: 2.5, w: w - 0.7, h: 0.5, fontSize: 22, bold: true, color: C.accent1, objectName: `Uniswap title ${i + 1}` });
    text(s, b, { x: x + 0.35, y: 3.1, w: w - 0.7, h: 1.7, fontSize: 14, color: C.text2, objectName: `Uniswap body ${i + 1}` });
  });
  text(s, "39 Foundry tests · 512-run solvency fuzz · one-tap ETH bet live on Base Sepolia", { x: M, y: 5.35, w: CW, h: 0.4, fontSize: 14, fontFace: MONO, color: C.accent5, objectName: "Uniswap proof" });
  s.addNotes("Without v4 we would write custody, accounting and routing ourselves, and nothing would make the funding swap and the bet atomic. The forward-only rule lives in the hook: a market about a moment anyone has already seen cannot even be opened.");
}

// ─── 11 · 0G ──────────────────────────────────────────────────────────────────────────────────
{
  const s = content("How it's built", "The AI is the market maker");
  eyebrow(s, "0G · Build with 0G Private Computer");
  text(s, [
    { text: "Reader A (claude-haiku-5.5) reads the HUD and opens markets", options: { bullet: true, breakLine: true } },
    { text: "Reader B (0gm-1.0, Gemini fallback) settles from its own frames", options: { bullet: true, breakLine: true } },
    { text: "Viewers “call a market” on their own 0G credits", options: { bullet: true, breakLine: true } },
    { text: "Every receipt carries the 0G request IDs", options: { bullet: true } },
  ], { x: M, y: 2.25, w: 6.6, h: 2.8, fontSize: 18, color: C.text2, paraSpaceAfter: 12, objectName: "0G uses" });
  text(s, "Without 0G, no market ever opens or settles.", { x: M, y: 5.4, w: 6.6, h: 0.5, fontSize: 20, bold: true, color: C.text1, objectName: "0G takeaway" });
  const cards = [["11,600+", "0G inference calls in one day of testing"], ["< $0.0003", "per frame read, under a hard daily budget"]];
  cards.forEach(([v, l], i) => {
    const y = 2.2 + i * 2.05;
    card(s, 7.75, y, 4.98, 1.8, `0G stat ${i + 1}`);
    text(s, v, { x: 8.1, y: y + 0.25, w: 4.4, h: 0.85, fontSize: 44, bold: true, color: i ? C.accent2 : C.accent1, objectName: `0G stat value ${i + 1}` });
    text(s, l, { x: 8.1, y: y + 1.1, w: 4.4, h: 0.5, fontSize: 14, color: C.text2, objectName: `0G stat label ${i + 1}` });
  });
  s.addNotes("Two different model families, separate frames, separate connections. If a reader has no data, it has no verdict and the market voids with a full refund. The operator can switch platform inference off and on, so credits are only spent while markets are live.");
}

// ─── 12 · World ───────────────────────────────────────────────────────────────────────────────
{
  const s = content("How it's built", "Rewards go to real people");
  eyebrow(s, "World ID · Best Use of IDKit");
  const head = (t) => ({ text: t, options: { bold: true, color: HEX.muted, fill: { color: HEX.surface } } });
  const row = (a, b, c) => [{ text: a, options: { bold: true, color: HEX.ink } }, { text: b, options: { color: HEX.muted } }, { text: c, options: { color: HEX.lime, bold: true } }];
  s.addTable(
    [[head("What"), head("Any wallet"), head("Verified human")], row("Free test funds", "$25, once", "$100 every day, per person"), row("Leaderboard", "Not ranked", "Ranked, all wallets as one"), row("Daily limit", "$10 per wallet", "$100 per person, enforced onchain")],
    { x: M, y: 2.2, w: CW, colW: [3.6, 3.6, CW - 7.2], fontSize: 16, fontFace: "Arial", fill: { color: HEX.raised }, border: { type: "solid", pt: 0.75, color: HEX.border }, margin: [0.12, 0.2, 0.12, 0.2], rowH: 0.62, objectName: "World tiers" },
  );
  text(s, "Live streams are watched by people, so the free stuff is for people. Proof of Human is the minimum credential for “has this person had theirs today?” Trading itself only needs a sign-in.", { x: M, y: 5.0, w: CW, h: 0.8, fontSize: 16, color: C.text2, objectName: "World rationale" });
  text(s, "Verified server-side · RP-signed requests · cancel = nothing issued", { x: M, y: 6.0, w: CW, h: 0.4, fontSize: 14, fontFace: MONO, color: C.accent5, objectName: "World proof" });
  s.addNotes("Free stakes and prizes are exactly what bot farms take. One Proof of Human check, keyed by nullifier, gives one daily refill and one leaderboard row per person, however many wallets they use. Demo: ask for starter funds twice, get refused, verify, claim the daily refill. World does not stop rigging and we don't claim it does; market design does.");
}

// ─── 13 · Proof ───────────────────────────────────────────────────────────────────────────────
pres.addSection({ title: "Proof and next" });
{
  const s = content("Proof and next", "Running on real streams and a public chain");
  eyebrow(s, "Proof");
  const stats = [["1,900+", "markets opened and settled by the agent in testing"], ["1 in 7", "voided and refunded instead of guessed"], ["40+", "live channels tracked across games and chess"]];
  const w = (CW - 2 * 0.5) / 3;
  stats.forEach(([v, l], i) => {
    const x = M + i * (w + 0.5);
    s.addShape(pres.shapes.LINE, { x, y: 2.2, w, h: 0, line: { color: C.accent1, width: 2 }, objectName: `Proof rule ${i + 1}` });
    stat(s, x, 2.45, w, v, l, i === 1 ? C.accent2 : C.text1);
  });
  card(s, M, 4.55, CW, 1.6, "Deployment card", C.background2);
  text(s, "DEPLOYED ON BASE SEPOLIA", { x: M + 0.35, y: 4.78, w: 6, h: 0.3, fontSize: 12, bold: true, charSpacing: 2, color: C.accent1, objectName: "Deployment label" });
  text(s, [
    { text: "ClutchHook          0x6826872452e7Eea21D8a022E8533CEA0F4236888", options: { breakLine: true } },
    { text: "BlackoutGuardHook   0x3794E8F320449518086cd8dBE9CdD34B20601080", options: { breakLine: true } },
    { text: "ClutchRouter        0x1B1F8484a4d2D54fFAAC2Ee9AAFb5B2F77352959" },
  ], { x: M + 0.35, y: 5.18, w: CW - 0.7, h: 1.05, fontSize: 14, fontFace: MONO, color: C.text1, objectName: "Deployment addresses" });
  s.addNotes("Our own numbers, on test funds. The voids matter: when the two readers disagree or a frame is missing, everyone gets their money back. That's the design working, not a failure. The contracts are live on Base Sepolia, and a one-tap ETH bet has gone through both hooks there.");
}

// ─── 14 · Next + close ────────────────────────────────────────────────────────────────────────
{
  const s = pres.addSlide({ masterName: "Blank", sectionTitle: "Proof and next" });
  eyebrow(s, "What’s next");
  text(s, [
    { text: "Base and Unichain mainnet, deposits from any chain via Relay", options: { bullet: true, breakLine: true } },
    { text: "Chat-to-trade: “!yes 5” in Twitch chat from a linked wallet", options: { bullet: true, breakLine: true } },
    { text: "Streamers earn a share of every market’s volume", options: { bullet: true, breakLine: true } },
    { text: "Settlement on independent oracle nodes; evidence on 0G Storage", options: { bullet: true } },
  ], { x: M, y: 1.0, w: 5.7, h: 3.0, fontSize: 17, color: C.text2, paraSpaceAfter: 12, objectName: "Roadmap" });
  text(s, [{ text: "The next moment is ", options: { breakLine: false } }, { text: "already loading.", options: { color: C.accent1 } }], { x: 6.85, y: 1.0, w: 5.88, h: 2.6, fontSize: 48, bold: true, color: C.text1, objectName: "Closing line" });
  text(s, "github.com/Gravyie/Clutch", { x: 6.85, y: 3.8, w: 5.88, h: 0.45, fontSize: 18, fontFace: MONO, color: C.text1, objectName: "Repo" });
  card(s, M, 4.75, CW, 1.3, "Team card", C.background2);
  text(s, "TEAM", { x: M + 0.35, y: 4.98, w: 3, h: 0.3, fontSize: 12, bold: true, charSpacing: 3, color: C.accent1, objectName: "Team label" });
  text(s, "[Name · role]      [Name · role]      [Name · role]", { x: M + 0.35, y: 5.45, w: CW - 0.7, h: 0.6, fontSize: 18, color: C.text1, objectName: "Team names" });
  s.addNotes("Close on the live app. The ask: try it at our table. Sign in, and call the next play. Replace the bracketed team names before presenting.");
}

(async () => {
  const out = path.join(__dirname, "Clutch-pitch.pptx");
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log("wrote", out);
})();
