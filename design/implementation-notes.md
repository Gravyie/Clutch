# Clutch UI redesign: implementation notes

## What changed

- **Tokens** (`app/src/app/globals.css`): new dark and light palettes on the existing variable names, so every page picked
  them up. Added `--info` and `.frame-corners` (the "moment frame" crop-corner motif, used only on a market that is
  trading). Display type is now Geist (Bricolage removed from `layout.tsx`). Global `:focus-visible` ring.
- **Shell** (`components/shell.tsx`): top navigation (Live, Explore, Leaderboard, Portfolio, Agents) replaces the left
  channel rail; testnet chain badge; footer with AI-engine status and testnet disclosure; phone bottom tabs are Live,
  Explore, Portfolio, Account. Lower-case `clutch` wordmark (`brand.tsx`).
- **Watch page** (`app/(app)/c/[slug]/page.tsx`): channel header above the player; stream/board left with a sticky
  392px prediction rail on `xl`, stacked below `xl`; tabs (Chat, Activity, AI view, Past markets, Integrity); mobile
  Yes/No dock.
- **Moment card** (`components/round.tsx`): status line per phase, question, countdown from the market's lock time,
  explicit "event starts Ns after close, runs Ms", odds, stake chips, Yes/No, balance / add funds, "Why this market?"
  (rule, AI provider, request ID, rule hash). After lock: Closed → Playing out → Checking → Result lifecycle. Trade
  logic (`acct.back`, onboarding hand-off, refusals, ETH path, Blackout Guard) is unchanged.
- **Receipt** (`app/(app)/m/[id]/page.tsx`): masthead with verdict chip, market ID, chain, timestamp, open/settle tx and
  permalink copy.
- **Explore / Live**: search, viewport-safe grids, consistent market card on `/live`.
- **Copy**: removed "independent" and "in seconds" claims (landing, live, how-it-works, market rules).

## Checks

- `pnpm --filter @clutch/app typecheck`: passes.
- `next build`: passes, all 16 routes.
- `e2e/design-shots.mjs`: screenshots at 390/768/1440/1920, no overflow.
- `e2e/flow.mjs`: **blocked**: it stops at onboarding because the running engine returns 404 for `POST /pass/starter`.
  The route exists in `engine/src/server.ts`; the engine process on :8787 predates the commit that added it. Restart the
  engine and re-run.

## Not done yet

- Studio, vault, portfolio and agents only picked up the new tokens; their layouts were not reworked.
- `/overlay/[slug]` was not restyled.
- Light theme tokens are defined but were not reviewed in screenshots.
