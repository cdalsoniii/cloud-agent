#!/usr/bin/env bash
# verify-local.sh — Run formal verification tools for cloud-agent
# Usage: ./scripts/verify-local.sh [--check-tools] [--suite quint|dafny|alloy|all]

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERIFICATION_DIR="$REPO_ROOT/config/verification"

TOOLS_DIR="$(cd "$SCRIPT_DIR/../../../tools" 2>/dev/null && pwd || true)"
if [ -z "${TOOLS_DIR:-}" ] || [ ! -d "$TOOLS_DIR" ]; then
  TOOLS_DIR="${HOME}/.local/share/cloud-agent-tools"
fi

PASS=0
FAIL=0
SKIP=0
SUITE="all"

pass()  { echo -e "  ${GREEN}PASS${NC} $1"; PASS=$((PASS+1)); }
fail()  { echo -e "  ${RED}FAIL${NC} $1"; FAIL=$((FAIL+1)); }
skip()  { echo -e "  ${YELLOW}SKIP${NC} $1"; SKIP=$((SKIP+1)); }

check_tool() {
  if command -v "$1" >/dev/null 2>&1; then
    echo -e "  ${GREEN}OK${NC}   $1 ($2)"
  else
    echo -e "  ${RED}MISS${NC} $1 ($2)"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check-tools) CHECK_ONLY=1; shift ;;
    --suite) SUITE="${2:-all}"; shift 2 ;;
    *) echo "Unknown arg: $1"; exit 2 ;;
  esac
done

echo "=== Tool Availability ==="
check_tool dafny   "$(dafny --version 2>/dev/null | head -1 || echo 'n/a')"
if command -v quint >/dev/null 2>&1; then
  check_tool quint "$(quint --version 2>/dev/null || echo 'n/a')"
else
  echo -e "  ${YELLOW}WARN${NC} quint (will try npx @informalsystems/quint@0.32.0)"
fi
check_tool java    "$(java -version 2>&1 | head -1 || echo 'n/a')"
check_tool lake    "$(lake --version 2>/dev/null || echo 'n/a')"

TLA_JAR="${TOOLS_DIR}/tla/tla2tools.jar"
ALLOY_JAR="${TOOLS_DIR}/alloy/alloy.jar"

if [ -f "$TLA_JAR" ]; then
  echo -e "  ${GREEN}OK${NC}   tla2tools.jar ($TLA_JAR)"
else
  echo -e "  ${YELLOW}MISS${NC} tla2tools.jar ($TLA_JAR)"
fi
if [ -f "$ALLOY_JAR" ]; then
  echo -e "  ${GREEN}OK${NC}   alloy.jar ($ALLOY_JAR)"
else
  echo -e "  ${YELLOW}MISS${NC} alloy.jar ($ALLOY_JAR)"
fi
echo ""

if [ "${CHECK_ONLY:-0}" = "1" ]; then
  echo "Tools check complete."
  exit 0
fi

run_quint() {
  echo "=== Quint ==="
  local runner=""
  if command -v quint >/dev/null 2>&1; then
    runner="quint"
  else
    runner="npx --yes @informalsystems/quint@0.32.0"
  fi
  local found=0
  for qnt in "$VERIFICATION_DIR"/quint/*.qnt; do
    [ -f "$qnt" ] || continue
    found=1
    name=$(basename "$qnt")
    if $runner typecheck "$qnt" >/dev/null 2>&1; then
      pass "quint/$name"
    else
      fail "quint/$name"
      $runner typecheck "$qnt" || true
    fi
  done
  [ "$found" = "1" ] || skip "quint (no .qnt files)"
  echo ""
}

run_dafny() {
  echo "=== Dafny ==="
  if command -v dafny >/dev/null 2>&1; then
    local found=0
    for dfy in "$VERIFICATION_DIR"/dafny/*.dfy; do
      [ -f "$dfy" ] || continue
      found=1
      name=$(basename "$dfy")
      if dafny verify --verification-time-limit=60 --allow-warnings "$dfy" >/dev/null 2>&1; then
        pass "dafny/$name"
      else
        fail "dafny/$name"
        dafny verify --verification-time-limit=60 --allow-warnings "$dfy" || true
      fi
    done
    [ "$found" = "1" ] || skip "dafny (no .dfy files)"
  else
    skip "dafny (not installed)"
  fi
  echo ""
}

run_alloy() {
  echo "=== Alloy ==="
  if [ -f "$ALLOY_JAR" ] && command -v java >/dev/null 2>&1; then
    local found=0
    for als in "$VERIFICATION_DIR"/alloy/*.als; do
      [ -f "$als" ] || continue
      found=1
      name=$(basename "$als")
      output=$(java -jar "$ALLOY_JAR" exec -f "$als" 2>&1) || true
      if echo "$output" | grep -qiE '^(Error|Exception)|Parse error'; then
        fail "alloy/$name"
        echo "$output" | head -20
      else
        pass "alloy/$name"
      fi
    done
    [ "$found" = "1" ] || skip "alloy (no .als files)"
  else
    skip "alloy (jar or java missing — run setup-verification-tools.sh)"
  fi
  echo ""
}

run_tla() {
  echo "=== TLA+ (SANY) ==="
  if [ -f "$TLA_JAR" ] && command -v java >/dev/null 2>&1; then
    local found=0
    for tla in "$VERIFICATION_DIR"/tla/*.tla; do
      [ -f "$tla" ] || continue
      found=1
      name=$(basename "$tla")
      tla_dir="$(dirname "$tla")"
      result=$(cd "$tla_dir" && java -cp "$TLA_JAR" tla2sany.SANY "$name" 2>&1) || true
      if echo "$result" | grep -qi "Fatal error"; then
        fail "tla/$name"
      else
        pass "tla/$name (parse OK)"
      fi
    done
    [ "$found" = "1" ] || skip "tla (no .tla specs — stub dir)"
  else
    skip "tla (jar or java missing)"
  fi
  echo ""
}

case "$SUITE" in
  quint) run_quint ;;
  dafny) run_dafny ;;
  alloy) run_alloy ;;
  tla)   run_tla ;;
  all)
    run_quint
    run_dafny
    run_alloy
    run_tla
    ;;
  *)
    echo "Unknown suite: $SUITE (use quint|dafny|alloy|tla|all)"
    exit 2
    ;;
esac

echo "======================================="
echo -e "Results: ${GREEN}$PASS passed${NC}, ${RED}$FAIL failed${NC}, ${YELLOW}$SKIP skipped${NC}"
echo "======================================="

if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
exit 0
