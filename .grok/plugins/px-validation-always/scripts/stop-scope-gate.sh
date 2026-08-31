#!/usr/bin/env bash
# Stop gate (blocking): pack-scoped missing scope OR last post I/O guard failed → block once.
set -euo pipefail
ROOT="${GROK_PROJECT_DIR:-${GROK_WORKSPACE_ROOT:-$(pwd)}}"
cd "$ROOT"
SCOPE="$ROOT/.px/session/last-scope.json"
IO="$ROOT/.px/session/last-io-guard.json"

INPUT=$(cat || true)
REASON=$(echo "$INPUT" | python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except: d={}
print(d.get("reason") or "")
' 2>/dev/null || true)

# Only gate genuine end_turn
if [ "$REASON" != "end_turn" ] && [ -n "$REASON" ] && [ "$REASON" != "null" ]; then
  exit 0
fi

ACTIVE=$(echo "$INPUT" | python3 -c 'import json,sys
try: d=json.load(sys.stdin)
except: d={}
print("true" if d.get("stopHookActive") else "false")
' 2>/dev/null || echo false)

python3 - <<PY
import json
from pathlib import Path

active = "$ACTIVE" == "true"
scope_path = Path("$SCOPE")
io_path = Path("$IO")

# 1) Post I/O failure (from PostToolUse harness guard)
if io_path.exists():
  try:
    io = json.loads(io_path.read_text())
  except Exception:
    io = {}
  if io.get("phase") == "post" and (io.get("ok") is False or io.get("decision") == "deny"):
    if active:
      raise SystemExit(0)
    reason = io.get("reason") or "tool_io_guard post failed"
    print(json.dumps({
      "decision": "block",
      "reason": (
        f"Post-tool validation failed ({reason}). "
        "Fix the structured instance / cascade violations, re-run tool_io_guard or px_validate_cascade, "
        "then stop again. MCP middleware also returns isError on post-block for gated tools."
      )
    }))
    raise SystemExit(0)

# 2) Pack-scoped scope missing
if not scope_path.exists():
  raise SystemExit(0)
try:
  state = json.loads(scope_path.read_text())
except Exception:
  raise SystemExit(0)

if state.get("packScoped") is False:
  raise SystemExit(0)

tag = state.get("relevantOntologyTag") or (state.get("ontologyHookContext") or {}).get("relevantOntologyTag")
err = state.get("error")
if err or not tag:
  if active:
    raise SystemExit(0)
  print(json.dumps({
    "decision": "block",
    "reason": (
      "Pack-scoped turn missing successful ontology scope. "
      "Call MCP tool px_ontology_scope (or ensure host hook run-scope succeeded), "
      "then include relevantOntologyTag in the answer. "
      f"state_error={err!r} tag={tag!r}"
    )
  }))
  raise SystemExit(0)

raise SystemExit(0)
PY
