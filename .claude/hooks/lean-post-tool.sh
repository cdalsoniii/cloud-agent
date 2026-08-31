#!/usr/bin/env bash
# Rebuild Lean state when Claude edits a .lean file (PostToolUse hook).
set -euo pipefail

INPUT=""
if [[ ! -t 0 ]]; then
  INPUT="$(cat)"
fi

if [[ -z "$INPUT" ]]; then
  exit 0
fi

if ! echo "$INPUT" | grep -qiE '\.lean["\s}]|\.lean$|file_path.*\.lean'; then
  exit 0
fi

PORT="${LEAN_LIVE_PORT:-9474}"
curl -sf -X POST "http://127.0.0.1:${PORT}/rebuild" >/dev/null 2>&1 || true
exit 0
