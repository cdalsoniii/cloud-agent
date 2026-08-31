#!/usr/bin/env bash
# resolve-lean-workspace.sh — Print absolute LEAN_WORKSPACE path
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -n "${LEAN_WORKSPACE:-}" ]]; then
  if [[ -d "$LEAN_WORKSPACE" ]]; then
    cd "$LEAN_WORKSPACE" && pwd
    exit 0
  fi
  echo "LEAN_WORKSPACE is set but not a directory: $LEAN_WORKSPACE" >&2
  exit 1
fi

PX_VALIDATE_ROOT="${PX_VALIDATE_ROOT:-/Users/clifforddalsoniii/Documents/Brightforest/projects/tools/px-validate}"
FORMAL="$PX_VALIDATE_ROOT/formal"
if [[ -f "$FORMAL/lakefile.lean" ]] || [[ -f "$FORMAL/lakefile.toml" ]]; then
  cd "$FORMAL" && pwd
  exit 0
fi

DEFAULT="$REPO_ROOT/config/verification/lean"
if [[ -d "$DEFAULT" ]]; then
  cd "$DEFAULT" && pwd
  exit 0
fi

echo "No Lean workspace found. Set LEAN_WORKSPACE or add lakefile.lean under px-validate/formal." >&2
exit 1
