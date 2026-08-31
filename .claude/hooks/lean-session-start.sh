#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
export PX_GROK_BUNDLE="${PX_GROK_BUNDLE:-$ROOT/.grok-bundle}"
export PATH="$PX_GROK_BUNDLE/bin:$PATH"
./scripts/lean-stack.sh start >/dev/null 2>&1 || true
./scripts/lean-live-bridge.sh start >/dev/null 2>&1 || true
echo "lean-live: stack and bridge started"
