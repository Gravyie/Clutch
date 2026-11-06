# Clutch engine on EC2 / Base Sepolia

This configuration runs one engine replica on Ubuntu 24.04, with SQLite and evidence on an EBS-backed host directory, Caddy for HTTPS/WSS, and the unchanged frontend on Vercel. Do not scale the engine horizontally against this SQLite file. No Terraform, AWS resources, DNS changes or public-chain transactions are performed by these files.

## Local validation

Run `bash deploy/ec2/validate-local.sh` from a machine with Docker and OpenSSL. It performs the real image build, native SQLite/sharp/evidence checks, recreation/persistence check, and starts the bundled engine against a **local TLS RPC fixture** with all networking disabled. It verifies health/readiness, manifest, CORS, WebSocket resubscription and shutdown, then validates Compose and Caddy. It uses public disposable fixture accounts, reads no user environment file, and signs/broadcasts zero transactions. Output is retained under a unique `/tmp/clutch-container-check.*` directory. This validates container integration; it does not claim real Base Sepolia role changes, public TLS issuance or a public-chain market cycle.

The engine unit suite is `pnpm --filter @clutch/engine test`; TypeScript is `pnpm --filter @clutch/engine typecheck`. The Docker builder runs the TypeScript check and actual ESM build. Runtime modules were validated on Linux arm64 locally; build on your EC2 host for its architecture.

## Deployment blockers to resolve before public startup

The checkout's `contracts/deployments/84532.json` is retained unchanged and must be confirmed as the intended deployment before any cloud or on-chain action. It currently records:

- Chain: **84532 (Base Sepolia)**
- ClutchHook: `0x6826872452e7Eea21D8a022E8533CEA0F4236888`
- Router: `0x1B1F8484a4d2D54fFAAC2Ee9AAFb5B2F77352959`
- USDC test asset: `0x7942bc2E19a89f4544638C1A0f8E4792b0da00F0`
- HumanPassGate: `0xb5cc8d4f0A9d81BE6ff704d0eBd48cf382eee5f2`
- LPVault: `0xb7dccDbeA0A05CaF3804382eaB824379F1615319`

The operator reports that the intended contracts still authorize `0x3750134287b3Fa078817ee2bAce1a69b372F3F8C` as owner, agent and pass signer; dedicated keys have not been created. The current checkout retains main's recorded manifest, which differs from that report and must be confirmed as the canonical deployment before proceeding. Do not rewrite addresses or reuse the owner key to get past startup checks. The runtime checks actual on-chain getters and deliberately rejects a shared owner/runtime configuration.

See [the planned Secrets Manager integration](secrets/README.md) for the two exact planned secret names, read-only IAM policy, approval boundaries and public-role verification before key retrieval. No secret record, ARN, hostname or private-key file is assumed to exist.

The existing contracts permit role separation without redeployment: the owner calls `ClutchHook.configure(engine,resolver,treasury,gate,vault)` and `HumanPassGate.setSigner(signer)`. This engine uses one dedicated agent for engine+resolver and another key for pass signing. Creating/importing an unrelated third resolver key is not supported by this runtime. Generate dedicated keys securely, fund the agent with only the gas it needs, and sign the configuration transactions from an offline admin machine. The pass signer needs no gas. These actions require owner approval and have **not** been executed here.

No owner transaction should be run until the operator confirms the canonical contracts and approves the new public addresses. Then use the existing contracts' configuration/setter functions from an offline owner wallet while preserving the current treasury, gate and vault. This preparation does not authorize roles or deploy contracts.

Public production startup also requires World verification configuration; it fails closed rather than exposing the existing development pass issuer. Configure a valid World staging setup for Base Sepolia testing. Existing role changes invalidate previously issued passes; users obtain fresh passes.

No owner key is required by the service. Owner-only pool creation, faucet and protocol pause actions are disabled without it. Streamer-authorized pauses remain governed by the existing contracts. Automatic registration of new stream pools needs the separate admin workflow and must not be enabled by putting an owner key into the container. Start from an existing **84532** engine database or import already registered pools as described below. An empty database with empty channel lists starts with zero markets; a healthy service is not proof of a market lifecycle.

