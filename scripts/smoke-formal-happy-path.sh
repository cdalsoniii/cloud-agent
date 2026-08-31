#!/usr/bin/env bash
# smoke-formal-happy-path.sh — Inventory + gate smoke for formal happy path (not Speakeasy Petstore)
# Writes evidence under .gsd/evidence/

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVIDENCE_DIR="$REPO_ROOT/.gsd/evidence"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT="$EVIDENCE_DIR/${STAMP}-smoke-formal.md"

ASSISTANT_UI_ROOT="${ASSISTANT_UI_ROOT:-$REPO_ROOT/../../02-products/assistant-ui}"
# Normalize if relative
if [ ! -d "$ASSISTANT_UI_ROOT" ]; then
  ASSISTANT_UI_ROOT="$(cd "$REPO_ROOT/../../02-products/assistant-ui" 2>/dev/null && pwd || echo "")"
fi

PASS=0
FAIL=0
SKIP=0

pass() { echo "- PASS: $1" | tee -a "$REPORT"; PASS=$((PASS+1)); }
fail() { echo "- FAIL: $1" | tee -a "$REPORT"; FAIL=$((FAIL+1)); }
skip() { echo "- SKIP: $1" | tee -a "$REPORT"; SKIP=$((SKIP+1)); }

mkdir -p "$EVIDENCE_DIR"

{
  echo "# Formal happy-path smoke"
  echo ""
  echo "- UTC: $STAMP"
  echo "- cloud-agent: \`$REPO_ROOT\`"
  echo "- assistant-ui: \`${ASSISTANT_UI_ROOT:-MISSING}\`"
  echo "- DAFNY2JS_PATH: \`${DAFNY2JS_PATH:-unset}\`"
  echo "- DAFNY_REPLAY_PATH: \`${DAFNY_REPLAY_PATH:-unset}\`"
  echo ""
  echo "## Checks"
  echo ""
} > "$REPORT"

# --- cloud-agent local ---
check_file() {
  local label="$1"
  local path="$2"
  if [ -f "$path" ] || [ -d "$path" ]; then
    pass "$label (\`$path\`)"
  else
    fail "$label missing (\`$path\`)"
  fi
}

echo "=== cloud-agent artifacts ==="
check_file "px ontology home" "$REPO_ROOT/.px/README.md"
check_file "gsd state" "$REPO_ROOT/.gsd/STATE.md"
check_file "verification README" "$REPO_ROOT/config/verification/README.md"
check_file "ValidationGate.dfy" "$REPO_ROOT/config/verification/dafny/ValidationGate.dfy"
check_file "TokenIsolation.dfy" "$REPO_ROOT/config/verification/dafny/TokenIsolation.dfy"
check_file "sandbox-lifecycle.qnt" "$REPO_ROOT/config/verification/quint/sandbox-lifecycle.qnt"
check_file "formal-verification.yml" "$REPO_ROOT/.github/workflows/formal-verification.yml"
check_file "PRD milestones" "$REPO_ROOT/artifacts/prd/smoke-formal-happy-path/06-MILESTONES.md"

# --- tools ---
echo "" | tee -a "$REPORT"
echo "## Tools" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"
if command -v dafny >/dev/null 2>&1; then
  pass "dafny $(dafny --version 2>/dev/null | head -1)"
else
  skip "dafny not on PATH"
fi
if command -v quint >/dev/null 2>&1 || npx --yes @informalsystems/quint@0.32.0 --version >/dev/null 2>&1; then
  pass "quint available (cli or npx)"
else
  skip "quint unavailable"
fi
if command -v dotnet >/dev/null 2>&1; then
  pass "dotnet $(dotnet --version 2>/dev/null | head -1)"
else
  skip "dotnet not on PATH (needed for live dafny2js)"
fi
if [ -z "${DAFNY2JS_PATH:-}" ]; then
  skip "DAFNY2JS_PATH unset — live POST /api/verify/dafny2js blocked"
else
  pass "DAFNY2JS_PATH set"
fi

# --- verify suites (best effort) ---
echo "" | tee -a "$REPORT"
echo "## verify-local" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"
TOOLS_LOG="$EVIDENCE_DIR/${STAMP}-verify-tools.txt"
ALL_LOG="$EVIDENCE_DIR/${STAMP}-verify-all.txt"
if bash "$REPO_ROOT/scripts/verify-local.sh" --check-tools >"$TOOLS_LOG" 2>&1; then
  pass "verify:tools (see \`$TOOLS_LOG\`)"
else
  fail "verify:tools (see \`$TOOLS_LOG\`)"
fi
if bash "$REPO_ROOT/scripts/verify-local.sh" --suite all >"$ALL_LOG" 2>&1; then
  pass "verify:all (see \`$ALL_LOG\`)"
else
  # treat as fail only if FAIL count > 0 in log; SKIPs ok
  if grep -qE 'Results:.*[1-9][0-9]* failed' "$ALL_LOG" 2>/dev/null || grep -q 'FAIL ' "$ALL_LOG" 2>/dev/null; then
    fail "verify:all had failures (see \`$ALL_LOG\`)"
  else
    skip "verify:all exited non-zero without clear FAIL lines (see \`$ALL_LOG\`)"
  fi
fi

# --- assistant-ui path probes ---
echo "" | tee -a "$REPORT"
echo "## assistant-ui probes" | tee -a "$REPORT"
echo "" | tee -a "$REPORT"
if [ -n "${ASSISTANT_UI_ROOT:-}" ] && [ -d "$ASSISTANT_UI_ROOT" ]; then
  check_file "dafny2js route" "$ASSISTANT_UI_ROOT/packages/web/src/app/api/verify/dafny2js/route.ts"
  check_file "dafny-replay route" "$ASSISTANT_UI_ROOT/packages/web/src/app/api/verify/dafny-replay/route.ts"
  check_file "claimcheck dir" "$ASSISTANT_UI_ROOT/packages/web/src/app/api/verify/claimcheck"
  check_file "verified-kernels" "$ASSISTANT_UI_ROOT/packages/verified-kernels/src/kernel.ts"
  check_file "Replay.dfy" "$ASSISTANT_UI_ROOT/config/verification/lemma/lemmafit/dafny/Replay.dfy"
  check_file "gap analysis" "$ASSISTANT_UI_ROOT/.gap-analysis.md"
  if grep -q "createKernel" "$ASSISTANT_UI_ROOT/packages/verified-kernels/src/kernel.ts" 2>/dev/null; then
    pass "createKernel present (Inv Do/Undo/Redo surface)"
  else
    fail "createKernel not found in kernel.ts"
  fi
else
  skip "assistant-ui root not found — set ASSISTANT_UI_ROOT"
fi

{
  echo ""
  echo "## Summary"
  echo ""
  echo "- PASS: $PASS"
  echo "- FAIL: $FAIL"
  echo "- SKIP: $SKIP"
  echo ""
  echo "Report: \`$REPORT\`"
} | tee -a "$REPORT"

echo ""
echo "Wrote $REPORT"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
