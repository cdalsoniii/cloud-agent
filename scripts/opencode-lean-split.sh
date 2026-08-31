#!/usr/bin/env bash
# opencode-lean-split.sh — OpenCode (OpenRouter) left, Lean Live TUI right
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
SESSION="${OPENCODE_LEAN_TMUX_SESSION:-opencode-lean}"

export PX_GROK_BUNDLE="$BUNDLE_ROOT"
export PATH="$BUNDLE_ROOT/bin:$PATH"
export CLOUD_AGENT_ROOT="$REPO_ROOT"

if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$REPO_ROOT/.env"
  set +a
fi

OPENCODE_ENV="export OPENROUTER_API_KEY=\"${OPENROUTER_API_KEY:-}\" PX_GROK_BUNDLE=\"$BUNDLE_ROOT\" PATH=\"$BUNDLE_ROOT/bin:\$PATH\" CLOUD_AGENT_ROOT=\"$REPO_ROOT\""
OPENCODE_CMD="$OPENCODE_ENV && cd \"$REPO_ROOT\" && exec opencode"
TUI_CMD="export PX_GROK_BUNDLE=\"$BUNDLE_ROOT\" PATH=\"$BUNDLE_ROOT/bin:\$PATH\" && cd \"$REPO_ROOT\" && exec python3 scripts/lean-live-tui.py"

echo "Starting Lean stack + bridge..."
"$SCRIPT_DIR/lean-stack.sh" start
"$SCRIPT_DIR/lean-live-bridge.sh" start

if command -v tmux >/dev/null 2>&1; then
  echo "Launching tmux split (OpenCode left, Lean Live right)..."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  tmux new-session -d -s "$SESSION" -n opencode-lean -c "$REPO_ROOT" bash -lc "$OPENCODE_CMD"
  tmux split-window -h -p 40 -t "$SESSION" -c "$REPO_ROOT" bash -lc "$TUI_CMD"
  tmux select-pane -t "$SESSION".0
  tmux select-layout -t "$SESSION" even-horizontal
  exec tmux attach -t "$SESSION"
fi

echo "tmux not found — run opencode in one terminal, lean-live-tui.py in another" >&2
exec bash -lc "$OPENCODE_CMD"
