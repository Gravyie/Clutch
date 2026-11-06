# Demo script (under 3 minutes)

Setup: `pnpm dev`, then open `http://localhost:3000`. On Base Sepolia, deploy with
`bash scripts/deploy-testnet.sh basesepolia` first (it checks the wallets are funded). Have a browser wallet with
Sepolia ETH ready for the Relay beat. Slides: the Clutch pitch deck artifact (architecture diagrams are in
`docs/diagrams/`).

| Time | Beat | Show |
|---|---|---|
| 0:00–0:15 | **Hook.** "Millions already bet channel points on streams, and the streamer decides who wins. Clutch lets an AI open the market and two AIs settle it." | Landing page: the frame the AI is reading, the open market, the last receipt, all live. |
| 0:15–0:35 | **Sign in and that's it.** Tap *Watch live*, tap *Yes*: one sheet, a wallet and starter pass appear, funds land, and the tapped trade goes through. | `/c/:channel` round panel |
| 0:35–1:05 | **A live market (0G + Uniswap).** "What the AI sees" lists the HUD counters; the market is on one of them. It locks, plays out against the live counter, and both readers settle it. The stream's Twitch chat shows the market and the result inline. | Round panel, vision panel, chat |
| 1:05–1:25 | **Money moves simply (Uniswap + Relay).** Wallet sheet: Deposit from Sepolia through Relay (about 2 s). Then a bet paid in ETH: one transaction through the Blackout Guard pool and the market pool. Winnings land in the balance by themselves. | Wallet sheet, Portfolio |
| 1:25–1:50 | **One person, one limit (World).** Hit the $10 starter cap, tap *Raise it with World ID* (Proof of Human), and the cap follows you across wallets. Cancel once to show nothing is issued. | Refusal card, onboarding |
| 1:50–2:15 | **Agents (World Agent Pass + 0G).** `pnpm --filter @clutch/engine agent`, paste its address in `/agents`, decline once (no pass), approve once: the agent prices a market with 0G and trades inside your cap. | `/agents`, terminal |
| 2:15–2:35 | **Receipt + Blackout Guard.** Rule hash, both readers, 0G request IDs, evidence root. Simulate an outage on `/vault`: the fee jumps and decays per block, and the market refuses. | `/m/:id`, `/vault` |
| 2:35–3:00 | **Close.** `windowStart < lockTime + latencyBuffer` reverts. "Every moment is a market, and every result has a receipt." | Landing |

Backup: `GAME_SOURCE=replay pnpm engine` keeps chess markets running with no network; `REPLAY_CORRUPT_PLY=40` makes
source B misread a ply, so the next market voids and shows the two-source rule doing its job.
