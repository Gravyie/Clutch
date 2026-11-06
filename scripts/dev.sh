#!/usr/bin/env bash
# One command for the whole local stack: anvil → deploy → engine (8787) → app (3000).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if ! curl -s -m 1 -X POST -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}' http://127.0.0.1:8545 >/dev/null; then
  anvil --block-time 1 --silent &
  sleep 2
  bash scripts/deploy-local.sh
fi
trap 'kill 0' EXIT
pnpm --filter @clutch/engine start &
pnpm --filter @clutch/app dev &
wait
