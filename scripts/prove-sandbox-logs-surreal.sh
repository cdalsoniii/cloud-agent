#!/usr/bin/env bash
# prove-sandbox-logs-surreal.sh
#
# End-to-end proof: REAL Daytona sandbox logs -> LOCAL SurrealDB -> query rows.
#
#   1. Trigger/fetch real sandbox logs (daytona sandbox exec stdout).
#   2. Write them to local SurrealDB via the repo's sync tool
#      (src/sync-sandbox-logs.ts --content -> event-logger -> SURREALDB_URL).
#   3. Read them back two ways:
#        a) via the repo tool (--list --sandbox-id)     [same client path]
#        b) via an INDEPENDENT raw HTTP query to the same SurrealDB instance
#      and print the proof rows (sandbox_id + log line + created_at timestamp).
#
# Usage:
#   ./scripts/prove-sandbox-logs-surreal.sh [SANDBOX_ID]
#
# Env (defaults match docker-compose.surrealdb.yml / .env):
#   SURREALDB_URL (default http://localhost:8000), SURREALDB_NS/DB/USER/PASS
#
# NOTE on localhost resolution: Node resolves `localhost` to IPv6 (::1). The
# compose SurrealDB container listens on [::]:8000, so the repo tool and the
# independent [::1]:8000 query below hit the SAME instance. (A separate host
# `surreal` process bound to 127.0.0.1 is a different, unrelated instance.)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

SURREALDB_URL="${SURREALDB_URL:-http://localhost:8000}"
NS="${SURREALDB_NS:-main}"
DB="${SURREALDB_DB:-main}"
USER="${SURREALDB_USER:-root}"
PASS="${SURREALDB_PASS:-root}"

# Independent raw-query endpoint: force IPv6 [::1] so we hit the same container
# Node's `localhost` reaches, regardless of any 127.0.0.1 host process.
RAW_URL="${SURREAL_RAW_URL:-http://[::1]:8000}"

# --- pick a sandbox ---
SBX="${1:-${DAYTONA_FORMAL_SBX:-}}"
if [ -z "$SBX" ]; then
  SBX="$(daytona sandbox list 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9a-f]{8}-' | head -1)"
fi
if [ -z "$SBX" ]; then
  echo "ERROR: no sandbox id (arg or running Daytona sandbox)" >&2
  exit 2
fi
echo "=== sandbox: $SBX ==="

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CORR="prove-$STAMP"

# --- 1. trigger REAL sandbox logs ---
echo "--- (1) trigger real sandbox logs via daytona exec ---"
LOGS="$(daytona sandbox exec "$SBX" -- "echo PROVE_SANDBOX_LOG corr=$CORR host=\$(hostname) date=\$(date -u +%Y-%m-%dT%H:%M:%SZ); node -v; uptime" 2>&1 | grep -v 'Version mismatch')"
echo "$LOGS"

# --- 2. write to local SurrealDB via repo sync tool ---
echo ""
echo "--- (2) write to local SurrealDB (src/sync-sandbox-logs.ts --content) ---"
WRITE_OUT="$(SURREALDB_URL="$SURREALDB_URL" SURREALDB_NS="$NS" SURREALDB_DB="$DB" \
  SURREALDB_USER="$USER" SURREALDB_PASS="$PASS" \
  npx tsx src/sync-sandbox-logs.ts --sandbox-id "$SBX" --content "$LOGS
[correlation:$CORR]" 2>&1)"
echo "$WRITE_OUT"
LOG_ID="$(echo "$WRITE_OUT" | grep -oE 'slog-[0-9]+-[0-9a-f]+' | head -1)"
echo "log_id=$LOG_ID"

# --- 3a. read back via repo tool ---
echo ""
echo "--- (3a) read back via repo tool (--list --sandbox-id) ---"
SURREALDB_URL="$SURREALDB_URL" SURREALDB_NS="$NS" SURREALDB_DB="$DB" \
  SURREALDB_USER="$USER" SURREALDB_PASS="$PASS" \
  npx tsx src/sync-sandbox-logs.ts --list --sandbox-id "$SBX" --limit 3 2>&1 | tail -40

# --- 3b. independent raw HTTP query to the SAME SurrealDB instance ---
echo ""
echo "--- (3b) independent raw query ($RAW_URL, ns=$NS db=$DB) ---"
AUTH="$(printf '%s:%s' "$USER" "$PASS" | base64)"
curl -s -X POST "$RAW_URL/sql" \
  -H "Content-Type: text/plain" -H "Accept: application/json" \
  -H "surreal-ns: $NS" -H "surreal-db: $DB" -H "NS: $NS" -H "DB: $DB" \
  -H "Authorization: Basic $AUTH" \
  --data "SELECT log_id, sandbox_id, source, created_at, string::slice(content,0,80) AS content_head FROM sandbox_log WHERE sandbox_id = '$SBX' ORDER BY created_at DESC LIMIT 3;" \
  | python3 -m json.tool 2>/dev/null || echo "(raw query failed)"

echo ""
echo "=== PROOF COMPLETE: sandbox $SBX -> local SurrealDB ($SURREALDB_URL) ==="
