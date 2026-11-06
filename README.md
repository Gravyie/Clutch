# Clutch: every moment is a market

Clutch turns the moments of any live stream into short, fair, verifiable markets. A vision model on **0G** watches
Twitch, Kick, YouTube or a Lichess game. When something is about to happen it opens a yes/no market on a number that's
on screen ("Will LOS win this round to make it 4-6?", "Eliminations go up in the next 30s?"). Viewers call it in one
tap through a **Uniswap v4 hook**, with limits tied to a **World ID** human rather than a wallet. A second, different
model reads its own frames to settle it. If the two disagree the market voids and everyone is refunded, and every
verdict ships with a public receipt.

ETHGlobal Mumbai · Uniswap Foundation (Build with Uniswap) · World (Best use of IDKit) · 0G (Build with 0G Private Computer)

```
pnpm i && pnpm dev          # anvil → deploy → engine :8787 → app :3000
open http://localhost:3000
```

---

## What's in the box

| Layer | Path | What it does |
|---|---|---|
| Market hook | [`contracts/src/clutch/ClutchHook.sol`](contracts/src/clutch/ClutchHook.sol) | LMSR binary markets inside a v4 pool (`beforeSwap` + `beforeSwapReturnDelta`), forward-only windows, two-source settlement, void = refund at cost |
| LMSR | [`contracts/src/clutch/LMSR.sol`](contracts/src/clutch/LMSR.sol) | Closed-form buy, opening price from the AI's probability, exact worst case `b·ln(1/min(p,1−p))` |
| Human gate | [`contracts/src/clutch/HumanPassGate.sol`](contracts/src/clutch/HumanPassGate.sol) | EIP-712 pass bound to a World ID nullifier: daily cap, self-exclusion, streamer bar |
| LP vault | [`contracts/src/clutch/LPVault.sol`](contracts/src/clutch/LPVault.sol) | ERC-4626 USDC vault funding every market's subsidy, with per-market and total exposure caps |
| Router | [`contracts/src/clutch/ClutchRouter.sol`](contracts/src/clutch/ClutchRouter.sol) | `back()` for markets, `swapExactIn()` for ETH → USDC top-ups |
| **Blackout Guard** | [`contracts/src/blackout/`](contracts/src/blackout/) | `SequencerGuard` (shared chain-level state) + `BlackoutGuardHook` (sequencer-aware Dutch-auction fee, OZ `BaseOverrideFee`) |
| Engine | [`engine/src/`](engine/src/) | Lichess sources A/B, 0G moment engine, resolver, 0G Storage evidence, World ID pass signer, WebSocket API |
| App | [`app/src/`](app/src/) | Watch page, OBS overlay, receipts, streamer studio, LP vault + Blackout Guard |
| Grammar | [`packages/shared/src/grammar.ts`](packages/shared/src/grammar.ts) | Market templates, steerability, safety, the validator; the only questions the AI may ask |
| Simulator | [`sim/`](sim/) | Blackout Guard economics: static fees vs 30-min decay vs block auction, three arbitrage models |

## For Uniswap judges: the lines that matter