## Image and workspace behavior

There was no existing Docker/Compose setup. `engine` and `@clutch/shared` originally expose TypeScript directly and had no JavaScript build. `engine/build.mjs` now bundles the engine and shared source with esbuild, leaving runtime dependencies external. The builder installs only the engine workspace dependency graph, checks TypeScript, emits ESM for Node 22, and uses pnpm's production deployment output. The runtime contains native Linux dependencies, ffmpeg and Streamlink 8.6.3 (matching the locally used capture version), and runs as UID/GID 1000. The allowlisted Docker context excludes all `.env` files, frontend files, databases, Git metadata and broadcast logs. No key is a build argument or image layer.

SQLite defaults to `engine/data/clutch-84532.db`; Compose explicitly sets `DATABASE_URL=file:/app/engine/data/clutch-84532.db` and `DATA_DIR=/app/engine/data`. Evidence and frame files live under that directory. The server binds `0.0.0.0:8787` **inside** Docker. Only Caddy publishes ports; engine port 8787 has no host mapping. Caddy passes `/ws` upgrades automatically; do not rewrite the `/ws` path.

## Prepare an existing EC2 Ubuntu 24.04 host

These commands are instructions for an approved host; they were not run against AWS. Arrange the EBS volume and mount beforehand. Do not format an existing volume. Verify `/srv/clutch` is on the intended persistent EBS filesystem with `findmnt -T /srv/clutch`. An EBS-backed root filesystem also qualifies, provided its lifetime/backups meet your needs. Deleting an EC2 instance can delete its root EBS volume depending on its configured policy.

Install Docker from its official apt repository:

```sh
sudo apt-get update
sudo apt-get install -y ca-certificates curl git openssl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
. /etc/os-release
printf 'Types: deb\nURIs: https://download.docker.com/linux/ubuntu\nSuites: %s\nComponents: stable\nArchitectures: %s\nSigned-By: /etc/apt/keyrings/docker.asc\n' \
  "$VERSION_CODENAME" "$(dpkg --print-architecture)" | sudo tee /etc/apt/sources.list.d/docker.sources >/dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Use Compose v2.24+ (the configuration uses required env-file support). Choose an EC2 architecture matching your image build, or build on the EC2 host itself. The local build records its tested platform in the validation report. Do not copy macOS `node_modules` onto Linux.

Check out the reviewed deployment commit (substitute your reviewed branch/ref; don't overwrite the UI developer's checkout):

```sh
sudo install -d -o "$USER" -g "$USER" /opt/clutch
git clone https://github.com/Gravyie/Clutch.git /opt/clutch/repo
cd /opt/clutch/repo
git checkout YOUR_REVIEWED_DEPLOYMENT_COMMIT
test -f contracts/deployments/84532.json
sudo install -d -m 0750 /etc/clutch
sudo install -d -o 1000 -g 1000 -m 0750 /srv/clutch/data
sudo install -m 0600 deploy/ec2/engine.env.example /etc/clutch/engine.env
sudoedit /etc/clutch/engine.env
```

The current main-branch 84532 manifest is retained unchanged; this PR does not modify deployment addresses or regenerate ABIs. Never use `scripts/dev.sh` or `deploy-local.sh` for EC2: they are local development workflows and can deploy contracts/delete local state.

Set a unique `AUTH_SECRET` (generate with `openssl rand -hex 32`), HTTPS RPC, dedicated agent/pass keys, World settings, API domain, exact Vercel/custom origins, and 0G inference settings in `/etc/clutch/engine.env`. Keep the populated file root-readable only and out of Git, shell history, build context and screenshots. It is injected at container creation, not baked into the image. Leave `ZG_STORAGE_PRIVATE_KEY` empty unless separately authorized to upload/spend on 0G Storage.

Configure Compose's non-secret host settings:

```sh
cd /opt/clutch/repo
cp deploy/ec2/compose.env.example deploy/ec2/compose.env
${EDITOR:-vi} deploy/ec2/compose.env
# ENGINE_DOMAIN=your API hostname; ACME_EMAIL=your email; set IMAGE_TAG to the reviewed commit.
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml config --quiet
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml build --pull engine
# Read-only role/address/chain preflight; this does not start runners or send transactions.
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml run --rm --no-deps engine node dist/production-check.mjs
```

Do not print `docker compose config` without `--quiet`: the rendered output can include env-file secrets. Do not scale this service beyond one replica.

## Existing stream metadata

If restoring a database, use a clean, stopped-engine backup from the same deployment and chain. Do not restore `clutch-31337.db` into this Base Sepolia runtime. Keep `clutch-84532.db` and any SQLite WAL/SHM files together if the source was not cleanly stopped. Prefer a stopped copy or SQLite online backup API.

To import a pool already registered on the existing hook, make `/etc/clutch/stream.json` with its real `slug`, `title`, `platform` (`twitch`/`kick`/`youtube`), `channel`, `category`, `poolId`, `token`, `currency0` and `currency1`. Currency ordering must match its actual v4 pool. The importer checks the pool hash and registered on-chain metadata, refuses an active unreconciled market, and writes only SQLite. It sends zero transactions and deploys nothing. Run before the engine starts:

```sh
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml run --rm --no-deps \
  -v /etc/clutch/stream.json:/run/stream.json:ro engine node dist/import-stream.mjs /run/stream.json
