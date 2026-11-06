# Rajat AWS testnet environment — explicit opt-in

This environment selects Base Sepolia hook `0x574d0c676a9beab18963468dA010Ba16BB2fE888` only for the new AWS backend. The repository default manifest remains unchanged. Never reuse an existing database from the other deployment.

Read-only audit at block 55363651 verified:
- Intended hook owner/engine/resolver `0x3750134287b3Fa078817ee2bAce1a69b372F3F8C`, gate signer same, marketCount 0.
- GitHub default hook `0x6826872452e7Eea21D8a022E8533CEA0F4236888`, owner `0x83e60BfbB74b20F1E1279e02F879594527D176da`, agent `0x5Fc7EC11Fac094DAAa7a75F0Eb52c035533A4E44`, signer `0x8Af096a0C69B9Dd514cAaf3B51D6d5D3685c57d8`, marketCount 174. It is a separate, used deployment, not obsolete.
- Both use PoolManager `0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408`; all associated components have code and hook component getters match each manifest.
- All 19 deployment receipts per environment succeeded. Intended hook creation: https://sepolia.basescan.org/tx/0xe214f2433ce3790d04667b9f9c2d2388544074a7a3fac21167571d41a8e5118d ; default hook creation: https://sepolia.basescan.org/tx/0xee0ce215f1e53d145ad593e96a9ed1ac0db337eb12ac5bb7effe7d0f8762c91b .
- Intended hook/gate/router runtime code matches the local Foundry artifacts after zeroing compiler-declared immutable references. Hook 20,258 bytes, gate 5,585 bytes, router 5,682 bytes. The newer default router is 10,935 bytes and adds ETH/signed cross-chain methods (`3323398`, `cdfa26e`); do not assume the current frontend's ETH betting flow works with the intended older router. USDC `back` remains the intended lifecycle path.
- Git history explains independent deployments: local manifest added in `abe9571`, upstream deployment recorded in `853205c`. No shared market migration is performed.

## AWS resources actually created

Region ap-south-1; instance `i-0cb7500b58c3d8e0e`, Ubuntu 24.04 ARM64 t4g.medium, standard CPU credits; Elastic IP `3.6.125.187`. Encrypted persistent 40 GiB gp3 volume `vol-0afe8c6d07e9e6b44`; data `/srv/clutch/data` owned by UID 1000. IMDSv2 required, SSM management, no SSH ingress, only 80/443 ingress. Bootstrap/image build completed successfully. Runtime remains STOPPED.

Verified dedicated Secrets Manager records (no owner key):
- Agent `arn:aws:secretsmanager:ap-south-1:136673894429:secret:clutch/testnet/agent-private-key-2qdcUi`, public `0xD1885548a9dF36d11FD66b6361aF814b8961a846`.
- Pass signer `arn:aws:secretsmanager:ap-south-1:136673894429:secret:clutch/testnet/pass-signer-private-key-Hc8WBl`, public `0xECA00909197A2487Fe807518ed1636E9A6659328`.

Keys were generated in memory, stored via SDK, retrieved in memory and verified by derived public address. No plaintext key files created. Neither role is authorized yet. Neither wallet funded. Existing owner remains local; planned encrypted keystore `~/.foundry/keystores/clutch-base-sepolia-owner` has NOT been verified to exist.

`role-transactions.UNSIGNED.json` contains reviewed-target calldata and successful read-only simulations. Re-estimate before signing. `configure` preserves treasury/gate/vault but revokes old engine/resolver privileges; `setSigner` invalidates old pass signatures. Explicit user approval and local owner signing are required; no transaction has been signed or broadcast.

## DNS and startup

Authoritative nameservers are Name.com (`ns1djs`, `ns2nsy`, `ns3gnv`, `ns4cgs`). Proposed `api` and `clutch` had no A records when inspected. Prepare `api A 3.6.125.187`, TTL 300; create only after DNS approval/authentication. Do not create a Route 53 hosted zone. Frontend CNAME must come from the actual selected Vercel project; no Clutch project has been verified in the current account yet. Do not overwrite apex or existing portfolio DNS.

After domain/role/credentials prerequisites are satisfied, run from the repository root:

