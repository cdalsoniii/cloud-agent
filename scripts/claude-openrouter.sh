#!/usr/bin/env bash
# claude-openrouter.sh — Claude Code via OpenRouter (reads OPENROUTER_API_KEY from .env)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# shellcheck source=lib/openrouter-claude-env.sh
source "$SCRIPT_DIR/lib/openrouter-claude-env.sh"
openrouter_claude_env "$REPO_ROOT"

export PX_GROK_BUNDLE="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
export PATH="$PX_GROK_BUNDLE/bin:$PATH"

cd "$REPO_ROOT"
exec claude "$@"
