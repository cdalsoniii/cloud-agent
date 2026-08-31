#!/usr/bin/env bash
# PostToolUse (passive): run tool_io_guard post on tool result; write session state.
# Stop hook reads last-io-guard.json and can block end_turn when post failed.
set -euo pipefail
ROOT="${GROK_PROJECT_DIR:-${GROK_WORKSPACE_ROOT:-$(pwd)}}"
cd "$ROOT"
STATE_DIR="$ROOT/.px/session"
mkdir -p "$STATE_DIR"

INPUT=$(cat || true)
export PATH="${ROOT}/node_modules/.bin:${PATH}"

TOOL=$(echo "$INPUT" | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin)
except Exception:
  d={}
print(d.get("toolName") or d.get("tool_name") or "")
' 2>/dev/null || true)

if echo "$TOOL" | grep -qiE 'tool_io_guard|px_validate|px_ontology|px_pipeline|px_pack|px_load|px_shacl|px_sandbox|px_formal|fleet_run|px_upload'; then
  exit 0
fi

echo "$INPUT" | npx --yes tsx "$ROOT/.grok/plugins/px-validation-always/scripts/run-guard.ts" \
  --from-stdin --phase post --write-state "$STATE_DIR/last-io-guard.json" \
  >/dev/null 2>&1 || true

# Annotate for scrollback (passive — stdout ignored by harness, but write audit)
python3 - <<PY
import json
from pathlib import Path
p=Path("$STATE_DIR/last-io-guard.json")
if not p.exists():
  raise SystemExit(0)
try:
  d=json.loads(p.read_text())
except Exception:
  raise SystemExit(0)
# Append compact audit line
audit=Path("$STATE_DIR/io-guard-audit.jsonl")
with audit.open("a") as f:
  f.write(json.dumps({"event":"PostToolUse","ok":d.get("ok"),"tool":d.get("tool"),"reason":d.get("reason")})+"\n")
raise SystemExit(0)
PY
