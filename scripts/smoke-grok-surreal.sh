#!/usr/bin/env bash
# smoke-grok-surreal.sh — End-to-end verification of PX Grok Surreal bundle
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
GATEWAY_ROOT="$(cd "$REPO_ROOT/../../02-products/surreal-graphql-gateway" && pwd)"

export PX_GROK_BUNDLE="$BUNDLE_ROOT"
export PATH="$BUNDLE_ROOT/bin:$PATH"

PASS=0
FAIL=0
SKIP=0

check() {
  local name="$1"
  shift
  if "$@"; then
    echo "PASS: $name"
    PASS=$((PASS + 1))
  else
    echo "FAIL: $name" >&2
    FAIL=$((FAIL + 1))
  fi
}

skip() {
  echo "SKIP: $1"
  SKIP=$((SKIP + 1))
}

echo "=== smoke-grok-surreal ==="
echo "BUNDLE_ROOT=$BUNDLE_ROOT"
echo "GATEWAY_ROOT=$GATEWAY_ROOT"
echo ""

check "bundle surreal binary" test -x "$BUNDLE_ROOT/bin/surreal"
check "bundle surrealkit binary" test -x "$BUNDLE_ROOT/bin/surrealkit"
check "bundle surrealmcp binary" test -x "$BUNDLE_ROOT/bin/surrealmcp"
check "grok config exists" test -f "$REPO_ROOT/.grok/config.toml"

# Ensure Surreal is running
if ! "$SCRIPT_DIR/surreal-stack.sh" health >/dev/null 2>&1; then
  echo "Starting SurrealDB..."
  "$SCRIPT_DIR/surreal-stack.sh" start
fi

check "surreal health" "$SCRIPT_DIR/surreal-stack.sh" health

if [[ -d "$GATEWAY_ROOT" ]] && [[ -f "$GATEWAY_ROOT/package.json" ]]; then
  echo "Running surreal:sync in gateway..."
  if (cd "$GATEWAY_ROOT" && npm run surreal:sync >/dev/null 2>&1); then
    check "gateway surreal:sync" true
  else
    check "gateway surreal:sync" false
  fi

  if (cd "$GATEWAY_ROOT" && npm run schema:check >/dev/null 2>&1); then
    check "gateway schema:check" true
  else
    check "gateway schema:check" false
  fi
else
  skip "gateway surreal:sync (gateway not found)"
  skip "gateway schema:check (gateway not found)"
fi

if command -v grok >/dev/null 2>&1; then
  if grok mcp list 2>/dev/null | grep -qi surreal; then
    check "grok mcp list includes surreal" true
  else
    check "grok mcp list includes surreal" false
  fi
  if grok mcp doctor surrealdb >/dev/null 2>&1; then
    check "grok mcp doctor surrealdb" true
  else
    check "grok mcp doctor surrealdb" false
  fi
else
  skip "grok mcp list (grok not on PATH)"
  skip "grok mcp doctor (grok not on PATH)"
fi

echo ""
echo "=== Results: $PASS passed, $FAIL failed, $SKIP skipped ==="

CONNECTIVITY_DOC="$REPO_ROOT/docs/grok-surreal-connectivity.md"
TIMESTAMP="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"
if [[ ! -f "$CONNECTIVITY_DOC" ]]; then
  cat >"$CONNECTIVITY_DOC" <<'HDR'
# Grok Surreal connectivity

| Date | surreal health | surreal:sync | schema:check | grok MCP | Notes |
|------|----------------|--------------|--------------|----------|-------|
HDR
fi

GROK_STATUS="skipped"
if command -v grok >/dev/null 2>&1 && grok mcp doctor surrealdb >/dev/null 2>&1; then
  GROK_STATUS="ok"
elif command -v grok >/dev/null 2>&1; then
  GROK_STATUS="fail"
fi

echo "| $TIMESTAMP | ok | see smoke | see smoke | $GROK_STATUS | smoke-grok-surreal.sh |" >>"$CONNECTIVITY_DOC"

if [[ "$FAIL" -gt 0 ]]; then
  exit 1
fi
