#!/usr/bin/env bash
# Probe host formal dual surfaces (7004/7005/7006) + OpenCode :4096.
# Ontology and fleet remain SEPARATE apps.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SCRATCH="${FORMAL_PROBE_SCRATCH:-$ROOT/.gsd/evidence/formal-surfaces-probe}"
mkdir -p "$SCRATCH"

echo "=== dual surface status ===" | tee "$SCRATCH/surfaces-status.txt"
cat >>"$SCRATCH/surfaces-status.txt" <<EOF
Ontology viewer (ontology-ui-server.py) :7005 — NOT merged with fleet
Verifier-fleet (fleet-ui-server.py)     :7006 — separate process/port
SHACL validate                          :7004
OpenCode serve                          :4096
EOF
cat "$SCRATCH/surfaces-status.txt"

{
  echo "=== apps-health $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  for url in \
    http://127.0.0.1:7004/health \
    http://127.0.0.1:7005/health \
    http://127.0.0.1:7006/health
  do
    echo "--- GET $url"
    code=$(curl -sS -m 4 -o "$SCRATCH/body.tmp" -w "%{http_code}" "$url" || echo 000)
    echo "HTTP $code"
    head -c 300 "$SCRATCH/body.tmp" 2>/dev/null; echo
    case "$code" in
      200|204) ;;
      *) echo "FAIL $url" >&2; exit 2 ;;
    esac
  done
} | tee "$SCRATCH/apps-health.log"

{
  echo "=== opencode dual health ==="
  lsof -nP -iTCP:4096 -sTCP:LISTEN | head -3 || { echo "4096 not listening" >&2; exit 3; }
  AUTH_USER="${OPENCODE_SERVER_USER:-opencode}"
  AUTH_PASS="${OPENCODE_SERVER_PASSWORD:-}"
  if [ -n "$AUTH_PASS" ]; then
    CURL_AUTH=(-u "${AUTH_USER}:${AUTH_PASS}")
  else
    CURL_AUTH=()
  fi
  echo "--- probe 1"
  curl -sS -m 5 "${CURL_AUTH[@]}" -w "\nHTTP %{http_code}\n" http://127.0.0.1:4096/global/health
  echo "--- probe 2"
  curl -sS -m 5 "${CURL_AUTH[@]}" -w "\nHTTP %{http_code}\n" http://127.0.0.1:4096/global/health
} | tee "$SCRATCH/opencode-health.log"

export OPENCODE_BASE_URL="${OPENCODE_BASE_URL:-http://127.0.0.1:4096}"
npx tsx "$ROOT/scripts/probe-opencode-host.ts" | tee "$SCRATCH/opencode-client.log"

echo "FORMAL_SURFACES_PROBE_OK"
