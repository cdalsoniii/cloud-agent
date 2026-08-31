#!/usr/bin/env bash
# lean-tree.sh — Capture the Lean 4 per-tactic goal tree for a module.
#
# Runs lean-tree-driver.lean against the module and emits a single JSON object on
# stdout: { "ok", "exitCode", "error", "nodes":[...], "messages":[...] }.
# Each node is one tactic from the module's InfoTree with the full goal state
# (goals + hypotheses) before and after the tactic.
#
# Usage: lean-tree.sh [module]   (module defaults to PxCloudAgent.Trace)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
WORKSPACE="${LEAN_WORKSPACE:-$REPO_ROOT/config/verification/lean}"
MODULE="${1:-PxCloudAgent.Trace}"

BUNDLE="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
ELAN_HOME="$BUNDLE/.elan"
LEAN="$ELAN_HOME/toolchains/leanprover--lean4---v4.14.0/bin/lean"

if [[ ! -x "$LEAN" ]]; then
  echo "error: Lean binary not found at $LEAN" >&2
  exit 1
fi

cd "$WORKSPACE"
export ELAN_HOME
export PATH="$ELAN_HOME/bin:$BUNDLE/bin:$PATH"
# Ensure dependencies (e.g. PxCloudAgent.Basic) are built so we can import them.
lake build >/dev/null 2>&1 || true

# Convert module name to source path: PxCloudAgent.Trace -> PxCloudAgent/Trace.lean
SRC="${MODULE//./\/}.lean"
export LEAN_PATH="$(pwd)/.lake/build/lib"

if [[ ! -f "$SRC" ]]; then
  echo "error: module source not found: $SRC" >&2
  exit 1
fi

# The driver prints the goal-tree JSON to stdout.  `--run` executes it on the
# REPO_ROOT script path (not the workspace), so resolve it explicitly.
"$LEAN" -DautoImplicit=false --run "$SCRIPT_DIR/lean-tree-driver.lean" "$SRC" "$MODULE" 2>/dev/null || {
  echo "error: goal-tree extraction failed for $MODULE" >&2
  exit 1
}
