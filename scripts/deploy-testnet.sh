#!/usr/bin/env bash
# Deploy Clutch to a public testnet using the keys in engine/.env.<net>.local (never committed).
#   bash scripts/deploy-testnet.sh basesepolia     # Base Sepolia (Relay testnet supports it)
#   bash scripts/deploy-testnet.sh unichain        # Unichain Sepolia
set -euo pipefail
NET="${1:-basesepolia}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ENVF="$ROOT/engine/.env.$NET.local"
[ -f "$ENVF" ] || { echo "missing $ENVF"; exit 1; }
set -a; source "$ENVF"; set +a
case "$CHAIN_ID" in
  84532) export POOL_MANAGER=0x05E73354cFDd6745C338b50BcFDfA3Aa6fA03408 ;;
  1301)  export POOL_MANAGER=0x00b036b58a818b1bc34d502d3fe730db729e62ac ;;
  *) echo "unknown CHAIN_ID $CHAIN_ID"; exit 1 ;;
esac
OWNER=$(cast wallet address "$OWNER_PRIVATE_KEY"); AGENT=$(cast wallet address "$AGENT_PRIVATE_KEY"); SIGNER=$(cast wallet address "$PASS_SIGNER_PRIVATE_KEY")
for who in "owner $OWNER 0.03" "agent $AGENT 0.01"; do
  set -- $who
  bal=$(cast balance "$2" --rpc-url "$RPC_URL" -e)
  echo "$1 $2: $bal ETH (need $3)"
  awk "BEGIN{exit !($bal >= $3)}" || { echo "fund $1 ($2) with at least $3 ETH on chain $CHAIN_ID first"; exit 1; }
done
cd "$ROOT/contracts"
PRIVATE_KEY="$OWNER_PRIVATE_KEY" AGENT_ADDRESS="$AGENT" PASS_SIGNER_ADDRESS="$SIGNER" ETH_LIQUIDITY_WEI="${ETH_LIQUIDITY_WEI:-10000000000000000}" \
  forge script script/Deploy.s.sol --rpc-url "$RPC_URL" --broadcast --slow
cd "$ROOT" && node scripts/export-abis.mjs
echo
echo "Deployed: contracts/deployments/$CHAIN_ID.json"
echo "Engine:   cd engine && npx tsx --env-file=.env --env-file=.env.$NET.local src/main.ts"
echo "App:      NEXT_PUBLIC_CHAIN_ID=$CHAIN_ID NEXT_PUBLIC_RPC_URL=$RPC_URL pnpm --filter @clutch/app dev"