```

With a prepared database, keep `HOUSE_CHANNELS`/`VIDEO_CHANNELS` empty to avoid owner-only seeding. Existing enabled rows are loaded regardless of these lists. Empty category/unreadable gameplay safely produces no market. Configure Twitch discovery only after understanding that registering new pools remains an admin operation outside this owner-free service.

## Start and verify HTTPS/WSS

After approval, point the API hostname to this host and allow inbound TCP 80/443 (and optionally UDP 443 for HTTP/3) in the EC2 security group. Restrict SSH to your management network. Do not open 8787, SQLite, Docker's daemon, or Caddy's admin port. Docker-published ports can bypass UFW rules; this configuration publishes only Caddy. No AWS or DNS changes were performed by this task.

```sh
cd /opt/clutch/repo
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml up -d --wait
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml ps
curl --fail https://YOUR_ENGINE_DOMAIN/health
curl --fail https://YOUR_ENGINE_DOMAIN/ready
curl --fail https://YOUR_ENGINE_DOMAIN/config
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml logs --tail=100 engine caddy
```

`/health` is process liveness. `/ready` verifies RPC chain ID, a chain head within 180 seconds, and SQLite readability, returning 503 on dependency failure. Docker health checks use `/ready`; no public RPC signing occurs there. An unhealthy Docker status alone does not restart a running container; `unless-stopped` restarts exited containers. Monitor health externally and investigate before restarting.

Set Vercel's `NEXT_PUBLIC_ENGINE_URL=https://YOUR_ENGINE_DOMAIN` **and `NEXT_PUBLIC_CHAIN_ID=84532`**, then redeploy the frontend through its owner. The frontend defaults to local chain 31337 if the chain variable is omitted. Optionally set `NEXT_PUBLIC_RPC_URL` to a browser-safe Base Sepolia RPC; never expose the backend's private RPC credentials through a `NEXT_PUBLIC_*` variable. These are frontend environment instructions, not component changes. `APP_ORIGIN` on the engine must include the exact frontend origin. Connect to `wss://YOUR_ENGINE_DOMAIN/ws`, send `{"type":"sub","channels":["global","stream:YOUR_SLUG"]}`, and verify `hello`, stream and current-market recovery after reconnect. Caddy provides automatic HTTPS and WebSocket upgrades.

## Restart, update, backup and rollback

Prefer a quiet period with no trading/window markets (`GET /markets?open=1`). Restarting during a video market follows the existing safe VOID/refund recovery path; users must be told about planned downtime. SIGTERM stops source runners and exits, while state stays on EBS.

