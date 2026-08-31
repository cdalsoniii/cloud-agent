#!/usr/bin/env bash
# lean-stack.sh — lake serve lifecycle for PX Grok Lean bundle
# Usage: ./scripts/lean-stack.sh {start|stop|status|health|restart|build}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
MANIFEST="$REPO_ROOT/grok-dist/manifest.yaml"
RUNTIME_DIR="$REPO_ROOT/.px/lean-live"
PID_FILE="$RUNTIME_DIR/lake-serve.pid"
LOG_FILE="$RUNTIME_DIR/lake-serve.log"
LAKE_BIN="$BUNDLE_ROOT/bin/lake"
LEAN_BIN="$BUNDLE_ROOT/bin/lean"

LEAN_WORKSPACE="$("$SCRIPT_DIR/lib/resolve-lean-workspace.sh")"
LEAN_LIVE_PORT="${LEAN_LIVE_PORT:-9474}"

if [[ -f "$MANIFEST" ]]; then
  _port="$(awk '/^lean_live:/,/^[^ ]/ { if ($0 ~ /^  port:/) { sub(/^  port:[[:space:]]*/, ""); print; exit } }' "$MANIFEST")"
  [[ -n "$_port" ]] && LEAN_LIVE_PORT="$_port"
fi

mkdir -p "$RUNTIME_DIR"

cmd="${1:-status}"

ensure_bundle() {
  if [[ ! -x "$LAKE_BIN" ]] || [[ ! -x "$LEAN_BIN" ]]; then
    echo "lean/lake not found — run ./scripts/grok-bundle-install.sh" >&2
    exit 1
  fi
}

pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

do_health() {
  [[ -f "$PID_FILE" ]] && pid_running "$(cat "$PID_FILE")"
}

do_status() {
  if do_health; then
    echo "running (pid $(cat "$PID_FILE"), workspace $LEAN_WORKSPACE)"
    return 0
  fi
  if [[ -f "$PID_FILE" ]]; then
    echo "stale pid file"
    rm -f "$PID_FILE"
  fi
  echo "stopped (workspace $LEAN_WORKSPACE)"
  return 1
}

do_build() {
  ensure_bundle
  echo "Building $LEAN_WORKSPACE ..."
  (cd "$LEAN_WORKSPACE" && "$LAKE_BIN" build)
}

do_start() {
  ensure_bundle
  if do_health; then
    echo "Already running (pid $(cat "$PID_FILE"))"
    return 0
  fi
  echo "Starting lake serve in $LEAN_WORKSPACE ..."
  (cd "$LEAN_WORKSPACE" && "$LAKE_BIN" exe cache get >/dev/null 2>&1 || true)
  # lake serve reads LSP from stdin; keep stdin open via a blocking reader
  nohup bash -c "cd \"$LEAN_WORKSPACE\" && tail -f /dev/null | exec \"$LAKE_BIN\" serve" >>"$LOG_FILE" 2>&1 &
  local spid=$!
  disown "$spid" 2>/dev/null || true
  echo "$spid" >"$PID_FILE"
  sleep 1
  for _ in $(seq 1 20); do
    if pid_running "$spid"; then
      echo "lake serve ready (pid $spid)"
      return 0
    fi
    sleep 0.25
  done
  echo "lake serve failed — see $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2 || true
  exit 1
}

do_stop() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if pid_running "$pid"; then
      echo "Stopping lake serve (pid $pid)..."
      kill "$pid" 2>/dev/null || true
      for _ in $(seq 1 20); do
        pid_running "$pid" || break
        sleep 0.25
      done
      if pid_running "$pid"; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
    rm -f "$PID_FILE"
    echo "stopped"
    return 0
  fi
  echo "not running"
}

case "$cmd" in
  start) do_start ;;
  stop) do_stop ;;
  restart) do_stop; do_start ;;
  build) do_build ;;
  status) do_status; exit $? ;;
  health)
    do_health && echo "ok" || { echo "unhealthy" >&2; exit 1; }
    ;;
  workspace) echo "$LEAN_WORKSPACE" ;;
  -h|--help)
    echo "Usage: $0 {start|stop|status|health|restart|build|workspace}"
    exit 0
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    exit 1
    ;;
esac