```sh
# Host preparation and role-gated secret installation: follow ../../README.md and ../../secrets/README.md.
# Set IMAGE_TAG, ENGINE_ENV_FILE, CLUTCH_DATA_DIR, ENGINE_DOMAIN and ACME_EMAIL
# in a root-only /etc/clutch/compose.env (no wallet values in that file).
docker compose --env-file /etc/clutch/compose.env \
  -f deploy/ec2/compose.yaml \
  -f deploy/ec2/environments/rajat-testnet/compose.override.yaml build engine
# Run the public role check / production-check using that SAME selected image,
# then import approved existing stream pools before enabling ingestion.
docker compose --env-file /etc/clutch/compose.env \
  -f deploy/ec2/compose.yaml \
  -f deploy/ec2/environments/rajat-testnet/compose.override.yaml up -d
```

No engine host port is published. It listens within the isolated Docker network for Caddy; binding to 127.0.0.1 inside that container would prevent Caddy connecting. Host access is limited to HTTPS/WSS through Caddy. SSH is fully closed; use SSM.

Remaining gates: encrypted owner keystore import/address verification; approved role updates; approved agent gas funding; DNS approval/access; World verification configuration; approval to copy necessary existing 0G/Twitch credentials; existing stream registration/import; frontend router compatibility decision. Public health/config/WS, authentic inference and Base Sepolia create/trade/lock/settle/claim have NOT been verified for this environment. Do not label it live.

## Validation after environment integration

Actual local production Docker builds passed both with the default manifest and the opt-in intended manifest. The intended image's JSON was checked in a network-disabled container. Engine typecheck and 22 regression tests passed; 7 Secrets Manager integration tests passed. Full Docker fixture validation passed native dependencies, SQLite persistence/recreation, read-only filesystem, public-role checks without credentials, shared-owner rejection, readiness, CORS, WebSocket reconnection, shutdown, Compose and Caddy validation. These are local fixture checks, not public production lifecycle proof.

The earlier generation fixes are integrated with upstream AI pause/budget controls and its stricter ban on streamer-controlled survival markets retained. Regression lifecycle fixtures use team scores and prove YES/VOID evidence handling; they do not label survival or replay footage as a valid production market.

One authentic minimal 0G inference request returned HTTP 402 (request ID `41b1649868277945, 54fe76b5-aa30-457a-a3f1-fa0ca3de5502`); inference is NOT working/verified until billing/quota is restored. Existing World app ID/signing key are missing. Vercel CLI inspected all projects in `rajat-srivastavs-projects-9923da49`; no Clutch project was present. Subdomain A/AAAA/CNAME checks returned no records. DNS changes remain unapplied.

EC2 IAM has been tightened to `GetSecretValue` on the two exact secret ARNs above, replacing the planned-name ARN suffix patterns. No create/update/delete/list permission was added to the EC2 role.

Further read-only verification: after stripping compiler metadata and compiler-declared immutable references, the two deployments' hook/gate/vault/guard executable code matches. StreamRegistered logs were scanned from block 55316236 through 55366807 in 200-block ranges: the intended hook has NO registered streams. No existing stream pool can be imported; initial stream setup requires a separate reviewed owner transaction plan (do not redeploy core contracts).

EC2 built and verified image `clutch-engine:rajat-f231cd9` from pushed commit `f231cd9` with the opt-in intended manifest. SSM command `240fd162-d488-41cf-81b7-5b6aefe54fa8` succeeded and printed chain 84532 / hook `0x574d...E888`. Both EC2 status checks are OK. No containers are running, no runtime secret file has been installed, and no on-chain transaction has been broadcast. The real-chain public role preflight correctly rejects the new addresses before credential retrieval, since role updates remain unapproved/unexecuted.

Connect for authorized administration (no inbound SSH):

```sh
aws ssm start-session --region ap-south-1 --target i-0cb7500b58c3d8e0e
# On the host:
cd /opt/clutch/repo
sudo cat /opt/clutch/DEPLOYMENT_STATUS
sudo docker image inspect clutch-engine:rajat-f231cd9 --format '{{.Id}} {{.Architecture}}'
# Do not start Compose until the prerequisites above are complete.
```
