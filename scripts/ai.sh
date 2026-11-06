#!/usr/bin/env bash
# Switch Clutch's platform AI (0G inference) on or off, so credits are only spent when you want.
#   pnpm ai on | off | status
# Off: no 0G calls, readers rest, no new markets (open ones still settle). The setting survives restarts.
set -euo pipefail
ENGINE="${ENGINE_URL:-http://localhost:8787}"
show() { node -e 'const a=JSON.parse(require("fs").readFileSync(0));console.log(`AI ${a.enabled===false?"OFF":"ON"} · mode ${a.mode} · ${a.requestsToday} calls today · $${a.spentTodayUsd.toFixed(3)} of $${a.capTodayUsd} cap`)'; }
case "${1:-status}" in
  on)  curl -s -X POST "$ENGINE/admin/ai" -H 'content-type: application/json' ${ADMIN_TOKEN:+-H "x-admin-token: $ADMIN_TOKEN"} -d '{"enabled":true}' | show ;;
  off) curl -s -X POST "$ENGINE/admin/ai" -H 'content-type: application/json' ${ADMIN_TOKEN:+-H "x-admin-token: $ADMIN_TOKEN"} -d '{"enabled":false}' | show ;;
  status) curl -s "$ENGINE/admin/ai" | show ;;
  *) echo "usage: pnpm ai on|off|status"; exit 1 ;;
esac
