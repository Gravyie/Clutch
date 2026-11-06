# Clutch UI redesign: visual review log

Screenshots live in `design/iterations/` (`baseline`, `r1` to `r6`, `final`). Re-shoot any time with
`node app/e2e/design-shots.mjs <outDir> @trading:watch /browse:browse ...` (`@trading` picks a channel whose market is open
right now; `VP=390x844,768x1024,1440x900,1920x1080` by default; it prints `OVERFLOW` for any element wider than the viewport).

## Reference principle → Clutch use

| Reference trait (Fomo, observed) | What it does for Clutch | Where |
|---|---|---|
| Near-black, few elevations, hairline borders | Calm stage so the stream and the question carry the colour | `globals.css` tokens (`.dark`) |
| One decisive action column beside a big focal area | Stream/board left, one prediction rail right | `/c/[slug]` grid, `RoundPanel` |
| Dense, scannable lists | Activity feed, recent results, receipts | `Moments`, `RecentRounds`, `/m/[id]` |
| Focused modal for funding | Existing wallet sheet / onboarding kept as is | `wallet-sheet.tsx`, `onboarding.tsx` |
| Not copied | Token sidebar, candles, market-cap tables, blue accent, Aeonik, logo, QR | — |

Palette and type are original Clutch proposals (signal-lime brand, mint YES, coral NO, warm-red LIVE, amber LOCKED,
info-blue VERIFIED/checking, muted VOID; Geist + Geist Mono). Nothing from Fomo's CSS, fonts or assets is used.

## Baseline failures (before)

1. Desktop watch page: the market card was below the fold; the right rail showed only "Recent trades".
2. Mobile watch page: the chess board filled the screen; the question started at the very bottom.
3. Persistent left channel rail took 240px from the stream on every page.
4. Copy claimed "two independent readers settle it in seconds" (overclaims independence and speed).

## Round 1 → fixes

- Bottom player strip clipped at 900px tall → board capped to the viewport height.
- Duplicate LIVE / viewer chips on the board → removed from the watch page (header shows them).
- "0:00 left" after the window ended → now "Window over · waiting for the result".
- Flat empty price chart on markets with zero trades → hidden, with a plain sentence on the receipt page instead.
- Question off-screen on phones → slim sticky Yes/No dock that scrolls to the card (only while trading and the card is out of view).
- Tabs stretched full width; "Call one" box cramped in the rail → fixed.

## Round 2 → fixes

- Activity feed too airy on mobile → compact one-line rows in a card.
- Replay channel labelled LIVE → REPLAY badge.

## Rounds 3 to 6 (other routes)

- Receipt rail said "Settled · Winner" on a voided market → "Voided" / "Resolved YES|NO", template named as such.
- Explore: cards overflowed a 390px viewport (implicit grid column grew to long titles) → `grid-cols-1` + `min-w-0`; also on /live.
- Explore: chess card taller than video cards → 16:9 thumbnail; offline channels no longer show "AI watching"; locked markets say "Locked" instead of a price.
- Tablet: board ~700px tall pushed the question away → board capped at 32rem below `xl`.
- Signed-out Account page was a bare sentence → explained empty state with testnet / no-seed-phrase note.

Final pass: no element overflow at 390, 768, 1440 or 1920 on watch, explore, live, portfolio, account and receipt.

## Round 7–8: sidebar back, prebuilt components

Owner feedback: bring back the left sidebar; hand-made boxes and buttons don't feel polished, use prebuilt components.

- Added shadcn/ui (new-york, already configured in `components.json`) prebuilt parts: Sidebar, Card, Item, Empty,
  Toggle Group, Progress, Collapsible, Kbd, Spinner, Sheet, Field. The CLI rewrote the `cn` import to an unrelated npm
  package called `cn` and added lucide; both were removed (imports point at `@/lib/utils`, icons are Phosphor).
- Shell: shadcn `Sidebar` (logo, nav, live channels with LIVE dot and Yes price / viewers, AI-engine footer). Collapses to
  an icon rail on desktop (⌘B or the toggle), and slides out as a sheet on phones; bottom tabs stay on phones.
- Moment card: Card + Badge status + ToggleGroup stake + Button Yes/No + Progress + Collapsible "Why this market?".
  Empty state, results, activity, past markets, integrity and position use Empty / Item / Card.
- Fixed: hydration mismatch from shadcn's `SidebarMenuSkeleton` (random width → id-derived width); price badges
  overlapping channel subtitles; countdown ring squeezing the question.