```sh
cd /opt/clutch/repo
# Restart the same container; this does not reload an edited env file.
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml restart engine
# After env/image changes, recreate to apply them:
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml up -d --force-recreate --wait engine
# Consistent stopped backup (protect this archive; it contains application/auth state):
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml stop engine
sudo tar --numeric-owner -C /srv/clutch -czf /srv/clutch/backup-$(date -u +%Y%m%dT%H%M%SZ).tgz data
sudo docker compose --env-file deploy/ec2/compose.env -f deploy/ec2/compose.yaml up -d --wait engine
```

For updates, preserve/tag the previous image, check out the reviewed new commit, build, preflight, then `up -d --wait`. To roll back, select the saved previous `IMAGE_TAG` and use `up -d --no-build --wait`; verify database compatibility before any restore. Do not restore stale market state over current on-chain state without reconciliation. Never use `down -v` casually: Caddy certificate/account state is in named volumes. Stop and snapshot/copy EBS state before major upgrades. Keep backups outside the instance through your separately approved backup process.

## Market lifecycle smoke test (requires explicit transaction approval)

No Base Sepolia creation/trade/settlement transaction was sent during this preparation. Execute the following only with approved amounts, funded dedicated agent and a separate test trader; use the existing deployed test USDC, never production assets.

1. Verify `/config` reports 84532 and matches the reviewed manifest. Confirm `/ready` and separated runtime roles. Pick an enabled existing registered channel with sufficient LP-vault idle funds and independent reader evidence. A no-market reason is a valid refusal, not a smoke-test pass.
2. Subscribe over WSS to global + channel. Wait for a backend-confirmed `market` in `trading`, or use the existing authenticated/viewer-funded market-call flow with approved 0G credits. Record market ID, rule hash, question, open transaction, 0G request ID, lock and window timestamps. Fetch `GET /markets/ID`; verify the open receipt has status 1 on Base Sepolia.
3. Obtain a World staging pass for a trader distinct from the streamer. Approve only a small, approved test-USDC amount to the deployed router. Submit one YES and one NO purchase through `ClutchRouter.back(poolKey,id,yes,amount,minShares,gateData)`. Record both hashes and `Backed` events. Use nonzero slippage bounds from the current quote. Verify both were mined strictly before lock; never use an owner's wallet as the public smoke trader.
4. Observe `market.phase=locked`, then `window`. Verify a post-lock trade **simulation** reverts; don't spend gas on an expected failure on a public network. The local disposable test used a real reverted transaction to prove this path.
5. Wait for deterministic reader agreement or safe VOID. Record `MarketResolved`, resolution transaction, backend receipt, evidence root, stored evidence bundle and both reader request IDs. `GET /receipts/ID` must match the on-chain outcome. A suppressed error message or a UI card alone does not pass this step.
6. Read the trader's on-chain `positions(id,address)`. Claim winning shares through `ClutchHook.claim(id,address)`, or claim each full cost refund on VOID. Verify the `Claimed` event and exact test-USDC balance delta. Losers have zero entitlement and should not submit a claim. Confirm vault outstanding funding returns to its prior level and the backend's receipt/history survives an engine recreation with the same EBS data.
7. Disconnect/reconnect WSS and verify the same current/final market is recovered without a new submission. Save hashes, block timestamps, balances and evidence for review. Stop if roles, source freshness or contract addresses disagree.

Separate earlier backend validation (not a Docker or public-network test) used captured image bytes with **synthetic observation fixtures**, not live 0G outcome evidence. It executed creation, YES and NO trades, a real MarketLocked revert, VOID, and both 10-USDC refunds on a disposable Anvil/Uniswap v4 deployment. Live emongg capture was attempted separately and correctly refused menu/mixed-game screens. Its artifacts remain under `/tmp/clutch-isolated-ho7jm4ce`; that process is stopped. This is local backend/contract evidence, not a public-network smoke-test claim.

## References

- Docker's Ubuntu installation procedure: https://docs.docker.com/engine/install/ubuntu/
- pnpm production workspace deployment: https://pnpm.io/10.x/cli/deploy
- Caddy HTTPS/WebSocket proxy behavior: https://caddyserver.com/docs/caddyfile/directives/reverse_proxy
