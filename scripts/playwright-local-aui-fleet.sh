#!/usr/bin/env bash
# Ensure Surreal + prove assistant-ui (:3010) and /verifier-fleet with Playwright.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AUI_WEB="${ASSISTANT_UI_WEB:-$ROOT/../02-products/assistant-ui/packages/web}"
# absolute fallback
if [[ ! -d "$AUI_WEB" ]]; then
  AUI_WEB="$HOME/Documents/Personal/employment/partners/experiments/02-products/assistant-ui/packages/web"
fi

echo "== Surreal stack =="
bash "$ROOT/scripts/surreal-stack.sh" start || true
bash "$ROOT/scripts/surreal-stack.sh" health || {
  echo "Surreal health failed" >&2
  exit 1
}

echo "== HTTP probes =="
curl -sf -o /dev/null "http://127.0.0.1:3010/" || {
  echo "assistant-ui not on :3010 — start: cd $AUI_WEB && npm run dev" >&2
  exit 2
}
curl -sf -o /dev/null "http://127.0.0.1:3010/verifier-fleet" || {
  echo "verifier-fleet route not serving" >&2
  exit 2
}
curl -sf "http://127.0.0.1:8000/health" >/dev/null

echo "== Playwright e2e (local-runtime) =="
cd "$AUI_WEB"
export BASE_URL="${BASE_URL:-http://127.0.0.1:3010}"
npx playwright test e2e/local-runtime.spec.ts --reporter=list "$@"
echo "PLAYWRIGHT_LOCAL_AUI_FLEET_OK"
