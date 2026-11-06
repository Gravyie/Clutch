# Demo script (under 3 minutes)

Setup: `pnpm dev`, then open `http://localhost:3000`. Keep two browser profiles ready (viewer A and viewer B) and a
0G API key from pc.0g.ai for the "Call a market" beat. If the venue network is bad, `GAME_SOURCE=replay pnpm engine`
keeps the chess channels alive offline.

| Time | Beat | Show |
|---|---|---|
| 0:00–0:20 | **Hook.** "Millions already bet channel points on streams, and the streamer decides who wins. Clutch lets an AI open the market and two AIs settle it." | Landing page: the live frame the AI is reading, the open market, the last receipt, all live. |
| 0:20–0:45 | **One person, one limit (World).** Sign in → Verify with World ID (Proof of Human) → test funds. Then cancel the flow once in the second profile: no pass, trading stays locked. | Onboarding dialog |
| 0:45–1:25 | **Live market (0G + Uniswap).** On a Twitch channel the AI is reading: "What the AI sees" lists the HUD counters. A market opens ("Will LOS win this round to make it 4-6?"). Both viewers tap opposite sides; odds move. It locks, plays out with the live counter, and settles. | `/c/:channel`: round panel, vision panel |
| 1:25–1:50 | **Call a market (viewer's own 0G credits).** No market open? Connect 0G → Call a market. The app shows the cost and the 0G request ID; refresh pc.0g.ai → Activity to show the viewer's balance went down. | Call card, pc.0g.ai |
| 1:50–2:15 | **Receipt.** Rule hash committed before trading, both readers' verdicts and frames, 0G request IDs, evidence root, settlement tx. A VOID receipt where the readers disagreed: everyone refunded. | `/m/:id` |
| 2:15–2:40 | **Blackout Guard.** Vault → simulate an outage: the ETH/USDC fee jumps to 15% and decays per block, Clutch stops trading, and an overlapping market settles VOID. | `/vault` |
| 2:40–3:00 | **Close.** One line of Solidity: `if (windowStart < lockTime + latencyBuffer) revert`. "Every moment is a market, and every settlement has a receipt." | Landing |

Backup: `REPLAY_CORRUPT_PLY=40 GAME_SOURCE=replay pnpm engine` makes source B misread a ply, so the next chess market
VOIDs with "Sources disagree at ply …". This shows the two-source rule doing its job.
