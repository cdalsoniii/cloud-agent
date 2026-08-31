#!/usr/bin/env bash
# PreToolUse (blocking): run tool_io_guard pre on tool input via MCP handler surface.
# Deny on blocking violations. Validation-surface tools always allowed.
set -euo pipefail
ROOT="${GROK_PROJECT_DIR:-${GROK_WORKSPACE_ROOT:-$(pwd)}}"
cd "$ROOT"
STATE_DIR="$ROOT/.px/session"
mkdir -p "$STATE_DIR"
IO_STATE="$STATE_DIR/last-io-guard.json"

INPUT=$(cat || true)
export PATH="${ROOT}/node_modules/.bin:${PATH}"

TOOL=$(printf '%s' "$INPUT" | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin)
except Exception:
  d={}
print(d.get("toolName") or d.get("tool_name") or "")
' 2>/dev/null || true)

if echo "$TOOL" | grep -qiE 'tool_io_guard|px_validate|px_ontology|px_pipeline|px_pack|px_load|px_shacl|px_sandbox|px_formal|fleet_run|px_upload'; then
  echo '{"decision":"allow"}'
  exit 0
fi

ENF=$(python3 - <<'PY'
import json
from pathlib import Path
p=Path(".px/config.json")
if not p.exists():
  print("true"); raise SystemExit
try:
  d=json.loads(p.read_text())
  print("true" if d.get("ontologyEnforcement", True) else "false")
except Exception:
  print("true")
PY
)
PROFILE="${PX_VALIDATION_PROFILE:-strict}"

if [ "$ENF" != "true" ] && [ "$PROFILE" = "strict" ] && [ "${PX_ALLOW_ENFORCE_OFF:-}" != "1" ]; then
  echo "{\"decision\":\"deny\",\"reason\":\"ontologyEnforcement is OFF under PX_VALIDATION_PROFILE=strict; run bash scripts/px-ontology-mode.sh enforce on\"}"
  exit 0
fi

# Scope hard-deny for gated-looking tools (default on; set PX_HOOK_HARD_DENY=0 to soft)
if echo "$TOOL" | grep -qiE 'daytona|shell|Bash|exec|batch|orchestrat|run_terminal|CallMcp|use_tool|__daytona|__sdlc|__opencode|__mastra'; then
  STATE="$STATE_DIR/last-scope.json"
  if [ -f "$STATE" ]; then
    TAG=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(d.get("relevantOntologyTag") or d.get("ontologyHookContext",{}).get("relevantOntologyTag") or "")' "$STATE" 2>/dev/null || true)
    PACK_SCOPED=$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print("1" if d.get("packScoped") is not False and (d.get("error") or d.get("relevantOntologyTag") or d.get("packResolve") or d.get("ontologyHookContext")) else "0")' "$STATE" 2>/dev/null || echo 0)
    if [ "${PX_HOOK_HARD_DENY:-1}" = "1" ] && [ "$PACK_SCOPED" = "1" ] && [ -z "$TAG" ]; then
      echo '{"decision":"deny","reason":"No ontology scope this session; call px_ontology_scope first (pack-scoped / gated tool)"}'
      exit 0
    fi
  fi
fi

# Real pre I/O guard (same MCP tool_io_guard handler)
printf '%s' "$INPUT" | npx --yes tsx "$ROOT/.grok/plugins/px-validation-always/scripts/run-guard.ts" \
  --from-stdin --phase pre --write-state "$IO_STATE" \
  >"$STATE_DIR/last-io-guard.stdout.json" 2>"$STATE_DIR/last-io-guard.stderr.txt" || true

if [ ! -s "$IO_STATE" ] && [ ! -s "$STATE_DIR/last-io-guard.stdout.json" ]; then
  if [ "$PROFILE" = "strict" ] && [ "${PX_HOOK_FAIL_OPEN:-0}" != "1" ]; then
    echo '{"decision":"deny","reason":"pre-tool guard failed to execute (run-guard empty); install tsx/node deps or set PX_HOOK_FAIL_OPEN=1"}'
    exit 0
  fi
  echo '{"decision":"allow"}'
  exit 0
fi

python3 - <<PY
import json
from pathlib import Path
state = Path("$IO_STATE")
stdout = Path("$STATE_DIR/last-io-guard.stdout.json")
d = {}
for p in (state, stdout):
  if p.exists() and p.stat().st_size > 0:
    try:
      d = json.loads(p.read_text())
      break
    except Exception:
      pass
dec = d.get("decision") or ("allow" if d.get("ok", True) else "deny")
if dec == "deny" or d.get("ok") is False:
  reason = d.get("reason") or "tool_io_guard pre blocked"
  print(json.dumps({"decision": "deny", "reason": reason}))
else:
  print(json.dumps({"decision": "allow"}))
PY
exit 0
