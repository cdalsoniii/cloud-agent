#!/usr/bin/env bash
# Source before `claude` to route Claude Code through OpenRouter (ZDR-friendly).
# Usage: source scripts/lib/openrouter-claude-env.sh

openrouter_claude_env() {
  local root="${1:-$(pwd)}"
  if [[ -f "$root/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$root/.env"
    set +a
  fi

  if [[ -z "${OPENROUTER_API_KEY:-}" ]]; then
    echo "OPENROUTER_API_KEY missing — set in $root/.env" >&2
    return 1
  fi

  export OPENROUTER_API_KEY
  export ANTHROPIC_BASE_URL="${ANTHROPIC_BASE_URL:-https://openrouter.ai/api}"
  export ANTHROPIC_AUTH_TOKEN="${ANTHROPIC_AUTH_TOKEN:-$OPENROUTER_API_KEY}"
  export ANTHROPIC_API_KEY=""
  export OPENROUTER_HTTP_REFERER="${OPENROUTER_HTTP_REFERER:-https://brightforestx.com}"
  export OPENROUTER_APP_TITLE="${OPENROUTER_APP_TITLE:-cloud-agent}"
  export HTTP_REFERER="$OPENROUTER_HTTP_REFERER"
  export X_TITLE="$OPENROUTER_APP_TITLE"
}
