#!/usr/bin/env bash
# build-grok-lean.sh — Clone grok-build, apply Lean pane patch, cargo install
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VENDOR="$REPO_ROOT/vendor/grok-build-lean"
UPSTREAM="$VENDOR/upstream"
REF="${GROK_BUILD_REF:-main}"
PATCH="$VENDOR/patches/lean-pane-integration.patch"

mkdir -p "$VENDOR"

if [[ ! -d "$UPSTREAM/.git" ]]; then
  echo "Cloning xai-org/grok-build into $UPSTREAM ..."
  git clone --depth 1 --branch "$REF" https://github.com/xai-org/grok-build.git "$UPSTREAM"
fi

if [[ -f "$PATCH" ]]; then
  echo "Applying patch $PATCH ..."
  (cd "$UPSTREAM" && git apply --check "$PATCH" 2>/dev/null && git apply "$PATCH") || {
    echo "Patch already applied or manual merge required — continuing build"
  }
fi

# Copy reference module for integrators
mkdir -p "$UPSTREAM/crates/xai_grok_pager/src"
cp "$VENDOR/src/lean_pane.rs" "$UPSTREAM/crates/xai_grok_pager/src/lean_pane.rs"

echo "Building grok from $UPSTREAM ..."
(cd "$UPSTREAM" && cargo install --path crates/xai_grok_shell --force --locked)

echo ""
echo "Installed grok with Lean pane reference module."
echo "Enable in ~/.grok/config.toml — see vendor/grok-build-lean/config-snippet.toml"
echo "Start lean-live-bridge before launching grok."
