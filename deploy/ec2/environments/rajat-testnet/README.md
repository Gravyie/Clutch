# Applied Rajat Base Sepolia environment

Production image: `clutch-engine:rajat-22e0d8d`, built and verified on EC2. Backend source commit `22e0d8d` on `codex/aws-secrets-integration`. Documentation may advance beyond that image commit. No frontend files were modified by this deployment work.

- API: https://api.rajatsrivastav.dev ; `/health`, `/ready`, `/config`: verified 200.
- WebSocket: wss://api.rajatsrivastav.dev/ws ; valid TLS, application `hello` and subscription verified.
- Frontend: https://clutch.rajatsrivastav.dev ; verified 200 and actual live game/market data in browser.
- EC2: `YOUR_RESOURCE_ID`, Ubuntu 24.04 ARM64 t4g.medium, ap-south-1, standard CPU credits. Both instance checks OK. Elastic IP `3.6.125.187` is associated with this instance.
- Data: `/srv/clutch/data`, UID1000, encrypted 40-GiB gp3 volume `YOUR_RESOURCE_ID`, retained on instance termination. Bind mount `/app/engine/data`, SQLite `clutch-84532.db`, local evidence files. Caddy certificate/config volumes persist separately.
- Security: IMDSv2 required, SSM administration, no SSH ingress or host engine port. Only web ports 80/443 are public. Caddy connects to `engine:8787` inside Docker; binding that container to loopback would prevent proxy access.
- DNS: Name.com authoritative and Cloudflare resolvers verified `api A 3.6.125.187`, TTL300, and `clutch CNAME baea8ae4e1f3adc4.vercel-dns-017.com`, TTL300. No nameserver, apex, unrelated DNS or Route53 changes.

## Explicit deployment selection

This overlay selects existing hook `0x574d0c676a9beab18963468dA010Ba16BB2fE888` for this new AWS environment only. PoolManager `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`. Owner `0x3750134287b3Fa078817ee2bAce1a69b372F3F8C`; agent/resolver `0xD1885548a9dF36d11FD66b6361aF814b8961a846`; pass signer `0xECA00909197A2487Fe807518ed1636E9A6659328`.

The default repository manifest remains unchanged: its `0x6826872452e7Eea21D8a022E8533CEA0F4236888` hook is a separate real deployment, with 174 markets at audit block55363651. All 19 deployment receipts per environment succeeded. Hook/gate/vault/guard executable code matches after excluding compiler metadata and immutable values. Intended hook/gate/router match local Foundry artifacts after immutable normalization. Router versions differ: intended router is 5,682 bytes; newer default router 10,935 bytes adds ETH and signed cross-chain methods. Do not silently migrate databases or users between deployments.

Existing core contracts were not redeployed. Approved new StreamTokens/prediction pools were initialized and registered, and all six receipts/calldata/nonces verified. Pool IDs:

- Blitz: `0x07817c28b3b0f52bee34be30bd11fd49364d531df657c44825159013dbf23a25`, token `0x5CdE913f415982A4b02a7D1177013Aa525B566c6`, latency8s.
- Emongg: `0x2c9d44357c7b90d11c37395a41119702d24fa1fa7526813fa8599c43496ba7ac`, token `0xc495Ef6E79253cCFDb5F6852635D176A553cCc4B`, latency10s.

Both use owner as protocol payout address and nullifier0. Existing vault had 50,000 test USDC and zero exposure before testing. No extra LP deposit or vault modification. These pools are distinct from the ETH/USDC top-up pool. The guarded importer attached existing mappings to persistent SQLite, refusing to replace a different pool. Owner is not required on EC2.

## Exact operator commands

```sh
aws ssm start-session --region ap-south-1 --target YOUR_RESOURCE_ID
# On EC2:
sudo -i
cd /opt/clutch/repo
docker compose --env-file /etc/clutch/compose.env \
  -f deploy/ec2/compose.yaml \
  -f deploy/ec2/environments/rajat-testnet/compose.override.yaml ps
curl --fail https://api.rajatsrivastav.dev/health
curl --fail https://api.rajatsrivastav.dev/ready
```

`/etc/clutch/compose.env` has ENGINE_DOMAIN=api.rajatsrivastav.dev, ENGINE_ENV_FILE=/etc/clutch/engine.env, CLUTCH_DATA_DIR=/srv/clutch/data, IMAGE_TAG=rajat-22e0d8d. No wallet keys belong in it.

Before an update, build the reviewed image with the opt-in manifest:

```sh
docker build -f deploy/ec2/Dockerfile \
  --build-arg DEPLOYMENT_MANIFEST=deploy/ec2/environments/rajat-testnet/84532.json \
  -t clutch-engine:rajat-REVIEWED_COMMIT .
# Refresh runtime via ../../secrets/README.md only when required.
# Pause NEW AI work using the existing local operator endpoint:
docker exec ec2-engine-1 node --input-type=module -e \
 'const r=await fetch("http://127.0.0.1:8787/admin/ai",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({enabled:false})});if(!r.ok)process.exit(1);'
# Wait for existing trading/locked/window/resolving markets to settle.
# Verify zero such rows in SQLite before restarting; never reset the database.
# Set IMAGE_TAG to the reviewed built tag, then:
docker compose --env-file /etc/clutch/compose.env \
  -f deploy/ec2/compose.yaml \
  -f deploy/ec2/environments/rajat-testnet/compose.override.yaml up -d
docker inspect ec2-engine-1 --format '{{.State.Health.Status}}'
```

Require `healthy`, public readiness200 and correct `/config` hook before enabling AI again through the same operator endpoint with `enabled:true`. Draining prevents restarts from abandoning live markets. The actual final rollout drained to zero markets, preserved SQLite/evidence and verified the non-root healthcheck. Normal AI setting is persisted; configuration has $2/day inference cap. No automatic credit purchases.

Back up SQLite with its backup API or while the engine is stopped; do not copy an actively written database alone. Preserve evidence, runtime configuration permissions and Caddy volumes. Never `down -v`, delete the data directory or overwrite deployment manifests during restart.

## Evidence and remaining limits

See [the submission/evidence README](../../../../docs/ETHGLOBAL_README.md) for actual transaction links, model request IDs, tests and task statuses. Market9 proved genuine create → YES/NO trades → lock rejection → VOID → exact2-USDC refund claim. Reader disagreement caused the VOID; it was not disguised as agreement. Separate markets settled YES/NO without trades.

World configuration and local SDK signing plus public signed RP context are verified; an actual person's World proof has not been tested. The smoke test used the existing wallet-starter pass path, not a fabricated World proof. ETH fallback is incompatible with the older router; use pre-funded test USDC. Automatic guest faucet funding is not configured without an approved dedicated faucet wallet. Do not put the owner key on EC2 to fix it.

Frontend deployed unchanged from reviewed upstream main `5155094`. Vercel project `YOUR_VERCEL_PROJECT_ID`, root app/, Next.js, Node22; public engine URL and chain84532 set. GitHub repository linking failed due Vercel integration access; CLI deployment works, but automatic Git deployment is not configured. The account owner must grant Vercel access to Gravyie/Clutch before linking. No force push or branch overwrite occurred.
