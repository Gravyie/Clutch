# World ID integration debrief

## The trust moment

A viewer is about to put money on a live outcome, under a daily cap. Two things must be true, and neither can be checked with a wallet:

1. **They are one person.** Daily caps and self-exclusion only work if a second wallet doesn't reset them.
2. **They are not the streamer.** The person who can influence the outcome must not be able to trade it.

## The credential, and why it's the minimum

| Need | Credential | Why this and not more |
|---|---|---|
| One person | `proofOfHuman({ signal: wallet })` | Gives an action-scoped nullifier, unique per human, which is exactly what a per-person cap and exclusion attach to. Passport or Selfie Check would collect document or face-derived signals this decision doesn't need. |
| Not the streamer | Same nullifier, compared onchain | The streamer verifies once in the studio; their nullifier is stored on the stream and the gate refuses it. |
| 18+ (real-money launch only) | Identity Check `minimum_age: 18` (preview) | Clutch runs on test USDC, so age isn't part of this trust event yet. If World returns a negative age attestation we still refuse. A real-money launch would add Identity Check, and only that. |

We store the nullifier and the wallets it has used. Nothing else.

## Flow

1. The app asks the engine for an RP context: `POST /pass/context`, where the server calls
   `signRequest({ signingKeyHex, action })`. The key never leaves the server.
2. The app opens `IDKitRequestWidget` with `preset: proofOfHuman({ signal: sessionWallet })`.
3. `handleVerify` posts the result to `POST /pass/verify`. The engine checks the environment, forwards the result unchanged
   to `POST https://developer.world.org/api/v4/verify/{rp_id}`, and requires `success === true` and a matching environment.
4. The engine reads the on-chain exclusion list for that nullifier and refuses if the person is excluded.
5. The engine signs an EIP-712 `HumanPass { trader, nullifier, expiry, dailyCap }`, which lasts 6 hours by default.
6. Every trade carries the pass; `HumanPassGate.admit` verifies the signature, wallet binding, expiry, exclusion, the
   streamer bar and the daily cap, all keyed to the nullifier.

## Success and alternative paths (all demoable)

| Path | Where it's refused | What the user sees |
|---|---|---|
| Adult, first visit | (success) | Human pass chip; every trade is one tap after this |
| Under 18 | Engine, before any pass exists | "This credential doesn't meet the 18+ requirement, so trading is unavailable." |
| Self-excluded, then tries a new wallet | `HumanPassGate`: `SelfExcludedUntil` | "This human ID is excluded… A new wallet won't change that." |
| Streamer on own stream | `HumanPassGate`: `StreamerCannotTradeOwnMarket` | "You stream this channel, so you can't trade its markets." |
| Over daily cap | `HumanPassGate`: `DailyCapExceeded` | Limit meter full; resets 00:00 UTC |

Without World credentials configured, the app shows a **dev verifier** with four personas that exercise these same
paths, clearly labelled as dev in the UI and in the pass (`credential: "dev"`).

## What was hard / open questions for World

- **Age:** the passport preset proves a unique document holder, not age; age needs Identity Check (preview). We built
  for both and refuse when `identity_attested === false`.
- **Response shapes:** 3.0 vs 4.0 results carry the nullifier in different places (`nullifier` vs `responses[i]`).
  We handle both.
- **Session vs one-time proofs:** we use one-time proofs per session plus our own short-lived pass, so trades never wait
  on World App. A session proof (`createSession`) could replace the pass's expiry logic later.
