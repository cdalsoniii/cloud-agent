#!/usr/bin/env bash
# smoke-grok-lean.sh — Verify Lean bundle, stack, bridge, and build
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
export PX_GROK_BUNDLE="$BUNDLE_ROOT"
export PATH="$BUNDLE_ROOT/bin:$PATH"

PASS=0
FAIL=0

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

echo "=== smoke-grok-lean ==="

check "bundle lean binary" test -x "$BUNDLE_ROOT/bin/lean"
check "bundle lake binary" test -x "$BUNDLE_ROOT/bin/lake"

if [[ ! -x "$BUNDLE_ROOT/bin/lean" ]]; then
  echo "Run ./scripts/grok-bundle-install.sh first" >&2
  exit 1
fi

check "lean --version" "$BUNDLE_ROOT/bin/lean" --version
check "lake --version" "$BUNDLE_ROOT/bin/lake" --version

"$SCRIPT_DIR/lean-stack.sh" start
check "lake serve health" "$SCRIPT_DIR/lean-stack.sh" health

"$SCRIPT_DIR/lean-live-bridge.sh" start
sleep 1
check "bridge health" bash -c 'curl -sf "http://127.0.0.1:${LEAN_LIVE_PORT:-9474}/health" >/dev/null'

WORKSPACE="$("$SCRIPT_DIR/lean-stack.sh" workspace)"
check "workspace resolved" test -n "$WORKSPACE"
check "lake build" bash -c "cd \"$WORKSPACE\" && lake build"

sleep 2
check "bridge state ok" bash -c "curl -sf \"http://127.0.0.1:${LEAN_LIVE_PORT:-9474}/state\" | grep -q '\"status\"'"

echo ""
echo "=== $PASS passed, $FAIL failed ==="
[[ "$FAIL" -eq 0 ]]
