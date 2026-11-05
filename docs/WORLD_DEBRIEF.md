# World ID integration debrief

## The trust moment

A viewer is about to put money on a live outcome. Three things must be true, and none of them can be checked with a wallet:

1. **They are one person.** Daily caps and self-exclusion only work if a second wallet doesn't reset them.
2. **They are 18+.** Real-money prediction is age-restricted everywhere.
3. **They are not the streamer.** The person who can influence the outcome must not be able to trade it.

## The credential, and why it's the minimum

| Need | Credential | Why this and not more |
|---|---|---|
| One person | `passport({ signal: wallet })`: NFC passport chip, unique document holder | Gives an RP-scoped nullifier that limits and exclusion attach to. Proof of Human (Orb) would also work but has less reach; Selfie Check is medium assurance and too weak for money. |
| 18+ | Identity Check `minimum_age: 18` (preview, enabled per app by World) | Returns only "meets the requirement" (`identity_attested`). No birth date, name or document number reaches us. The passport preset alone does **not** prove age, so this is required for a real launch. |
| Not the streamer | Same nullifier, compared onchain | The streamer verifies once in the studio; their nullifier is stored on the stream and the gate refuses it. |

We store the nullifier and the wallets it has used. Nothing else.

## Flow

1. The app asks the engine for an RP context: `POST /pass/context`, where the server calls
   `signRequest({ signingKeyHex, action })`. The key never leaves the server.
2. The app opens `IDKitRequestWidget` with `preset: passport({ signal: sessionWallet })`.
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
