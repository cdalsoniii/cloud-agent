#!/usr/bin/env bash
# grok-bundle-install.sh — Install PX Grok Surreal bundle and print env setup
# Usage: ./scripts/grok-bundle-install.sh [--global]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
GLOBAL=false

for arg in "$@"; do
  case "$arg" in
    --global) GLOBAL=true ;;
    -h|--help)
      echo "Usage: $0 [--global]"
      echo "  --global  Append PX_GROK_BUNDLE exports to ~/.zshrc"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

export PX_GROK_BUNDLE="$BUNDLE_ROOT"
"$SCRIPT_DIR/grok-bundle-fetch.sh"

ENV_BLOCK="# PX Grok Surreal bundle (cloud-agent)
export PX_GROK_BUNDLE=\"$BUNDLE_ROOT\"
export PATH=\"\$PX_GROK_BUNDLE/bin:\$PATH\""

echo ""
echo "=== Install complete ==="
echo ""
echo "Add to your shell (or run each session):"
echo ""
echo "$ENV_BLOCK"
echo ""

if [[ "$GLOBAL" == true ]]; then
  ZSHRC="${HOME}/.zshrc"
  MARKER="# PX Grok Surreal bundle"
  if grep -qF "$MARKER" "$ZSHRC" 2>/dev/null; then
    echo "Already present in $ZSHRC"
  else
    {
      echo ""
      echo "$ENV_BLOCK"
    } >> "$ZSHRC"
    echo "Appended to $ZSHRC"
  fi
fi

if command -v grok >/dev/null 2>&1; then
  echo "grok: $(grok --version 2>/dev/null | head -1 || echo found)"
else
  echo "grok: not on PATH — install via: curl -fsSL https://x.ai/cli/install.sh | bash"
fi

echo ""
echo "Next steps:"
echo "  export PX_GROK_BUNDLE=\"$BUNDLE_ROOT\" PATH=\"\$PX_GROK_BUNDLE/bin:\$PATH\""
echo "  ./scripts/surreal-stack.sh start"
echo "  ./scripts/smoke-grok-surreal.sh"
echo "  ./scripts/lean-stack.sh start && ./scripts/lean-live-bridge.sh start"
echo "  ./scripts/grok-lean-split.sh"
