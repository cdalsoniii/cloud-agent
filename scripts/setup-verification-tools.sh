#!/usr/bin/env bash
# setup-verification-tools.sh — Install/configure formal verification tools for cloud-agent
# Usage: ./scripts/setup-verification-tools.sh
# Do NOT source the repo .env (Fly tokens break shells). Use dotenv/python loaders instead.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# cloud-agent is at experiments/01-platform/cloud-agent → tools at experiments/tools
TOOLS_DIR="$(cd "$SCRIPT_DIR/../../../tools" 2>/dev/null && pwd || true)"
if [ -z "${TOOLS_DIR:-}" ] || [ ! -d "$TOOLS_DIR" ]; then
  TOOLS_DIR="${HOME}/.local/share/cloud-agent-tools"
fi
mkdir -p "$TOOLS_DIR"/{tla,alloy,lemma/bin}

echo "=== Setting up formal verification tools ==="
echo "TOOLS_DIR=$TOOLS_DIR"

# ─── TLA+ (TLC2) ──────────────────────────────────────────────────────
TLA_JAR="$TOOLS_DIR/tla/tla2tools.jar"
if [ ! -f "$TLA_JAR" ]; then
  echo "Downloading tla2tools.jar (v1.7.4)..."
  curl -fsSL -o "$TLA_JAR" \
    https://github.com/tlaplus/tlaplus/releases/download/v1.7.4/tla2tools.jar
  echo "  Done: $TLA_JAR"
else
  echo "tla2tools.jar already present: $TLA_JAR"
fi

# ─── Alloy Analyzer ───────────────────────────────────────────────────
ALLOY_JAR="$TOOLS_DIR/alloy/alloy.jar"
if [ ! -f "$ALLOY_JAR" ] || [ "$(wc -c < "$ALLOY_JAR")" -lt 1000 ]; then
  echo "Downloading Alloy Analyzer (v6.2.0)..."
  curl -fsSL -o "$ALLOY_JAR" \
    https://github.com/AlloyTools/org.alloytools.alloy/releases/download/v6.2.0/org.alloytools.alloy.dist.jar
  echo "  Done: $ALLOY_JAR"
else
  echo "alloy.jar already present: $ALLOY_JAR"
fi

# ─── Dafny ────────────────────────────────────────────────────────────
if command -v dafny >/dev/null 2>&1; then
  echo "dafny: $(dafny --version 2>/dev/null | head -1)"
else
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Dafny via Homebrew..."
    brew install dafny
  else
    echo "WARNING: dafny not found; install Dafny 4.11+ manually"
  fi
fi

# ─── Quint ────────────────────────────────────────────────────────────
if command -v quint >/dev/null 2>&1; then
  echo "quint: $(quint --version 2>/dev/null || true)"
else
  echo "Installing Quint 0.32.0..."
  npm install -g @informalsystems/quint@0.32.0
fi

# ─── Lean 4 (optional) ────────────────────────────────────────────────
if command -v lean >/dev/null 2>&1; then
  echo "lean: $(lean --version 2>/dev/null | head -1)"
else
  echo "Lean not installed (optional). Install via elan if needed:"
  echo "  curl https://raw.githubusercontent.com/leanprover/elan/master/elan-init.sh -sSf | sh -s -- -y"
fi

echo ""
echo "=== Setup complete ==="
echo "Run ./scripts/verify-local.sh --check-tools to verify"
