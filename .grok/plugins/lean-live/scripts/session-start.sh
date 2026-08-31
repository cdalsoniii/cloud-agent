#!/usr/bin/env bash
# Start lean stack + bridge when a Grok session begins (best-effort).
set -euo pipefail

ROOT="${GROK_PROJECT_DIR:-$(pwd)}"
cd "$ROOT"

export PX_GROK_BUNDLE="${PX_GROK_BUNDLE:-$ROOT/.grok-bundle}"
export PATH="$PX_GROK_BUNDLE/bin:$PATH"

./scripts/lean-stack.sh start >/dev/null 2>&1 || true
./scripts/lean-live-bridge.sh start >/dev/null 2>&1 || true

echo "lean-live: stack and bridge started (if bundle installed)"
