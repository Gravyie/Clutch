# Clutch: product decisions

What we are building, what we learned from the products that came before, and why each sponsor is load-bearing.
Written November 2026 for ETHGlobal Mumbai.

## The one-line product

An AI watches live streams, opens 30–60 second yes/no markets on what is about to happen on screen, and two
independent models settle them. Viewers call it in one tap. Agents can trade too, but only on behalf of a verified
human and inside that human's limits.

## What already exists, and what it gets wrong

| Product | What it does well | What breaks |
|---|---|---|
| **Twitch Predictions** (channel points) | Huge habit: millions of viewers already predict on streams. One tap, inside the stream. | The streamer writes every question by hand and decides the result. No money, no proof, one prediction at a time. |
| **CRSHMARKET** (Monad, $3.5M seed, >$10M volume in its first months) | Proves the demand: short markets inside a stream, settled in ~60s. | Markets are hosted and resolved by people close to the stream. The main criticism is that the streamer or their friends can steer or front-run outcomes "without leaving auditable records". No public receipt. |
| **Polymarket / Kalshi** | Deep order books, trusted resolution (UMA / exchange). Kalshi offers live in-game trading. | Order books need market makers, so a 45-second market on a mid-size streamer never fills. Resolution takes minutes to days. |
| **Bet Streams** (ETHBogotá finalist) | Pay-per-view streams with bets, settled by UMA. | Outcomes are announced on air, so whoever is in the room knows first. Pools are parimutuel, so there's no price until the pool closes. UMA's dispute window is far too slow for a 60-second market. |

From these, four problems any live-stream market has to solve:

1. **Who writes the market?** Humans can't write questions for thousands of streams, every minute. *(0G)*
2. **Where does the price come from?** An order book or a parimutuel pool doesn't work for a 45-second market with
   twelve traders. The market needs instant, always-on liquidity and a price at second zero. *(Uniswap v4)*
3. **Who decides, and can the people on stream cheat?** Insiders (the streamer, their team) and sybils
   (one person, many wallets) are the main ways these products fail. *(World ID)*
4. **Can anyone know the answer before betting?** Stream delay is 2–10 seconds. Anyone watching with lower latency
   is "courtsiding". *(the forward-only window, enforced in the hook)*

## Sponsors: why these three, and why not the others

We picked the three where removing the sponsor breaks a core loop, not the three with the most prize money.

### 0G Private Computer: the AI *is* the market maker
- Reader A (`claude-haiku-5.5` on 0G) reads a frame every few seconds and lists every number on the HUD. The agent
  picks a contested one, writes the question and a machine-checkable rule, and prices it.
- Reader B (`0gm-1.0-35b-a3b` on 0G), a *different* model, reads its own frames and settles. Disagreement voids.
- Viewers can **call a market** on demand with their own 0G credits. Their trading agents use 0G to decide.
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

### World: one person, one limit, for humans *and* their agents
- **IDKit, Proof of Human** for viewers: a per-person daily cap, self-exclusion that survives a new wallet, and a
  streamer who can never trade their own markets. Proof of Human is the minimum credential that makes "per person"
  true; we don't ask for a passport.
- **Agent Pass (World IdP, OIDC device grant)** for trading agents: an agent is authorized by a human approving it
  in World App. Its wallet gets a pass bound to the *same* human, so the onchain daily cap is shared, and a human
  checkpoint (`max_age=0` step-up) is required before an agent can raise its allowance. A denied or expired
  approval means the action never happens.
- **Without World:** sybil wallets reset every limit, the streamer can bet through a friend's wallet, and 30-second
  markets get farmed by bot swarms.

### Considered and not picked
- **ENSv2.** Channel and agent names (`ninja.clutch.eth`, `agent.ninja.clutch.eth`) would be nice, but a name doesn't
  stop a sybil or an insider. It would duplicate World's job and decorate the product instead of carrying it.
- **Arc.** USDC gas and sub-second finality fit 30-second markets well, and Uniswap v4 is on Arc. But Arc's tracks
  require Arc Studio as the starting point. Moving chains would also drop the L2 sequencer problem that Blackout
  Guard solves. Our USDC-native flow ports to Arc later.
- **Chainlink CRE** could orchestrate the two readers. It's a smaller prize and would only replace the engine's
  scheduler, so it isn't load-bearing.

## The user flows

**Viewer (about 60 seconds to a first trade)**
1. Land on `/`: a live stream the AI is reading right now, the open market and the last receipt.
2. Tap *Watch live* and see the stream with one market card under it.
3. Tap *Yes* and get one sheet: *Verify with World ID* → test funds and one-tap trading are set up automatically →
   the tapped trade goes through.
4. Watch it play out against the live counter the AI is reading, then see the verdict and receipt.

**Viewer, nothing open:** *Call a market* uses the viewer's own 0G credits.

**Streamer:** claim the channel with a code in the stream title, verify with World ID (now barred from their own
markets), add the OBS overlay, and veto or pause any market.

**Agent owner:** run `clutch-agent` → it shows a code → approve in World App → the agent trades within its
allowance → raising the allowance asks for a fresh World ID approval.

## What we deliberately don't do
- No markets on reruns, clocks, or numbers one person controls (ammo, money).
- No settlement by the streamer, by a single model, or by a single frame.
- No trading inside the stream delay: every window starts after lock plus a latency buffer, enforced onchain.
