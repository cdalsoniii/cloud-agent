#!/usr/bin/env bash
# toggle-ontology-edit.sh — thin wrapper (OpenCode Shift+O + Grok /ontology-edit).
# Prefer: bash scripts/px-ontology-mode.sh edit on|off|status|toggle
set -euo pipefail
ROOT="${1:-$PWD}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PX_MODE_ROOT="$ROOT"
# if first arg is a path, use as root; if on/off/status use as action
ACTION="toggle"
if [[ "${1:-}" == "on" || "${1:-}" == "off" || "${1:-}" == "status" || "${1:-}" == "toggle" ]]; then
  ACTION="$1"
  export PX_MODE_ROOT="$PWD"
elif [[ -n "${2:-}" ]]; then
  ACTION="$2"
fi
exec bash "$SCRIPT_DIR/px-ontology-mode.sh" edit "$ACTION"
