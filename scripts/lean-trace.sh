#!/usr/bin/env bash
# lean-trace.sh — Capture the Lean 4 reasoning trail for a module.
#
# Emits the per-step reasoning output (which lemmas Lean applied and the
# substitutions it performed, e.g. `Nat.zero_add:1000, 0 + b ==> b`) to
# stdout.  This is the "reasoning trail" that lake-build's pass/fail verdict
# hides.  It is produced by Lean's own tracing machinery (`set_option
# trace.Meta.Tactic.simp.rewrite true`) when a module is elaborated.
#
# Usage: lean-trace.sh [module]   (module defaults to PxCloudAgent.Trace)
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
# Ensure dependencies (e.g. PxCloudAgent.Basic) are built so we can import them.
export ELAN_HOME
export PATH="$ELAN_HOME/bin:$BUNDLE/bin:$PATH"
lake build >/dev/null 2>&1 || true

# Convert module name to source path: PxCloudAgent.Trace -> PxCloudAgent/Trace.lean
SRC="${MODULE//./\/}.lean"
export LEAN_PATH="$(pwd)/.lake/build/lib"

if [[ ! -f "$SRC" ]]; then
  echo "error: module source not found: $SRC" >&2
  exit 1
fi

# Elaborate with tracing enabled; the `set_option trace.Meta.Tactic.simp.rewrite`
# directives live inside the module, so Lean prints the reasoning trail.
"$LEAN" -DautoImplicit=false -R . "$SRC" 2>&1 || {
  echo "error: Lean elaboration failed for $SRC" >&2
  exit 1
}
