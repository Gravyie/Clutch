# Clutch — live prediction markets on streams

Clutch turns observed game events into short prediction markets. A rule hash is committed before trading, trading locks before the observation window, and independent observations determine settlement. Disagreement or missing evidence must VOID, including refunding fees.

## Public deployment

- Frontend: **https://clutch.rajatsrivastav.dev** — production Vercel deployment, HTTP200, actual live board/market data verified in browser.
- Backend: **https://api.rajatsrivastav.dev** — trusted Caddy HTTPS; HTTP308 redirect; `/health`, `/ready`, `/config` HTTP200.
- WebSocket: **wss://api.rajatsrivastav.dev/ws** — valid TLS, connection, global subscription and `hello` verified.
- Base Sepolia chain **84532**, intended ClutchHook **`0x574d0c676a9beab18963468dA010Ba16BB2fE888`**.
- Production backend image **`clutch-engine:rajat-22e0d8d`** on EC2 Ubuntu24.04 ARM64 in ap-south-1. Real Docker health status is **healthy**. Persistent SQLite/evidence are on encrypted EBS. [Exact operator commands](../deploy/ec2/environments/rajat-testnet/README.md).

This is a live testnet deployment with a verified funded-USDC backend lifecycle. ETH fallback, automatic guest funding, a real World user-proof test and a final recorded demo remain limitations; do not present those as completed.

## Genuine 0G evidence

A replacement, user-supplied local key produced HTTP200 from `https://router-api.0g.ai/v1`, model `claude-haiku-5.5`, request ID **`msg_011CgnLXrPRkkYmBiHeYaMPG`**, 32 input /16 completion tokens. [Sanitized response metadata](evidence/zero-g-inference.json).

The previous key failed with exact code `pay_insufficient_spendable`; no fake response or account-switch fallback was used. Authenticated catalog access returned200 and listed the configured main/Reader B models. An inference key cannot read numeric account balance; that requires management `account:read` scope or the dashboard. See [0G authentication](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/authentication) and [billing](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/account/deposits). No credit purchase was performed. Existing engine budget setting is $2/day; no automatic top-ups.

Production market9 also contains a real 0G decision/request ID in its committed-rule and public receipt data. Evidence remains local on persistent EBS; 0G Storage upload is not enabled or claimed.

## Real Base Sepolia lifecycle: market9

