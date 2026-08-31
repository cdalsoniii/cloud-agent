#!/usr/bin/env bash
# lean-surreal-validate.sh — Orchestrate the Lean↔GraphQL validation loop.
#
# Pipeline:
#   1. validation : query SurrealDB GraphQL, run relationship invariants
#                   (self-loops, dangling edges) -> .px/lean-surreal/report.json
#   2. export     : dump rows over GraphQL -> .px/lean-surreal/export.json and
#                   regenerate config/verification/lean/PxCloudAgent/SurrealGraph.lean
#   3. build      : lake build the workspace; the generated module's invariant
#                   theorems must be proven or the build fails (machine-checked)
#   4. report     : read lean-live bridge state and write a combined verdict
#                   to .px/lean-surreal/validate.json + stdout
#
# Usage: ./scripts/lean-surreal-validate.sh [--regen] [--ns test --db test]
#   --regen  force regeneration even if export.json already exists
#   --ns/--db  override namespace/database (default test/test)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUT_DIR="$REPO_ROOT/.px/lean-surreal"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
LEAN_LIVE_PORT="${LEAN_LIVE_PORT:-9474}"

NS="test"
DB="test"
REGEN=0

# ---- arg parsing ----
while [[ $# -gt 0 ]]; do
  case "$1" in
    --regen) REGEN=1 ;;
    --ns) NS="${2:?--ns needs a value}"; shift ;;
    --db) DB="${2:?--db needs a value}"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

mkdir -p "$OUT_DIR"
summary="$OUT_DIR/validate.json"

echo "=== Lean↔GraphQL validation (ns=$NS db=$DB) ==="

# ---- 1. GraphQL relationship validation ----
echo "--- 1. GraphQL relationship validation ---"
if ! SURREAL_NS="$NS" SURREAL_DB="$DB" npx tsx "$SCRIPT_DIR/lean-surreal-graphql.ts"; then
  echo "GraphQL validation reported violations (see .px/lean-surreal/report.json)" >&2
fi

# ---- 2. Export + regenerate .lean ----
echo "--- 2. Export GraphQL data -> SurrealGraph.lean ---"
if [[ "$REGEN" -eq 1 ]] || [[ ! -f "$OUT_DIR/export.json" ]]; then
  SURREAL_NS="$NS" SURREAL_DB="$DB" npx tsx "$SCRIPT_DIR/lean-surreal-export.ts"
else
  echo "export.json exists; skipping regeneration (use --regen to force)"
fi

# ---- 3. lake build (machine-checked invariants) ----
echo "--- 3. lake build (proving generated invariants) ---"
WORKSPACE="$(bash "$SCRIPT_DIR/lean-stack.sh" workspace)"
export PX_GROK_BUNDLE="$BUNDLE_ROOT"
export PATH="$BUNDLE_ROOT/bin:$PATH"
(cd "$WORKSPACE" && "$BUNDLE_ROOT/bin/lake" build)
lake_exit=$?

# ---- 4. read lean-live bridge state for the combined report ----
echo "--- 4. Combined verdict ---"
lean_status="unknown"
lean_diags=0
if curl -sf "http://127.0.0.1:${LEAN_LIVE_PORT}/state" >"$OUT_DIR/.lean-state.json" 2>/dev/null; then
  lean_status="$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(s.status||"unknown")}catch{process.stdout.write("unknown")}' "$OUT_DIR/.lean-state.json" 2>/dev/null || echo unknown)"
  lean_diags="$(node -e 'try{const s=require(process.argv[1]);process.stdout.write(String((s.diagnostics||[]).length))}catch{process.stdout.write("0")}' "$OUT_DIR/.lean-state.json" 2>/dev/null || echo 0)"
fi

total="$(node -e 'try{const r=require(process.argv[1]);process.stdout.write(String(r.totalViolations??0))}catch{process.stdout.write("0")}' "$OUT_DIR/report.json" 2>/dev/null || echo 0)"

status="pass"
if [[ "$lake_exit" -ne 0 ]]; then status="fail"; fi
if [[ "$lean_status" != "ok" ]]; then status="fail"; fi
if [[ "$total" != "0" ]]; then status="fail"; fi

cat > "$summary" <<EOF
{
  "at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "ns": "$NS",
  "db": "$DB",
  "graphqlViolations": $total,
  "lakeBuildExit": $lake_exit,
  "leanBridgeStatus": "$lean_status",
  "leanDiagnostics": $lean_diags,
  "status": "$status"
}
EOF

echo "graphqlViolations: $total"
echo "lakeBuildExit: $lake_exit"
echo "leanBridgeStatus: $lean_status ($lean_diags diagnostics)"
echo "result: $status"
echo "combined report: $summary"

[[ "$status" == "pass" ]]
