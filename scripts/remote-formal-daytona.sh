#!/usr/bin/env bash
# remote-formal-daytona.sh — Run cloud-agent formal specs on a REMOTE Daytona sandbox.
#
# Uploads each Quint spec (base64, no scp needed) and runs `quint typecheck`
# via npx inside the sandbox. Dafny / Alloy / TLA are SKIPPED remotely because
# the default `daytona-large` snapshot ships Node only (no dafny / dotnet / java).
# Those suites are covered by the LOCAL gate (`npm run verify:all`).
#
# Usage:
#   ./scripts/remote-formal-daytona.sh <SANDBOX_ID>
#   DAYTONA_FORMAL_SBX=<id> ./scripts/remote-formal-daytona.sh
#
# Requires: daytona CLI authenticated, a STARTED sandbox with Node + npx.

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFICATION_DIR="$REPO_ROOT/config/verification"

SBX="${1:-${DAYTONA_FORMAL_SBX:-}}"
if [ -z "$SBX" ]; then
  echo "ERROR: pass a Daytona sandbox id (arg or DAYTONA_FORMAL_SBX)" >&2
  daytona sandbox list 2>/dev/null | tr ' ' '\n' | grep -E '^[0-9a-f]{8}-' | head -20 >&2 || true
  exit 2
fi

dexec() { daytona sandbox exec "$SBX" -- "$1" 2>&1 | grep -v "Version mismatch" ; }

echo "=== Remote sandbox: $SBX ==="
echo "--- tool presence ---"
dexec "echo NODE=\$(node -v); echo NPX=\$(command -v npx||echo none); echo DAFNY=\$(command -v dafny||echo none); echo JAVA=\$(command -v java||echo none); echo DOTNET=\$(command -v dotnet||echo none)"

PASS=0; FAIL=0; SKIP=0
echo ""
echo "=== Quint (remote, via npx @informalsystems/quint@0.32.0) ==="
for qnt in "$VERIFICATION_DIR"/quint/*.qnt; do
  [ -f "$qnt" ] || continue
  name="$(basename "$qnt")"
  b64="$(base64 < "$qnt" | tr -d '\n')"
  out="$(dexec "echo $b64 | base64 -d > /tmp/$name && npx --yes @informalsystems/quint@0.32.0 typecheck /tmp/$name && echo REMOTE_QUINT_PASS")"
  if echo "$out" | grep -q REMOTE_QUINT_PASS; then
    echo "  PASS quint/$name (remote)"; PASS=$((PASS+1))
  else
    echo "  FAIL quint/$name (remote)"; echo "$out" | tail -12; FAIL=$((FAIL+1))
  fi
done

echo ""
echo "=== Dafny / Alloy / TLA (remote) ==="
echo "  SKIP dafny  (snapshot has no dafny/dotnet — covered by LOCAL verify:all)"; SKIP=$((SKIP+1))
echo "  SKIP alloy  (snapshot has no java  — covered by LOCAL verify:all)"; SKIP=$((SKIP+1))
echo "  SKIP tla    (stub dir — no specs)"; SKIP=$((SKIP+1))

echo ""
echo "======================================="
echo "Remote formal: $PASS passed, $FAIL failed, $SKIP skipped  (sandbox $SBX)"
echo "======================================="
[ "$FAIL" -gt 0 ] && exit 1
exit 0
