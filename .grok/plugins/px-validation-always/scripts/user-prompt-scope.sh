#!/usr/bin/env bash
# On every user prompt: if pack-scoped, resolve pack + write ontology scope to session state.
# Emits additionalContext JSON for the agent when possible.
set -euo pipefail
ROOT="${GROK_PROJECT_DIR:-$(pwd)}"
cd "$ROOT"
STATE_DIR="$ROOT/.px/session"
mkdir -p "$STATE_DIR"

INPUT=$(cat || true)
# Prefer jq; fallback python
PROMPT=$(echo "$INPUT" | python3 -c '
import json,sys
try:
  d=json.load(sys.stdin)
except Exception:
  d={}
# common fields across harnesses
for k in ("prompt","userPrompt","text","message","content"):
  v=d.get(k)
  if isinstance(v,str) and v.strip():
    print(v); sys.exit(0)
print(d.get("hookEventName",""))
' 2>/dev/null || true)

if [ -z "${PROMPT// }" ]; then
  exit 0
fi

# Detect pack-scoped prompts
if ! echo "$PROMPT" | python3 -c '
import sys,re
t=sys.stdin.read().lower()
pat=r"\b(skydio|oteemo|devsecops|drone|x10|x2|dock|axiom|engagement|postmortem|verifier-fleet|linkml|shacl)\b"
sys.exit(0 if re.search(pat,t) else 1)
'; then
  # not pack-scoped
  echo '{"packScoped":false}' >"$STATE_DIR/last-scope.json"
  exit 0
fi

export PATH="${ROOT}/node_modules/.bin:${PATH}"
RESULT=$(npx --yes tsx "$ROOT/.grok/plugins/px-validation-always/scripts/run-scope.ts" --text "$PROMPT" 2>/dev/null || true)

if [ -z "$RESULT" ]; then
  # fail open for scope inject, but mark missing
  echo '{"packScoped":true,"error":"scope_failed"}' >"$STATE_DIR/last-scope.json"
  # still nudge agent
  python3 - <<'PY'
import json
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": (
      "PACK-SCOPED PROMPT: call MCP px_ontology_scope (or px_pack_resolve) before answering. "
      "Include relevantOntologyTag in your reasoning. Full SHACL→Lean→GraphQL requires structured JSON + tool_io_guard/px_validate_cascade."
    )
  }
}))
PY
  exit 0
fi

echo "$RESULT" >"$STATE_DIR/last-scope.json"

# Inject compact context for the model
python3 - <<PY
import json
from pathlib import Path
raw=Path("$STATE_DIR/last-scope.json").read_text()
try:
  d=json.loads(raw)
except Exception:
  d={"raw": raw[:500]}
tag=d.get("relevantOntologyTag") or d.get("ontologyHookContext",{}).get("relevantOntologyTag")
pack=d.get("packResolve",{}).get("pack") or d.get("ontologyHookContext",{}).get("pack")
ontos=d.get("ontologyHookContext",{}).get("ontologies") or d.get("ontologies") or []
lines=[
  "### Validation scope (host hook px-validation-always)",
  f"- relevantOntologyTag: **{tag}**",
  f"- pack: **{pack}**",
  f"- ontologies: {json.dumps(ontos)[:800]}",
  "- Pipeline: for claims of validation use tool_io_guard/px_validate_cascade with structured instance.",
  "- Do not answer pack-scoped questions without acknowledging this tag.",
]
print(json.dumps({
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "\n".join(lines)
  }
}))
PY
