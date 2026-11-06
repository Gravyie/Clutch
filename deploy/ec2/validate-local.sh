#!/usr/bin/env bash
# Local-only Docker validation. No AWS calls, public-chain transactions, or real credentials.
set -euo pipefail
cd "$(dirname "$0")/../.."
CHECK_DIR=$(mktemp -d /tmp/clutch-container-check.XXXXXX)
CHECK_IMAGE=${CHECK_IMAGE:-clutch-engine:ec2-local}
mkdir "$CHECK_DIR/data"
cp contracts/deployments/84532.json "$CHECK_DIR/deployment.json"
chmod 0777 "$CHECK_DIR/data" # Disposable marker DB only; production host directory uses UID 1000 / 0750.
printf '%s\n' "Validation output: $CHECK_DIR"
docker build -f deploy/ec2/Dockerfile -t "$CHECK_IMAGE" . > "$CHECK_DIR/build.log" 2>&1
# Derive PUBLIC Anvil fixture accounts inside a network-disabled container. No user wallet/env file is read.
docker run --rm --network none --entrypoint node "$CHECK_IMAGE" --input-type=module -e '
import { mnemonicToAccount } from "viem/accounts";
const mnemonic="test test test test test test test test test test test junk";
for (const [name,addressIndex] of [["AGENT_PRIVATE_KEY",1],["PASS_SIGNER_PRIVATE_KEY",2]]) console.log(name+"="+mnemonicToAccount(mnemonic,{addressIndex}).getHdKey().privateKey.reduce((s,b)=>s+b.toString(16).padStart(2,"0"),"0x"));
' > "$CHECK_DIR/engine.env"
cat >> "$CHECK_DIR/engine.env" <<'EOF'
RPC_URL=https://example.invalid
ENGINE_PUBLIC_URL=https://engine.example.com
APP_ORIGIN=https://example.vercel.app
AUTH_SECRET=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa
HOUSE_CHANNELS=
VIDEO_CHANNELS=
WORLD_APP_ID=local-fixture
WORLD_RP_ID=local-fixture
WORLD_RP_SIGNING_KEY=local-fixture
EOF
chmod 0600 "$CHECK_DIR/engine.env"
openssl req -x509 -newkey rsa:2048 -nodes -keyout "$CHECK_DIR/tls.key" -out "$CHECK_DIR/tls.crt" \
  -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost > "$CHECK_DIR/openssl.log" 2>&1
chmod 0644 "$CHECK_DIR/tls.key" # Disposable localhost TLS fixture, not a deployment certificate.
for MODE in 0 1; do
  docker run --rm --network none --read-only --tmpfs /tmp:rw,size=64m -e SMOKE_READ_ONLY="$MODE" \
    -v "$CHECK_DIR/data:/app/engine/data" -v "$CHECK_DIR:/run/check:ro" \
    -v "$PWD/deploy/ec2/native-check.mjs:/app/engine/native-check.mjs:ro" \
    --entrypoint node "$CHECK_IMAGE" native-check.mjs > "$CHECK_DIR/native-$MODE.log" 2>&1
done
docker run --rm --network none --read-only --tmpfs /tmp:rw,size=64m --env-file "$CHECK_DIR/engine.env" \
  -v "$CHECK_DIR/data:/app/engine/data" -v "$CHECK_DIR:/run/check:ro" \
  -v "$PWD/deploy/ec2/container-check.mjs:/app/engine/container-check.mjs:ro" \
  --entrypoint node "$CHECK_IMAGE" container-check.mjs > "$CHECK_DIR/engine-check.log" 2>&1
cat > "$CHECK_DIR/compose.env" <<EOF
ENGINE_DOMAIN=engine.example.com
ACME_EMAIL=test@example.com
ENGINE_ENV_FILE=$CHECK_DIR/engine.env
CLUTCH_DATA_DIR=$CHECK_DIR/data
IMAGE_TAG=ec2-local
EOF
docker compose --env-file "$CHECK_DIR/compose.env" -f deploy/ec2/compose.yaml config --quiet
docker run --rm --network none -e ENGINE_DOMAIN=engine.example.com -e ACME_EMAIL=test@example.com \
  -v "$PWD/deploy/ec2/Caddyfile:/etc/caddy/Caddyfile:ro" \
  caddy:2.10.2-alpine caddy validate --config /etc/caddy/Caddyfile > "$CHECK_DIR/caddy.log" 2>&1
docker image inspect "$CHECK_IMAGE" --format '{{.Id}} {{.Architecture}}' > "$CHECK_DIR/image.txt"
printf '%s\n' 'Docker build, native dependencies, SQLite recreation, engine readiness/WSS/CORS, shutdown, Compose and Caddy checks passed.'
printf '%s\n' "Evidence: $CHECK_DIR"
