# Deploying Clutch

| Piece | What it is | Where |
|---|---|---|
| **App** (`app/`) | Next.js site | **Vercel** |
| **Engine** (`engine/`) | Long-running Node service: stream capture (ffmpeg + streamlink), 0G calls, market agent, resolver, API + WebSocket, SQLite | **AWS EC2**, Docker Compose + Caddy (HTTPS, WebSockets): the runbook is `deploy/ec2/README.md` (PR #2, with Secrets Manager on `codex/aws-secrets-integration`) |
| **Contracts** | Uniswap v4 hooks, router, gate, vault | Already on **Base Sepolia** (`contracts/deployments/84532.json`). Nothing to redeploy. |

Deploy the engine first (the app needs its URL), then the app, then point the providers at the app's domain.

## 1. Engine on AWS EC2

Follow `deploy/ec2/README.md`. Clutch-specific points the runbook depends on:

**Keys.** The production engine refuses the owner/deployer key. It runs with three separate testnet keys:

| Variable | Role | Needs |
|---|---|---|
| `AGENT_PRIVATE_KEY` | opens and settles markets (hook `engine` + `resolver`), pays winners | ~0.02 ETH gas |
| `PASS_SIGNER_PRIVATE_KEY` | signs trading passes (gate `signer`) | no ETH |
| `FAUCET_PRIVATE_KEY` | free test funds at sign-in: mints test USDC (open mint), sends a little gas | ETH: 0.0005 per new wallet |

All three live in `engine/.env.basesepolia.local` on the developer machine; put them in Secrets Manager, never in
the repo. The faucet wallet is `0x92fC5F007Ae633483bb1BCD502C56624e27934Ee` (funded with 0.03 ETH, about 60 new
users). **Without `FAUCET_PRIVATE_KEY`, sign-in can't fund new users and onboarding stalls.**

**Pools.** Registering a new market pool is owner-only onchain, so the hardened engine only runs channels that already
have a pool. Import the existing Base Sepolia pools with the runbook's `import-stream` step (no transactions).
Channels without a pool are skipped quietly.

**Other variables** (beyond the runbook's template):

```
CHAIN_ID=84532
RPC_URL=https://base-sepolia-rpc.publicnode.com   # sepolia.base.org caps eth_getLogs at 200 blocks
ZG_API_KEY=…  ZG_VISION_MODEL=claude-haiku-5.5  ZG_DAILY_CAP_USD=3
AI_ENABLED=0                                      # start with the AI off
ADMIN_TOKEN=<long random string>                  # remote AI on/off
TWITCH_CLIENT_ID=…  TWITCH_CLIENT_SECRET=…
WORLD_APP_ID=app_b75cfc24185b3dc51a24fdb77fda936c
WORLD_RP_ID=rp_309f1eb9e956b112
WORLD_RP_SIGNING_KEY=…                            # signer 0xCB5C7fBac4Bbbce6a2b79716EbeE80F0C716F220
WORLD_ENVIRONMENT=staging
APP_ORIGIN=https://<vercel-domain>                # CORS; comma-separate several
```

Check: `https://<engine-domain>/ready` → `{"ok":true,…}`, and `/config` shows `"world":{"configured":true,…}`.

## 2. App on Vercel

1. **Add New → Project** → import the repo. **Root Directory: `app`** (Vercel installs the pnpm workspace itself).
2. Environment variables:
   ```
   NEXT_PUBLIC_ENGINE_URL=https://<engine-domain>   # no trailing slash; wss:// is derived from it
   NEXT_PUBLIC_CHAIN_ID=84532
   NEXT_PUBLIC_RPC_URL=https://base-sepolia-rpc.publicnode.com
   NEXT_PUBLIC_PRIVY_APP_ID=cmw54nuzs01440gl34dx4lbdb
   ```
3. Deploy (`next build` passes locally with these values). Then set the engine's `APP_ORIGIN` to the Vercel domain
   and restart it.

## 3. Point the providers at the app's domain

| Provider | Where | Add |
|---|---|---|
| Privy | dashboard.privy.io → Clutch → Configuration → App settings → Domains | `https://<vercel-domain>` |
| Twitch | dev.twitch.tv/console/apps → app → OAuth Redirect URLs | `https://<vercel-domain>/twitch` |
| World, Google | nothing (World is verified server-side; Privy owns the Google app) | |

## 4. AI on for demos, off otherwise

```bash
ENGINE_URL=https://<engine-domain> ADMIN_TOKEN=<token> pnpm ai on       # status | off
```

Saved in the engine's database, so it survives restarts. If the 0G account has no balance, the engine pauses itself
(one warning, retries every 3 minutes) and the app says "0G out of credits".

## 5. End-to-end check on the deployed site

1. Sidebar lists live channels; with the AI on, markets open within a minute or two.
2. Sign in with email or Google → wallet, starter pass and $25 test USDC arrive → tap Yes on a market.
3. Free starter funds a second time → refused with a World ID prompt → verify (World App, or the simulator for
   `staging`) → the daily $100 works once.
4. Connect Twitch on a channel without followers-only chat and send a message.
5. A settled market's receipt (`/m/<id>`) shows both readers, 0G request IDs and the evidence root.

## Gas

`cast balance <address> --rpc-url https://sepolia.base.org -e` for the agent and faucet wallets; top up from a
Base Sepolia faucet (ethglobal.com/faucet) below ~0.005 ETH.
