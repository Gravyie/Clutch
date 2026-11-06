# Deploying Clutch

Two pieces, deployed separately:

| Piece | What it is | Where | Why there |
|---|---|---|---|
| **App** (`app/`) | Next.js site | **Vercel** | Static + client app, no server state |
| **Engine** (`engine/`) | Long-running Node service: captures streams (ffmpeg + streamlink), calls 0G, opens and settles markets, API + WebSocket, SQLite | **Railway** (or Fly/Render, any Docker host with a volume) | Must run 24/7, keep WebSockets open, write to disk. Vercel functions can't. |

The contracts are already on **Base Sepolia** (`contracts/deployments/84532.json`); nothing to redeploy.

## 1. Engine on Railway (about 10 minutes)

1. Sign in at **railway.com** with GitHub → **New project** → **Deploy from GitHub repo** → `Gravyie/Clutch`.
2. Railway finds the root `Dockerfile` and builds it. Leave the root directory as `/`.
3. **Volume:** service → **Settings → Volumes → Add volume**, mount path `/data`. (The database and evidence live
   here; without it every redeploy forgets markets.)
4. **Networking:** **Settings → Networking → Generate domain**. Note it, e.g. `https://clutch-engine.up.railway.app`.
5. **Variables** (service → **Variables**, use *Raw editor*). Copy the values from your local `engine/.env` and
   `engine/.env.basesepolia.local`; never commit them.

   ```
   CHAIN_ID=84532
   RPC_URL=https://base-sepolia-rpc.publicnode.com
   OWNER_PRIVATE_KEY=…
   AGENT_PRIVATE_KEY=…
   PASS_SIGNER_PRIVATE_KEY=…
   ZG_STORAGE_PRIVATE_KEY=…
   ZG_API_KEY=…
   ZG_VISION_MODEL=claude-haiku-5.5
   ZG_DAILY_CAP_USD=3
   AI_ENABLED=0                      # start with the AI off; turn on for the demo (step 4)
   TWITCH_CLIENT_ID=…
   TWITCH_CLIENT_SECRET=…
   WORLD_APP_ID=app_b75cfc24185b3dc51a24fdb77fda936c
   WORLD_RP_ID=rp_309f1eb9e956b112
   WORLD_RP_SIGNING_KEY=…
   WORLD_ENVIRONMENT=staging
   APP_ORIGIN=https://<your-vercel-domain>   # fill in after step 2; comma-separate several
   ADMIN_TOKEN=<a long random string>        # lets you switch the AI on/off remotely
   ```
6. Deploy, then open `https://<engine-domain>/health` → `{"ok":true,"chainId":84532}`.

## 2. App on Vercel (about 5 minutes)

1. **vercel.com → Add New → Project** → import `Gravyie/Clutch`.
2. **Root Directory:** `app`. Framework: Next.js (detected). Vercel installs the pnpm workspace from the repo root
   by itself.
3. **Environment variables:**
   ```
   NEXT_PUBLIC_ENGINE_URL=https://<engine-domain>      # no trailing slash
   NEXT_PUBLIC_CHAIN_ID=84532
   NEXT_PUBLIC_RPC_URL=https://base-sepolia-rpc.publicnode.com
   NEXT_PUBLIC_PRIVY_APP_ID=cmw54nuzs01440gl34dx4lbdb
   ```
4. **Deploy.** Note the domain, e.g. `https://clutch-xyz.vercel.app`.
5. Back on Railway, set `APP_ORIGIN` to that domain (CORS) and redeploy the engine.

## 3. Point the providers at the new domain

| Provider | Where | Add |
|---|---|---|
| **Privy** | dashboard.privy.io → Clutch → *Configuration → App settings → Domains* | `https://<vercel-domain>` |
| **Twitch** | dev.twitch.tv/console/apps → your app → *OAuth Redirect URLs* | `https://<vercel-domain>/twitch` |
| **World** | nothing to change (the engine signs and verifies server-side) | |
| **Google** | nothing (Privy handles the Google OAuth app) | |

## 4. Turn the AI on for the demo, off after

The engine starts with the AI off (`AI_ENABLED=0`) so it spends no 0G credits. From your machine:

```bash
ENGINE_URL=https://<engine-domain> ADMIN_TOKEN=<token> pnpm ai on      # before the demo
ENGINE_URL=https://<engine-domain> ADMIN_TOKEN=<token> pnpm ai status
ENGINE_URL=https://<engine-domain> ADMIN_TOKEN=<token> pnpm ai off     # after
```

The switch is saved in the engine's database, so it survives restarts and redeploys.

## 5. Check it end to end

1. `https://<engine-domain>/config` shows `"world":{"configured":true,…}`.
2. Open the Vercel site: the sidebar shows live channels; with the AI on, markets appear within a minute or two.
3. Sign in with email or Google → a wallet, a starter pass and $25 land → tap Yes on a market.
4. Verify with World ID (World App, or the simulator for `staging`) → the daily $100 refill works once.
5. Connect Twitch on a channel without followers-only chat (the panel says when a channel restricts chat) and send
   a message.

## Notes

- **Keys on a host:** the owner, agent and pass-signer keys are testnet keys generated for this project. For a
  mainnet deployment, move them to a secret manager or KMS and give the agent key only the roles it needs.
- **Gas:** the owner wallet pays gas for new channels, free test funds and settlement. Check it with
  `cast balance 0x83e60BfbB74b20F1E1279e02F879594527D176da --rpc-url https://sepolia.base.org -e` and top it up
  from a Base Sepolia faucet when it drops below ~0.02 ETH.
- **Cost:** Railway's trial credit covers a hackathon; the engine idles at low CPU with the AI off.