[Public receipt](https://clutch.rajatsrivastav.dev/m/9) · [independent chain verification](evidence/base-sepolia-market-9.json) · [actual source readings](evidence/market-9-receipt.json).

| Step | Verified evidence |
|---|---|
| Create | [Open transaction](https://sepolia.basescan.org/tx/0x3b534bc630dc03a386538940f2015bfa4cbc478a6c1dd17923ca6cf237e9de13); rule hash checked against the deployed hook |
| YES trade | [Exactly1 test USDC](https://sepolia.basescan.org/tx/0x53d392556225389777d1c588b228790c41a301571405b0aaf261dee49e8df805) |
| NO trade | [Exactly1 test USDC](https://sepolia.basescan.org/tx/0x8137024856c9c826c2cebcb935a0d8c9cd768d23bef58baa7698b48be0c0a0ca) |
| Lock | Runtime simulation rejected `MarketLocked`; independent historical `eth_call` at locked block55388531 reproduced that exact error before settlement, without broadcasting another trade |
| VOID | [Resolution transaction](https://sepolia.basescan.org/tx/0x207949d32bf4f67b23c9314c8d896a0e1753c045eb15f014b81a61cc5fc02e73) |
| Refund claim | [Confirmed claim](https://sepolia.basescan.org/tx/0x0c88c0b43db405e7cf369cb1d98d1aaa42f22f19e942a74bee08855fafdfcba1); exact2,000,000 USDC units returned, fees included; on-chain position marked claimed |

The genuine sources disagreed: Lichess TV evaluated YES, while the lagging REST export evaluated NO. VOID is the correct safeguard, not evidence of oracle agreement. The trader's balance returned to2 test USDC; test ETH fell from0.0002 to0.000196125427998252 due to gas. No additional funding was used. The test used a real backend wallet-starter pass, **not** a fabricated World proof. The trader key stayed in a local encrypted keystore; signing decrypted it only in local process memory with an interactive password prompt.

The operator separately approved exactly2 test USDC and0.0002 test ETH funding. [USDC transfer](https://sepolia.basescan.org/tx/0x8a586d32275de8411e9d7ec88329e0d582b51aaef03cba0033fa7f5fcfd1e965) · [gas transfer](https://sepolia.basescan.org/tx/0x57af49bf1792f516438c0f10342e1bd6deaec017147c732f638ef6427b63c912). Other live markets settled YES/NO without trades; those are not substitutes for this traded lifecycle.

## Contracts and pool setup

Owner `0x3750134287b3Fa078817ee2bAce1a69b372F3F8C` remains local. [Engine/resolver authorization](https://sepolia.basescan.org/tx/0xc6d8778abc3ec8d6d92964390a91c663b2a27aed1521234aa7aa6e3f79813c96), [pass-signer authorization](https://sepolia.basescan.org/tx/0xf437ddc8c9a0645a925bc49ff29cba37de396e7cc397cdddece73a91c02a4066), and [exact0.005 test ETH agent funding](https://sepolia.basescan.org/tx/0xf1029c44731eafdc78ece6edd668b7a367b9c329615de32fc8b6f2af2a4193c5) were independently verified. No repeated role/funding actions and no existing core contract redeployments.

Six separately approved transactions created two NEW StreamTokens, initialized distinct prediction pools and registered `blitz`/`emongg` with8s/10s buffers, owner as protocol payout and nullifier0. [All six receipt links and pool IDs](evidence/base-sepolia-pools.json). Existing vault was funded with50,000 test USDC; no extra LP deposit or vault modification. The prediction pools are not the ETH/USDC top-up pool. Both were imported into existing persistent SQLite without resetting data.

Default GitHub hook `0x6826872452e7Eea21D8a022E8533CEA0F4236888` is a separate real deployment with174 markets at audit time; its manifest and users were not overwritten. Core executable code matches after excluding compiler metadata/immutable addresses. Routers differ: the intended older router supports USDC `back`; the newer default router adds ETH/cross-chain methods. [Canonical decision and operational details](../deploy/ec2/environments/rajat-testnet/README.md).

## Task status

| Requested task | Status | Evidence / remaining condition |
|---|---|---|
| 1. Diagnose0G and run genuine inference | DONE | Exact402 cause identified; replacement key produced real200 and production market decisions; metadata above |
| 2. Secure World configuration | DONE (configuration) | Corrected local key passes SDK signing; public RP context is signed/non-dev; runtime transfer is encrypted/root-only. A real person's World proof remains unverified |
| 3. Stream prediction pools and LP/roles | DONE | All six approved transactions and registry buffers verified; real market open/VOID/claim worked |
| 4. DNS/HTTPS/API/WSS | DONE | Authoritative/public DNS, trusted TLS, API200, WSS subscription verified |
| 5. Production engine/IAM/EBS | DONE | Actual non-root healthcheck healthy; exact-ARN secret IAM; root0600 configuration under0700 directory; persistent data preserved through drained updates |
| 6. Lichess/Twitch and lifecycle | BLOCKED (remaining live Twitch proof) | Lichess full traded lifecycle passed. Twitch OAuth/Helix and prior real observations worked; emongg went offline before final registered-pool reader check. No live Twitch market is claimed;23 regressions cover deduplication/freshness/B verification and safety rules |
| 7. Vercel frontend and wallet compatibility | BLOCKED (remaining features) | Frontend is publicly deployed from reviewed main5155094, root app/, chain84532/API configured. Funded USDC router flow proven; ETH fallback unsupported by intended router, automatic guest faucet not configured, and actual UI-signed trade not tested. GitHub link failed due Vercel repository-integration access |
| 8. Preserve concurrent work / focused commits | DONE | Dedicated backend branch; no frontend source/CSS/layout edits, no force pushes, no reset of unrelated work; PR1 redesign is merged. Backend deployment PR2 is still open |
| 9. Submission README/demo/checklist | BLOCKED (recording/submission) | This README and genuine artifacts are prepared. Native recorder controls were unresponsive, then user stopped computer-use. No demo video was produced or submission sent |

## Security and validation

Credential source names only: `engine/.env` on the Mac supplied WORLD_APP_ID, WORLD_RP_ID, WORLD_RP_SIGNING_KEY, WORLD_ACTION, WORLD_ENVIRONMENT, ZG_API_KEY, ZG_MODEL, ZG_VISION_MODEL, ZG_ROUTER_URL, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET. Necessary settings were selectively encrypted for EC2; no whole .env copy, plaintext command arguments, image credentials or owner-key upload. AUTH_SECRET was generated on EC2 with approval. Agent/pass secrets and exact ARNs are in the [secret-loader runbook](../deploy/ec2/secrets/README.md).

Validated:23 engine regressions,7 secret-loader tests, typecheck, actual production Docker builds locally and on EC2, native packages, SQLite persistence/recreation, real non-root healthcheck execution, role checks without keys, owner-role rejection, readiness, CORS, WSS recovery, shutdown, Compose and Caddy. The final rollout paused new AI work, waited for zero unresolved markets, preserved the database, required Docker healthy, then re-enabled AI.

## Final submission checklist

- [x] Public API and frontend URLs, canonical hook and chain verified.
- [x] Genuine0G inference/model/request metadata published without keys.
- [x] Real create → YES/NO trade → lock → VOID → exact refund claim explorer links.
- [x] Tests/builds, least-privilege runtime and persistent SQLite documented.
- [ ] Recheck live emongg when online; do not force unsupported/steerable markets or use replay frames as fresh observations.
- [ ] Test a real user's World proof; sign-in context alone is insufficient proof.
- [ ] Have the UI developer resolve ETH/faucet capability presentation or obtain separate approval for new infrastructure/roles; preserve the redesign.
- [ ] Grant Vercel GitHub-app access to Gravyie/Clutch if automatic Git deployment is wanted; manual CLI deployment currently works.
- [ ] Record the public live app and receipt9/explorer evidence, excluding passwords/keys/terminals. No video artifact exists yet.
- [ ] Fill actual team/submission details and event-specific requirements; do not invent a submission URL, deadline or completed integration.
