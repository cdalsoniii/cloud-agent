#!/usr/bin/env bash
# grok-lean-split.sh — Launch Grok in a single full window (no Lean live side pane).
# Kept name for compatibility with `npm run grok:lean`; the right-side Lean TUI
# pane is intentionally not created anymore.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
SESSION="${GROK_LEAN_TMUX_SESSION:-grok-lean}"

export PX_GROK_BUNDLE="$BUNDLE_ROOT"
export PATH="$BUNDLE_ROOT/bin:$PATH"
export CLOUD_AGENT_ROOT="$REPO_ROOT"

GROK_ENV="export PX_GROK_BUNDLE=\"$BUNDLE_ROOT\" PATH=\"$BUNDLE_ROOT/bin:\$PATH\" CLOUD_AGENT_ROOT=\"$REPO_ROOT\""
GROK_CMD="$GROK_ENV && cd \"$REPO_ROOT\" && exec grok"

launch_tmux() {
  if ! command -v tmux >/dev/null 2>&1; then
    return 1
  fi
  echo "Launching tmux session (Grok, single window — no Lean Live pane)..."
  tmux kill-session -t "$SESSION" 2>/dev/null || true
  tmux new-session -d -s "$SESSION" -n grok-lean -c "$REPO_ROOT" bash -lc "$GROK_CMD"
  exec tmux attach -t "$SESSION"
}

launch_zellij() {
  if ! command -v zellij >/dev/null 2>&1; then
    return 1
  fi
  local layout_file
  layout_file="$(mktemp "${TMPDIR:-/tmp}/grok-lean.XXXXXX.kdl")"
  trap 'rm -f "$layout_file"' EXIT
  cat >"$layout_file" <<KDL
layout {
  default_tab_template {
    pane
  }
}

session {
  name "grok-lean"
}

tab {
  pane {
    command "bash"
    args "-lc" "$GROK_CMD"
  }
}
KDL
  echo "Launching zellij session (Grok, single window — no Lean Live pane)..."
  exec zellij --layout "$layout_file" attach -c grok-lean 2>/dev/null \
    || zellij --layout "$layout_file"
}

if launch_zellij; then
  :
elif launch_tmux; then
  :
else
  echo "" >&2
  echo "No terminal multiplexer found (need tmux or zellij)." >&2
  echo "  brew install tmux    # recommended" >&2
  echo "  brew install zellij  # optional" >&2
  echo "" >&2
  echo "Starting Grok (no side panel)..." >&2
  exec bash -lc "$GROK_CMD"
fi
