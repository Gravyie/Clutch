# Clutch — live prediction markets on streams

Clutch uses game observations to propose short markets, commits the rule before trading, locks before the observation window, and requires independent evidence for settlement. Missing or conflicting evidence must VOID rather than manufacture a result. Contracts use Uniswap v4 hooks on Base Sepolia.

**Deployment status: incomplete. Do not submit this document as a claim that the public product is live.**

## Verified infrastructure and contracts

- Backend hostname: https://api.rajatsrivastav.dev . Authoritative Name.com and Cloudflare DNS return `3.6.125.187`, TTL 300. This is the Elastic IP of EC2 `i-0cb7500b58c3d8e0e` in Mumbai.
- Caddy is running. Trusted public TLS verification passes and HTTP redirects with 308. `/health` currently returns **502** because the engine is stopped. API `/config` and WebSocket application access remain blocked.
- Production Docker image built locally and on Ubuntu 24.04 ARM64 EC2. Native dependencies, persisted SQLite recreation, readiness/CORS/WebSocket/shutdown fixture checks passed. 22 engine regressions and 7 secret-loader tests passed.
- Data directory `/srv/clutch/data` is on encrypted persistent EBS, mounted as `/app/engine/data`. No SQLite replacement or Arkiv migration.
- Intended environment hook: `0x574d0c676a9beab18963468dA010Ba16BB2fE888`. Default GitHub manifest remains intact for the distinct `0x6826872452e7Eea21D8a022E8533CEA0F4236888` deployment, which had 174 markets when audited.
- Agent/resolver `0xD1885548a9dF36d11FD66b6361aF814b8961a846`; pass signer `0xECA00909197A2487Fe807518ed1636E9A6659328`. Dedicated keys are in AWS Secrets Manager, with EC2 IAM restricted to their exact ARNs. EC2 recovered and verified their public addresses; deployed-image public role preflight passes. Owner key stays in the local encrypted Foundry keystore.

Confirmed Base Sepolia transactions (actual successful receipts and exact calldata verified):

- [Engine/resolver authorization](https://sepolia.basescan.org/tx/0xc6d8778abc3ec8d6d92964390a91c663b2a27aed1521234aa7aa6e3f79813c96)
- [Pass signer authorization](https://sepolia.basescan.org/tx/0xf437ddc8c9a0645a925bc49ff29cba37de396e7cc397cdddece73a91c02a4066)
- [Exactly 0.005 test ETH agent funding](https://sepolia.basescan.org/tx/0xf1029c44731eafdc78ece6edd668b7a367b9c329615de32fc8b6f2af2a4193c5)

## Genuine external-service evidence and blockers

0G: endpoint `https://router-api.0g.ai/v1`, model `claude-haiku-5.5`. Authenticated catalog returned 200 and lists this model and Reader B `0gm-1.0-35b-a3b`. Actual minimal inference returned 402, code `pay_insufficient_spendable`, message that spendable 0G Pay balance does not cover the request. Request ID `862c13100802ed05, 470195aa-c94e-4c0a-8bc9-c43210e274f6`. **No successful inference evidence exists for this run.** Runtime inference keys cannot read account balances; that requires management `account:read` scope or an authenticated dashboard. Mainnet Router and testnet/Direct accounts are separate; do not move funds, change keys or swap endpoints to conceal this failure. See [0G authentication](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/authentication) and [billing](https://docs.0g.ai/developer-hub/building-on-0g/compute-network/router/account/deposits).

Credential inventory source: `/Users/rajat/VScode/GitHub/Clutch/engine/.env`. Names found: `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`, `ZG_API_KEY`, `ZG_MODEL`, `ZG_ROUTER_URL`, `TWITCH_CLIENT_ID`, `TWITCH_CLIENT_SECRET`. No values are published here. World app ID has the expected prefix, but RP signing fails with `Invalid signing key: contains non-hex characters` even using Node's dotenv parser. Installed SDK expects a registered 32-byte hex signing key. Backend `AUTH_SECRET` is absent or unsuitable. Production enforces World configuration. Its starter-wallet flow is distinct from person verification; do not remove production checks or enable dev personas to get a demo running.

Real source checks: Lichess Blitz feed returned HTTP 200 and a `featured` event for game `0PSeIenK`. Twitch OAuth and Helix returned 200 and reported `emongg` live in Overwatch. These are source-access checks, **not** running production pipeline proof. Independent vision and eligibility remain required; streamer-controlled survival remains forbidden under current upstream policy.

Pools: intended hook has no registered prediction streams. Existing LP vault has 50,000 test USDC total assets and zero outstanding exposure. Prepared six unsigned owner transactions for separate `blitz` / `emongg` stream tokens, initialize, registerStream; total estimated execution gas 1,800,530, plus variable L1 fees. **Awaiting approval; none broadcast.** These are not the ETH/USDC top-up pool and do not redeploy core contracts. Predicted addresses depend on the current owner nonce and must be recomputed before signing.

Frontend: dedicated Vercel project `clutch`, ID `prj_Jb0XKjGCAg6sGzIZj9aKjGS5CYKy`, team `rajat-srivastavs-projects-9923da49`, Next.js, root `app/`, Node 22. Public API URL and chain 84532 configured. No production deployment exists yet. Domain `clutch.rajatsrivastav.dev` added in Vercel. Exact recommended Name.com record: CNAME host `clutch`, value `baea8ae4e1f3adc4.vercel-dns-017.com`, proposed TTL 300. Do not change DNS without its separate approval. The existing frontend has a USDC `back` flow compatible in ABI shape with the old router; its ETH fallback calls `backWithEth`, which the intended older router does not implement. Full wallet compatibility is unverified; no UI files have been changed.

## Demo and submission checklist

- [ ] Restore 0G Pay spendable balance with approved spending; save a successful real response ID, model, usage and sanitized evidence.
- [ ] Correct registered World RP signing key; approve/generate backend auth secret; securely install only required runtime settings; verify World proof flow.
- [ ] Approve/sign new prediction-pool setup; verify pool IDs, registry, vault caps and authorization.
- [ ] Start engine with secret loader and existing Compose setup; verify public 200 `/health`, `/ready`, `/config` and WS 101/subscription recovery.
- [ ] Observe genuine Lichess/Twitch data through production readers; no synthetic observations used as live evidence.
- [ ] Record real create → YES/NO trade → lock (late trade refused) → settle/VOID → claim/refund, with explorer links and wallet balances.
- [ ] Deploy reviewed frontend, verify USDC wallet flow and resolve ETH fallback incompatibility without overwriting redesign work.
- [ ] Approve/create the exact frontend CNAME; verify frontend HTTPS and API connection.
- [ ] Record a truthful demo video showing public URLs, real inference evidence and confirmed market transactions. No video has been recorded for this incomplete deployment.
- [ ] Fill final submission URL, repository commit, team details and actual hackathon requirements. Do not invent deadlines or claim unimplemented integrations.

Operational commands and the opt-in environment manifest are in `deploy/ec2/README.md`, `deploy/ec2/secrets/README.md` and `deploy/ec2/environments/rajat-testnet/README.md`.
