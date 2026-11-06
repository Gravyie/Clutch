# Clutch: product decisions

What we are building, what we learned from the products that came before, and why each sponsor is load-bearing.
Written November 2026 for ETHGlobal Mumbai.

## The one-line product

An AI watches live streams, opens 30–60 second yes/no markets on what is about to happen on screen, and two
independent models settle them. Viewers sign in and call it in one tap; the free stuff goes to real humans.

## What already exists, and what it gets wrong

| Product | What it does well | What breaks |
|---|---|---|
| **Twitch Predictions** (channel points) | Huge habit: millions of viewers already predict on streams. One tap, inside the stream. | The streamer writes every question by hand and decides the result. No money, no proof, one prediction at a time. |
| **CRSHMARKET** (Monad, $3.5M seed, >$10M volume in its first months) | Proves the demand: short markets inside a stream, settled in ~60s. | Markets are hosted and resolved by people close to the stream. The main criticism is that the streamer or their friends can steer or front-run outcomes "without leaving auditable records". No public receipt. |
| **Polymarket / Kalshi** | Deep order books, trusted resolution (UMA / exchange). Kalshi offers live in-game trading. | Order books need market makers, so a 45-second market on a mid-size streamer never fills. Resolution takes minutes to days. |
| **Bet Streams** (ETHBogotá finalist) | Pay-per-view streams with bets, settled by UMA. | Outcomes are announced on air, so whoever is in the room knows first. Pools are parimutuel, so there's no price until the pool closes. UMA's dispute window is far too slow for a 60-second market. |

From these, five problems any live-stream market has to solve:

1. **Who writes the market?** Humans can't write questions for thousands of streams, every minute. *(0G)*
2. **Where does the price come from?** An order book or a parimutuel pool doesn't work for a 45-second market with
   twelve traders. The market needs instant, always-on liquidity and a price at second zero. *(Uniswap v4)*
3. **Who decides, and can the people on stream cheat?** The result must come from something nobody controls, and
   markets must be on outcomes the person on camera can't decide. *(0G readers + market design)*
4. **Can anyone know the answer before betting?** Stream delay is 2–10 seconds. Anyone watching with lower latency
   is "courtsiding". *(the forward-only window, enforced in the hook)*
5. **Who gets the free stuff?** Free stakes and prizes are what bot farms take. *(World ID)*

## Sponsors: why these three, and why not the others

We picked the three where removing the sponsor breaks a core loop, not the three with the most prize money.

### 0G Private Computer: the AI *is* the market maker
- Reader A (`claude-haiku-5.5` on 0G) reads a frame every few seconds and lists every number on the HUD. The agent
  picks a contested one, writes the question and a machine-checkable rule, and prices it.
- Reader B (`0gm-1.0-35b-a3b` on 0G), a *different* model, reads its own frames and settles. Disagreement voids.
- Viewers can **call a market** on demand with their own 0G credits.
- **Without 0G:** no market ever opens or settles. Every receipt carries the 0G request IDs.

### Uniswap v4: the market *is* a pool, and the money never leaves the PoolManager
- `ClutchHook` replaces the CL curve with an LMSR in `beforeSwap`, so every market has a price from second zero
  without a single market maker. The LP vault funds the worst case before the market opens.
- **One-tap from ETH:** `ClutchRouter.backWithEth` swaps ETH→USDC through the **Blackout Guard** pool and buys
  outcome shares through the **ClutchHook** pool in a *single* `unlock`. The USDC credit from the first swap nets
  against the debt from the second, so USDC never moves and the user needs no approval. Both hooks share one
  `SequencerGuard`: during an L2 outage the onramp pool charges the auction fee and the market refuses trades.
- Positions are ERC-6909 claims inside the PoolManager. They're redeemed through the hook's own `unlockCallback`.
- **Without Uniswap v4:** we would have to write custody, accounting, routing and a separate onramp, and nothing
  would make the funding swap and the bet atomic. Blackout Guard couldn't protect both at once.

### World (Best Use of IDKit): rewards go to real people
- Live streams are watched by people, so what makes Clutch fun to try is for people: free test funds every day,
  a place on the leaderboard, and a higher daily limit. Each is what a bot farm with a thousand wallets would take.
- **Proof of Human** is the minimum credential: one nullifier per person answers "have they had theirs today?".
  Paid trading stays wallet-only and instant; World is an upgrade, never a gate.
- **What World doesn't do:** stop rigging. No identity check can stop the person on camera throwing a game, so
  Clutch never opens markets they control (their own survival) and keeps each market's payout small.
- **Without World:** one person with a hundred wallets farms every free stake and fills the leaderboard.

### Considered and not picked
- **ENSv2.** Channel and market names (`ninja.clutch.eth`) would be nice, but nothing breaks without them.
- **World ID Agent Pass.** Built (an agent trades for one verified human, inside their cap), but fans don't want an
  agent to make their call on a live stream, so it isn't pitched.
- **Chainlink CRE.** Settling through independent oracle nodes would remove our single resolver key: the strongest
  "what's next", but a smaller prize than the tracks above.
- **Arc.** USDC gas and sub-second finality fit 30-second markets well, and Uniswap v4 is on Arc. But Arc's tracks
  require Arc Studio as the starting point. Moving chains would also drop the L2 sequencer problem that Blackout
  Guard solves. Our USDC-native flow ports to Arc later.
- **Chainlink CRE** could orchestrate the two readers. It's a smaller prize and would only replace the engine's
  scheduler, so it isn't load-bearing.

## The user flows

**Viewer (about 60 seconds to a first trade)**
1. Land on `/`: a live stream the AI is reading right now, the open market and the last receipt.
2. Tap *Watch live* and see the stream with one market card under it.
3. Tap *Yes* and get one sheet: sign in (email, Google, a wallet, or as a guest) → a wallet, starter pass and free
   funds are set up automatically → the tapped trade goes through.
4. Watch it play out against the live counter the AI is reading, then see the verdict and receipt.

**Viewer, nothing open:** *Call a market* uses the viewer's own 0G credits.

**Streamer:** claim the channel with a code in the stream title, verify with World ID (now barred from their own
markets), add the OBS overlay, and veto or pause any market.

**Verified human:** one Proof of Human check → free funds every day, a place on the leaderboard, a higher limit
across all their wallets.

## What we deliberately don't do
- No markets on reruns, clocks, or anything the person on camera controls (their survival, ammo, money).
- No settlement by the streamer, by a single model, or by a single frame.
- No trading inside the stream delay: every window starts after lock plus a latency buffer, enforced onchain.
