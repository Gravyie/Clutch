# Clutch: every moment is a market

Clutch turns the moments of a live stream into short, fair, verifiable markets. An agent on **0G** watches the game
and opens a market from a fixed grammar ("Material swings by 3+ in the next 2 moves?"). Viewers back YES or NO in
one tap through a **Uniswap v4 hook**, with limits tied to a **World ID** human rather than a wallet. The market
settles seconds later only if two independent sources agree, and every verdict ships with a receipt.

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

Tests: `cd contracts && forge test` runs **29 tests**, including a 512-run fuzz test proving every winner or refund is
paid in full and only fees remain (`testFuzz_solvency`). There is also a block-anchored auction test where warping
six hours of wall-clock time doesn't move the fee.

Feedback: [`FEEDBACK.md`](FEEDBACK.md).

## For World judges

- **Trust moment:** putting money on a live outcome. **Minimum sufficient credential:** a unique human (so caps and
  self-exclusion follow the person; a new wallet resets nothing), plus 18+. We request `passport({ signal: wallet })`.
  The signal binds the proof to the session wallet. We add Identity Check `minimum_age: 18` where World enables it
  (preview). No document data is stored, only the nullifier.
- **Server-side verification:** [`engine/src/pass.ts`](engine/src/pass.ts) signs the RP request (`signRequest`), forwards
  the IDKit result to `POST developer.world.org/api/v4/verify/{rp_id}`, checks `success` and `environment`, and then signs
  an EIP-712 `HumanPass` that [`HumanPassGate`](contracts/src/clutch/HumanPassGate.sol) checks onchain on every trade.
- **Success path plus three alternative paths**, each refused with the rule named in the UI: under-18 (no pass issued),
  self-excluded (`SelfExcludedUntil`, survives a new wallet), and the streamer trading their own market
  (`StreamerCannotTradeOwnMarket`).
- Debrief: [`docs/WORLD_DEBRIEF.md`](docs/WORLD_DEBRIEF.md).

## For 0G judges

- **AI is the product:** the agent decides *when* a moment deserves a market, *which* template, and *at what price*;
  the opening price seeds the LMSR curve. Calls go through the 0G Router ([`engine/src/ai/zeroG.ts`](engine/src/ai/zeroG.ts));
  every market and receipt carries the 0G request id.
- **What breaks without 0G:** no markets open. The engine never invents one without the agent
  ([`moment.ts`](engine/src/ai/moment.ts)); the offline base-rate mode is labelled everywhere it appears.
- **Evidence on 0G Storage:** each verdict's bundle (rule, both sources' raw facts, verdict, agent decision) is uploaded
  with the 0G SDK. Its Merkle root goes onchain with the verdict ([`evidence.ts`](engine/src/evidence.ts)).
- **Pays for itself:** the agent earns 0.25% of volume as the resolver fee (`owed[resolver]`) and runs under a daily
  spend cap. Over 80% of the cap it lists fewer, higher-interest moments; at the cap it stops opening markets.
  Settlement never needs inference, so open markets always resolve.
- **Every day:** a market on every stream, every day, means the agent spends credits daily.
- Runs on `localhost:3000` (app) with the engine on `:8787`.

## Product decisions

- **Not a Twitch extension, and not our own RTMP stack.** Twitch restricts gambling-adjacent features and extension
  review is slow; owning video (CRSHMARKET's approach) means a streamer cold start. Clutch is a **web app** that renders
  chess natively (zero embed latency) or embeds Twitch, plus an **OBS overlay** with a QR code, so viewers on any
  platform can scan in. With a Twitch embed, viewers report `getPlaybackStats().hlsLatencyBroadcaster`, and the engine
  raises the onchain latency buffer to 1.5× the p95.
- **The AI chooses, it never writes.** Questions come only from templates whose facts both sources emit. Templates one
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

Pages: `/` · `/browse` · `/c/:channel` (watch and trade) · `/m/:id` (market and receipt) · `/portfolio` · `/leaderboard` · `/studio` (creators) · `/vault` (LPs) · `/account` · `/overlay/:channel` (OBS, 1920×1080).

More: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) · [`docs/DEMO.md`](docs/DEMO.md) · [`docs/WORLD_DEBRIEF.md`](docs/WORLD_DEBRIEF.md) · [`FEEDBACK.md`](FEEDBACK.md)

## Honest limits

- Test networks only, with test USDC. Real money needs a licensed operator per jurisdiction; the design (age gate,
  person-level limits, self-exclusion, audit trail) is built for that.
- Both chess sources are Lichess (different transports, different code paths). Vision on the public stream is the
  planned truly independent second source.
- The Chainlink feed can lag a real outage; trades in that gap are caught only once the feed reports it (Blackout
  Guard voids at resolution). If the feed never reports, nothing catches them.
- If the engine restarts mid-market, that market's verdict is lost; `expire()` lets anyone void it an hour after the
  window, which refunds everyone.