| Where | What |
|---|---|
| [`ClutchHook.sol#L284`](contracts/src/clutch/ClutchHook.sol#L284) | **The forward-only rule.** `windowStart < lockTime + latencyBuffer` reverts, so no market can be about a moment any viewer has already seen. Courtsiding is impossible by construction. |
| [`ClutchHook.sol#L376-L397`](contracts/src/clutch/ClutchHook.sol#L376) | Custom curve: the hook consumes the whole exact-input USDC amount, prices shares on LMSR, and returns `toBeforeSwapDelta(amountIn, 0)`, so the CL swap is a no-op. |
| [`ClutchHook.sol#L395`](contracts/src/clutch/ClutchHook.sol#L395) | Custody as ERC-6909 claims (`poolManager.mint`), because the router settles after `beforeSwap`. Redeemed through the hook's own `unlockCallback` ([L482](contracts/src/clutch/ClutchHook.sol#L482)) only when someone is paid. |
| [`ClutchRouter.sol#L90-L138`](contracts/src/clutch/ClutchRouter.sol#L90) | **Bet with ETH in one transaction through both hooks.** ETH → USDC on the Blackout Guard pool, then USDC → outcome shares on the ClutchHook pool, inside one `unlock`. Flash accounting nets the USDC to zero, so the only transfer is the ETH in ([L136](contracts/src/clutch/ClutchRouter.sol#L136)); no USDC balance and no approval needed. Tests: [`OneTap.t.sol`](contracts/test/OneTap.t.sol). |
| [`ClutchRouter.sol#L90-L138`](contracts/src/clutch/ClutchRouter.sol#L90) | **Bet with ETH in one transaction through both hooks.** ETH → USDC on the Blackout Guard pool, then USDC → outcome shares on the ClutchHook pool, inside one `unlock`. Flash accounting nets the USDC to zero, so the only transfer is the ETH in ([L136](contracts/src/clutch/ClutchRouter.sol#L136)); no USDC balance and no approval needed. Tests: [`OneTap.t.sol`](contracts/test/OneTap.t.sol). |
| [`ClutchHook.sol#L291`](contracts/src/clutch/ClutchHook.sol#L291) | Each market draws its exact LMSR worst case from the vault before it opens. |
| [`ClutchHook.sol#L322`](contracts/src/clutch/ClutchHook.sol#L322) | **Blackout void.** If the sequencer was down during trading, a YES/NO verdict becomes VOID. |
| [`BlackoutGuardHook.sol#L50`](contracts/src/blackout/BlackoutGuardHook.sol#L50) | The recovery fee auction: 15% → 0.30% linearly over 40 L2 blocks; 25% ceiling while down; fail-closed when the feed is unreadable. |
| [`SequencerGuard.sol#L117`](contracts/src/blackout/SequencerGuard.sol#L117) | Recovery anchored to `block.number`, not timestamps, because OP Stack catch-up blocks can carry past timestamps. |
| [`LMSR.sol#L48`](contracts/src/clutch/LMSR.sol#L48) | `sharesForCost` closed form: `q' = q_other + b·ln(e^((C+x−q_other)/b) − 1)`. |

**One hook story, two hooks.** On OP Stack chains (Base, Unichain), blocks produced while the sequencer catches up
can be stamped in the past. That breaks the one check that stops post-lock trades (`block.timestamp < lockTime`),
so a sequencer outage is the courtsiding attack at the chain level. One `SequencerGuard` per chain feeds both hooks:
- `BlackoutGuardHook` protects the ETH/USDC pool that Clutch users top up through. LPs capture stale-price
  arbitrage as fees instead of losing it ([sim results](sim/out/results.md)).
- `ClutchHook` refuses trades outside `Phase.Normal`, and voids markets whose trading overlapped an outage, which
  covers back-dated trades nobody could see at trade time.

Tests: `cd contracts && forge test` runs **35 tests**, including a 512-run fuzz test proving every winner or refund is
paid in full and only fees remain (`testFuzz_solvency`). There is also a block-anchored auction test where warping
six hours of wall-clock time doesn't move the fee.

Feedback: [`FEEDBACK.md`](FEEDBACK.md).

## For World judges

- **Trust event:** putting money on a live outcome, under a daily cap. A cap, self-exclusion and the "streamer can't
  bet on their own stream" rule are only real if a second wallet can't reset them.
- **Minimum sufficient credential: Proof of Human** (`proofOfHuman({ signal: wallet })`,
  [`onboarding.tsx`](app/src/components/onboarding.tsx)). The per-action nullifier is exactly "one person, one limit".
  Passport or selfie checks would collect more than this decision needs, so we don't ask for them. The signal binds the
  proof to the wallet that will trade. We store only the nullifier.
- **Server-side verification:** [`engine/src/pass.ts`](engine/src/pass.ts) signs the RP request (`signRequest`, so the
  key never reaches the client), forwards the IDKit result to `POST developer.world.org/api/v4/verify/{rp_id}`, checks
  `success` and `environment`, and only then signs an EIP-712 `HumanPass`. [`HumanPassGate.sol#L117`](contracts/src/clutch/HumanPassGate.sol#L117)
  checks that pass onchain on every trade.
- **Alternative paths**, each with the reason named in the UI: cancelling the World ID flow (nothing is shared, no pass
  is issued, trading stays locked), an ineligible credential (no pass), self-exclusion (`SelfExcludedUntil`, which
  survives a new wallet), and the streamer trading their own market (`StreamerCannotTradeOwnMarket`).
- **Agent Pass (World IdP):** a human authorizes a trading agent with a fresh World ID approval (OIDC device grant,
  `max_age=0`, Orb). The engine validates the ID token ([`agents.ts#L162`](engine/src/agents.ts#L162)) and only then
  signs a pass for the agent's wallet carrying the human's nullifier, so the agent shares the human's onchain daily
  cap. Declined, expired, non-Orb and stale approvals issue nothing. Run an agent with `pnpm --filter @clutch/engine agent`.
- Debrief: [`docs/WORLD_DEBRIEF.md`](docs/WORLD_DEBRIEF.md).

## For 0G judges

- **The AI is the product.** Reader A (`claude-haiku-5.5` on 0G) reads a live frame every few seconds and lists every
  number on the HUD. The agent picks one that opponents or chance control, writes the question and a structured rule,
  and prices it; that price seeds the LMSR curve. Reader B (`0gm-1.0-35b-a3b` on 0G), a different model, reads its own
  frames and settles. Code: [`perceive.ts`](engine/src/video/perceive.ts), [`video.ts`](engine/src/stream/video.ts).
- **What breaks without 0G:** no market ever opens, and none can settle.
- **Request IDs everywhere:** every market, receipt and the landing page show the 0G request IDs behind them
  ([`zeroG.ts`](engine/src/ai/zeroG.ts) reads `x-request-id`).
- **Viewers spend their own credits ("Call a market").** A viewer connects their own 0G key and asks the AI to open a
  market on the stream they're watching right now. Both inference calls for that market are billed to the viewer's 0G
  account and show on their pc.0g.ai activity page; the app shows cost and request ID per call
  ([`call.tsx`](app/src/components/call.tsx), `POST /streams/:slug/call` in [`server.ts`](engine/src/server.ts)).
  The key stays in the viewer's browser and is never stored by the engine. *Sign in with 0G* (iAI) needs the
  organisers' Privy app ID; until then, this API-key path is the working equivalent.
- **Reasons to come back:** markets open on whatever is live, every few minutes, on games people already watch, and a
  hard no-repeat rule keeps them from looping on the same question.
- **Budget:** the platform agent runs under a hard daily cap (`ZG_DAILY_CAP_USD`) that persists across restarts, and
  earns 0.25% of volume as the resolver fee. Typical cost is about $0.0002 per read.
- **Evidence on 0G Storage:** each verdict's bundle (rule, both readings, verdict, agent decision) is uploaded with the
  0G SDK, and its Merkle root goes onchain with the verdict ([`evidence.ts`](engine/src/evidence.ts)).
- Runs on `localhost:3000` (app) with the engine on `:8787`.

## Product decisions

- **Not a Twitch extension, and not our own RTMP stack.** Twitch restricts gambling-adjacent features and extension
  review is slow; owning video (CRSHMARKET's approach) means a streamer cold start. Clutch is a **web app** that renders
  chess natively (zero embed latency) or embeds Twitch, plus an **OBS overlay** with a QR code, so viewers on any
  platform can scan in. With a Twitch embed, viewers report `getPlaybackStats().hlsLatencyBroadcaster`, and the engine
  raises the onchain latency buffer to 1.5× the p95.
- **Vision markets settle on structure, not prose.** The AI may phrase the question, but settlement runs only the
  structured rule (`goes_up` / `reaches` / `drops_below` / `race` / `survives` on a named counter,
  [`counters.ts`](packages/shared/src/counters.ts)), evaluated separately on each reader's own frames. Reruns never get
  markets, trading locks before the window plus a stream-delay buffer, and clocks, ammo and money are refused as
  counters because one person controls them.
- **The AI chooses, it never writes (chess).** Chess questions come only from templates whose facts both sources emit. Templates one
  person can decide for free (castling, giving check) or about behaviour ("rage-quits") are refused, and the refusal
  log is shown on screen.
- **Two sources, same facts.** A = Lichess push stream (`/api/stream/game/{id}`); B = Lichess REST export
  (`/game/export/{id}`), polled and replayed independently with chess.js. The rule runs on each source separately; the
  moves, material and result must match over the window. Anything else is VOID.
- **PRD correction:** `b·ln 2` is the worst case only for a 50/50 open. With the AI's price p it is
  `b·ln(1/min(p,1−p))`, up to about 1.9b at 15%. The vault funds exactly that.

## Run it

Requirements: Node 22+, pnpm 10, Foundry.

```bash
pnpm i
pnpm dev                                 # starts anvil if needed, deploys, runs engine + app

# or step by step
pnpm chain                               # anvil --block-time 1
pnpm deploy:local                        # contracts → contracts/deployments/31337.json, ABIs → packages/shared
pnpm engine                              # GAME_SOURCE=lichess-tv by default (live top blitz game)
pnpm app                                 # http://localhost:3000

GAME_SOURCE=replay pnpm engine           # offline: replays engine/fixtures/game.json in real time
REPLAY_CORRUPT_PLY=40 GAME_SOURCE=replay pnpm engine   # source B misreads a ply → watch a market VOID
cd engine && pnpm test                                  # resolver: agree → verdict, disagree/missing → VOID
cd engine && npx tsx src/scripts/smoke.ts               # E2E: two viewers trade, streamer refused, settle, positions
pnpm sim                                 # Blackout Guard economics → sim/out/results.md
```

Configuration: [`engine/.env.example`](engine/.env.example). Without `ZG_API_KEY` the engine uses labelled base rates;
without World credentials the app shows a labelled dev verifier with four personas (adult, adult, streamer, under-18).

Pages: `/` (landing, live data) · `/live` · `/browse` · `/c/:channel` (watch and trade) · `/m/:id` (market and receipt) · `/portfolio` · `/agents` · `/leaderboard` · `/studio` (creators) · `/vault` (LPs) · `/account` · `/overlay/:channel` (OBS, 1920×1080).

Why these sponsors, and what we learned from Twitch Predictions, CRSHMARKET, Polymarket/Kalshi and Bet Streams:
[`docs/PRODUCT.md`](docs/PRODUCT.md).

More: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DEMO.md`](docs/DEMO.md) · [`docs/WORLD_DEBRIEF.md`](docs/WORLD_DEBRIEF.md) · [`FEEDBACK.md`](FEEDBACK.md)

## Honest limits

- Test networks only, with test USDC. Real money needs a licensed operator per jurisdiction; the design (age gate,
  person-level limits, self-exclusion, audit trail) is built for that.
- Both chess sources are Lichess (different transports, different code paths). On video, the two readers are different
  models on independently captured frames of the same public stream.
- The Chainlink feed can lag a real outage; trades in that gap are caught only once the feed reports it (Blackout
  Guard voids at resolution). If the feed never reports, nothing catches them.
- If the engine restarts mid-market, that market's verdict is lost; `expire()` lets anyone void it an hour after the
  window, which refunds everyone.
