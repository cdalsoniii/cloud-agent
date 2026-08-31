#!/usr/bin/env bash
# Ensure validation profile + enforcement defaults for the session.
set -euo pipefail
ROOT="${GROK_PROJECT_DIR:-$(pwd)}"
cd "$ROOT"
export PX_VALIDATION_PROFILE="${PX_VALIDATION_PROFILE:-strict}"
STATE_DIR="$ROOT/.px/session"
mkdir -p "$STATE_DIR"
echo "{}" >"$STATE_DIR/last-scope.json"
# Soft enforce-on (does not fail session if script missing)
if [ -x "$ROOT/scripts/px-ontology-mode.sh" ]; then
  bash "$ROOT/scripts/px-ontology-mode.sh" enforce on >/dev/null 2>&1 || true
fi
echo "px-validation-always: session start (profile=$PX_VALIDATION_PROFILE)"
