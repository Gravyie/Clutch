#!/usr/bin/env bash
# Deploys the full system to a local anvil (start one with `pnpm chain`) and refreshes ABIs.
set -euo pipefail
cd "$(dirname "$0")/../contracts"
export PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80   # anvil #0: deployer, streamer, faucet
export AGENT_ADDRESS=0x70997970C51812dc3A010C7d01b50e0d17dc79C8                          # anvil #1: 0G agent (engine + resolver)
export PASS_SIGNER_ADDRESS=0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC                    # anvil #2: human-pass signer
forge script script/Deploy.s.sol --rpc-url "${RPC_URL:-http://127.0.0.1:8545}" --broadcast
cd .. && node scripts/export-abis.mjs
rm -f engine/data/receipts.json
