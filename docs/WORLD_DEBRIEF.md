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

## Agent Pass (World IdP): authorizing a trading agent

**Trust event:** "let this agent trade with my identity". Thirty-second markets will be traded by agents. We allow
that, but only for an agent a verified person approved, inside that person's limits.

**Flow** ([`engine/src/agents.ts`](../engine/src/agents.ts), [`app/src/app/(app)/agents/page.tsx`](../app/src/app/(app)/agents/page.tsx)):
1. The signed-in, IDKit-verified human pastes the agent's wallet address and picks a cap. The engine starts an
   OIDC **device authorization** with the World IdP: `scope=openid`, `max_age=0` (a fresh check, not a remembered
   session), and an essential `acr` claim for Orb.
2. The app shows the QR / user code, and the human approves in World App.
3. The engine polls the token endpoint and handles `authorization_pending`, `slow_down`, `access_denied` (declined),
   `expired_token` (expired) and `unmet_authentication_requirements`.
4. On success it validates the ID token itself: JWKS signature, `iss`, `aud`, expiry, `acr` in the accepted list,
   and `auth_time` no older than the attempt. The pairwise `sub` is bound to the person's IDKit nullifier on first
   use. A different World ID account can't authorize agents for the same person, and one account can't serve two
   Clutch accounts.
5. **Protected action:** the engine signs a `HumanPass` for the *agent's* wallet carrying the *human's* nullifier.
   `HumanPassGate` keys the daily cap by nullifier, so the agent and the human share one onchain budget.
6. Agent passes last 1 hour and are re-signed while the 24-hour grant is active. Revoking stops renewal, and raising
   the cap or renewing after 24 hours is a new World ID approval.

**Denied paths (all issue nothing):** declined in World App, code expired, non-Orb account, stale `auth_time`,
a token that fails validation, a World ID linked to someone else, or a revoked or expired grant (the agent's next
pass fetch is refused).

**Honest limits:** IDKit nullifiers and IdP subjects are different identifiers. We link them trust-on-first-use
inside the verified human's signed-in session, which is as strong as that session. On a local chain without IdP
credentials, a labelled dev approval stands in for World App so the rest of the flow can be exercised.

**Friction:** the device grant was the right fit (the human approves on their phone while the agent runs headless),
but the docs only list it in the getting-started table. A worked device-flow example with the exact error codes
would have saved time. We also couldn't find whether `sub` is per-app pairwise or per-human from the docs alone;
the discovery document says `pairwise`.
