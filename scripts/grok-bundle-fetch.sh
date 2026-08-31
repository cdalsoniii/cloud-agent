#!/usr/bin/env bash
# grok-bundle-fetch.sh — Download/build Surreal toolchain into .grok-bundle/
# Usage: ./scripts/grok-bundle-fetch.sh [--force]
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$REPO_ROOT/grok-dist/manifest.yaml"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
CACHE_DIR="$REPO_ROOT/grok-dist/.cache"
FORCE=false

for arg in "$@"; do
  case "$arg" in
    --force) FORCE=true ;;
    -h|--help)
      echo "Usage: $0 [--force]"
      exit 0
      ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

if [[ ! -f "$MANIFEST" ]]; then
  echo "Manifest not found: $MANIFEST" >&2
  exit 1
fi

# Minimal YAML readers (manifest is simple key/value)
yaml_get() {
  local key="$1"
  grep -E "^${key}:" "$MANIFEST" | head -1 | sed -E "s/^${key}:[[:space:]]*//" | tr -d '"'
}

yaml_nested() {
  local section="$1" key="$2"
  awk -v section="$section" -v key="$key" '
    $0 ~ "^" section ":" { in_section=1; next }
    in_section && /^[a-zA-Z]/ && $0 !~ "^  " { in_section=0 }
    in_section && $0 ~ "^  " key ":" {
      sub(/^  [^:]+:[[:space:]]*/, "")
      gsub(/"/, "")
      print
      exit
    }
  ' "$MANIFEST"
}

SURREAL_VERSION="$(yaml_nested surreal version)"
SURREAL_URL="$(yaml_nested surreal url)"
SURREAL_BINARY="$(yaml_nested surreal binary)"

SURREALKIT_VERSION="$(yaml_nested surrealkit version)"
SURREALKIT_URL="$(yaml_nested surrealkit url)"
SURREALKIT_SHA256="$(yaml_nested surrealkit sha256)"
SURREALKIT_BINARY="$(yaml_nested surrealkit binary)"

SURREALMCP_GIT="$(yaml_nested surrealmcp git)"
SURREALMCP_TAG="$(yaml_nested surrealmcp tag)"
SURREALMCP_BINARY="$(yaml_nested surrealmcp binary)"

LEAN_TOOLCHAIN="$(yaml_nested lean toolchain)"
LEAN_ELAN_URL="$(yaml_nested lean elan_init_url)"

PLATFORM="$(yaml_get platform)"
if [[ "$(uname -m)" != "arm64" ]] || [[ "$(uname -s)" != "Darwin" ]]; then
  echo "WARNING: manifest targets $PLATFORM; host is $(uname -s)/$(uname -m)" >&2
fi

mkdir -p "$BUNDLE_ROOT/bin" "$BUNDLE_ROOT/data" "$CACHE_DIR"

MANIFEST_HASH="$(shasum -a 256 "$MANIFEST" | awk '{print $1}')"
VERSION_FILE="$BUNDLE_ROOT/VERSION"

if [[ "$FORCE" != true ]] && [[ -f "$VERSION_FILE" ]] && [[ "$(cat "$VERSION_FILE")" == "$MANIFEST_HASH" ]]; then
  if [[ -x "$BUNDLE_ROOT/bin/$SURREAL_BINARY" ]] \
    && [[ -x "$BUNDLE_ROOT/bin/$SURREALKIT_BINARY" ]] \
    && [[ -x "$BUNDLE_ROOT/bin/$SURREALMCP_BINARY" ]] \
    && [[ -x "$BUNDLE_ROOT/bin/lean" ]] \
    && [[ -x "$BUNDLE_ROOT/bin/lake" ]]; then
    echo "Bundle up to date ($BUNDLE_ROOT)"
    exit 0
  fi
fi

echo "=== PX Grok Surreal bundle fetch ==="
echo "BUNDLE_ROOT=$BUNDLE_ROOT"

fetch_surreal() {
  local dest="$CACHE_DIR/surreal-${SURREAL_VERSION}.tgz"
  echo "Fetching surreal ${SURREAL_VERSION}..."
  curl -fsSL "$SURREAL_URL" -o "$dest"
  tar -xzf "$dest" -C "$CACHE_DIR"
  install -m 755 "$CACHE_DIR/surreal" "$BUNDLE_ROOT/bin/surreal"
  echo "  surreal: $($BUNDLE_ROOT/bin/surreal version 2>/dev/null | head -1 || true)"
}

fetch_surrealkit() {
  local dest="$CACHE_DIR/surrealkit-${SURREALKIT_VERSION}.tar.gz"
  echo "Fetching surrealkit ${SURREALKIT_VERSION}..."
  curl -fsSL "$SURREALKIT_URL" -o "$dest"
  if [[ -n "$SURREALKIT_SHA256" ]]; then
    local actual
    actual="$(shasum -a 256 "$dest" | awk '{print $1}')"
    if [[ "$actual" != "$SURREALKIT_SHA256" ]]; then
      echo "SHA256 mismatch for surrealkit (expected $SURREALKIT_SHA256, got $actual)" >&2
      exit 1
    fi
  fi
  tar -xzf "$dest" -C "$CACHE_DIR"
  local extracted
  extracted="$(find "$CACHE_DIR" -maxdepth 1 -name 'surrealkit' -type f 2>/dev/null | head -1)"
  if [[ -z "$extracted" ]]; then
    extracted="$(find "$CACHE_DIR" -name 'surrealkit' -type f 2>/dev/null | head -1)"
  fi
  if [[ -z "$extracted" ]]; then
    echo "Could not find surrealkit binary in archive" >&2
    exit 1
  fi
  install -m 755 "$extracted" "$BUNDLE_ROOT/bin/surrealkit"
  echo "  surrealkit: $($BUNDLE_ROOT/bin/surrealkit --version 2>/dev/null || echo installed)"
}

fetch_surrealmcp() {
  if [[ "$FORCE" != true ]] && [[ -x "$BUNDLE_ROOT/bin/$SURREALMCP_BINARY" ]]; then
    if file "$BUNDLE_ROOT/bin/$SURREALMCP_BINARY" 2>/dev/null | grep -q "Mach-O"; then
      echo "surrealmcp already present"
      return
    fi
    rm -f "$BUNDLE_ROOT/bin/$SURREALMCP_BINARY"
  fi

  install_surrealmcp_docker_wrapper() {
    if ! command -v docker >/dev/null 2>&1; then
      return 1
    fi
    echo "Installing surrealmcp Docker stdio wrapper (native build unavailable)..."
    cat >"$BUNDLE_ROOT/bin/$SURREALMCP_BINARY" <<'WRAP'
#!/usr/bin/env bash
# PX Grok bundle — SurrealMCP via Docker stdio (fallback when native build fails)
set -euo pipefail
exec docker run --rm -i \
  -e SURREALDB_URL \
  -e SURREALDB_NS \
  -e SURREALDB_DB \
  -e SURREALDB_USER \
  -e SURREALDB_PASS \
  surrealdb/surrealmcp:latest \
  start "$@"
WRAP
    chmod +x "$BUNDLE_ROOT/bin/$SURREALMCP_BINARY"
    return 0
  }

  if ! command -v cargo >/dev/null 2>&1; then
    echo "cargo not found, using Docker stdio wrapper..."
    install_surrealmcp_docker_wrapper && { echo "  surrealmcp: wrapper (docker)"; return; }
    echo "ERROR: install Rust (https://rustup.rs) or Docker" >&2
    exit 1
  fi

  echo "Building surrealmcp ${SURREALMCP_TAG} (this may take several minutes)..."
  export CARGO_TARGET_DIR="$CACHE_DIR/cargo-target"
  rustup target add aarch64-apple-darwin >/dev/null 2>&1 || true

  if [[ -d "/usr/local/opt/llvm/lib" ]]; then
    export LIBCLANG_PATH="/usr/local/opt/llvm/lib"
  elif [[ -d "/opt/homebrew/opt/llvm/lib" ]]; then
    export LIBCLANG_PATH="/opt/homebrew/opt/llvm/lib"
  fi

  set +e
  cargo install \
    --git "$SURREALMCP_GIT" \
    --tag "$SURREALMCP_TAG" \
    --locked \
    --target aarch64-apple-darwin \
    --root "$BUNDLE_ROOT" \
    --force \
    2>&1 | tail -30
  local cargo_status=$?
  set -e

  if [[ $cargo_status -eq 0 ]] && file "$BUNDLE_ROOT/bin/$SURREALMCP_BINARY" 2>/dev/null | grep -q "Mach-O"; then
    echo "  surrealmcp: installed (cargo, aarch64-apple-darwin)"
    return
  fi

  echo "cargo build failed (exit $cargo_status), installing Docker stdio wrapper..."
  if install_surrealmcp_docker_wrapper; then
    echo "  surrealmcp: wrapper (docker)"
    return
  fi

  echo "ERROR: could not install surrealmcp" >&2
  echo "Install LLVM: brew install llvm — then re-run." >&2
  exit 1
}

fetch_lean() {
  local elan_home="$BUNDLE_ROOT/.elan"
  local elan_bin="$elan_home/bin/elan"

  if [[ "$FORCE" != true ]] && [[ -x "$BUNDLE_ROOT/bin/lean" ]] && [[ -x "$BUNDLE_ROOT/bin/lake" ]]; then
    echo "lean/lake already present"
    return
  fi

  echo "Installing elan + Lean toolchain ${LEAN_TOOLCHAIN}..."
  export ELAN_HOME="$elan_home"
  mkdir -p "$elan_home"

  if [[ ! -x "$elan_bin" ]]; then
    curl -fsSL "$LEAN_ELAN_URL" | sh -s -- -y --default-toolchain none --no-modify-path
  fi

  if [[ ! -x "$elan_bin" ]]; then
    echo "ERROR: elan install failed (expected $elan_bin)" >&2
    exit 1
  fi

  "$elan_bin" toolchain install "$LEAN_TOOLCHAIN"
  "$elan_bin" default "$LEAN_TOOLCHAIN"

  install_lean_wrapper() {
    local name="$1"
    cat >"$BUNDLE_ROOT/bin/$name" <<WRAP
#!/usr/bin/env bash
set -euo pipefail
export ELAN_HOME="$elan_home"
exec "\$ELAN_HOME/bin/$name" "\$@"
WRAP
    chmod +x "$BUNDLE_ROOT/bin/$name"
  }

  install_lean_wrapper lean
  install_lean_wrapper lake
  install_lean_wrapper elan

  echo "  lean: $($BUNDLE_ROOT/bin/lean --version 2>/dev/null | head -1 || echo installed)"
  echo "  lake: $($BUNDLE_ROOT/bin/lake --version 2>/dev/null | head -1 || echo installed)"
}

fetch_surreal
fetch_surrealkit
fetch_surrealmcp
fetch_lean

echo "$MANIFEST_HASH" > "$VERSION_FILE"
echo "=== Fetch complete ==="
ls -la "$BUNDLE_ROOT/bin/"
