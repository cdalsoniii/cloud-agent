#!/usr/bin/env bash
# claude-lean-split.sh — OpenRouter Claude left (~60%), Lean Live TUI right (~40%)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
SESSION="${CLAUDE_LEAN_TMUX_SESSION:-claude-lean}"

export PX_GROK_BUNDLE="$BUNDLE_ROOT"
export PATH="$BUNDLE_ROOT/bin:$PATH"
export CLOUD_AGENT_ROOT="$REPO_ROOT"

# shellcheck source=lib/openrouter-claude-env.sh
source "$SCRIPT_DIR/lib/openrouter-claude-env.sh"
openrouter_claude_env "$REPO_ROOT"

CLAUDE_ENV="export ANTHROPIC_BASE_URL=\"$ANTHROPIC_BASE_URL\" ANTHROPIC_AUTH_TOKEN=\"$ANTHROPIC_AUTH_TOKEN\" ANTHROPIC_API_KEY=\"\" OPENROUTER_HTTP_REFERER=\"$OPENROUTER_HTTP_REFERER\" X_TITLE=\"$OPENROUTER_APP_TITLE\" PX_GROK_BUNDLE=\"$BUNDLE_ROOT\" PATH=\"$BUNDLE_ROOT/bin:\$PATH\" CLOUD_AGENT_ROOT=\"$REPO_ROOT\""
CLAUDE_CMD="$CLAUDE_ENV && cd \"$REPO_ROOT\" && exec claude"
TUI_CMD="export PX_GROK_BUNDLE=\"$BUNDLE_ROOT\" PATH=\"$BUNDLE_ROOT/bin:\$PATH\" && cd \"$REPO_ROOT\" && exec python3 scripts/lean-live-tui.py"

echo "Starting Lean stack + bridge..."
"$SCRIPT_DIR/lean-stack.sh" start
"$SCRIPT_DIR/lean-live-bridge.sh" start

if command -v tmux >/dev/null 2>&1; then
  echo "Launching tmux split (Claude via OpenRouter left, Lean Live right)..."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  tmux new-session -d -s "$SESSION" -n claude-lean -c "$REPO_ROOT" bash -lc "$CLAUDE_CMD"
  tmux split-window -h -p 40 -t "$SESSION" -c "$REPO_ROOT" bash -lc "$TUI_CMD"
  tmux select-pane -t "$SESSION".0
  tmux select-layout -t "$SESSION" even-horizontal
  exec tmux attach -t "$SESSION"
fi

echo "tmux not found — run: brew install tmux" >&2
echo "Fallback: terminal 1: ./scripts/claude-openrouter.sh" >&2
echo "          terminal 2: python3 scripts/lean-live-tui.py" >&2
exec bash -lc "$CLAUDE_CMD"
