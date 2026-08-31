#!/usr/bin/env bash
# surreal-stack.sh — Native SurrealDB lifecycle for PX Grok bundle
# Usage: ./scripts/surreal-stack.sh {start|stop|status|health|restart}
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUNDLE_ROOT="${PX_GROK_BUNDLE:-$REPO_ROOT/.grok-bundle}"
MANIFEST="$REPO_ROOT/grok-dist/manifest.yaml"
PID_FILE="$BUNDLE_ROOT/surreal.pid"
DATA_DIR="$BUNDLE_ROOT/data"
LOG_FILE="$BUNDLE_ROOT/surreal.log"

SURREAL_BIN="$BUNDLE_ROOT/bin/surreal"
BIND="127.0.0.1:8000"
SURREAL_USER="root"
SURREAL_PASS="root"

if [[ -f "$MANIFEST" ]]; then
  _bind="$(awk '/^  bind:/ {sub(/^  bind:[[:space:]]*/, ""); gsub(/"/, ""); print; exit}' "$MANIFEST")"
  [[ -n "$_bind" ]] && BIND="$_bind"
  _user="$(awk '/^  user:/ {sub(/^  user:[[:space:]]*/, ""); gsub(/"/, ""); print; exit}' "$MANIFEST")"
  [[ -n "$_user" ]] && SURREAL_USER="$_user"
  _pass="$(awk '/^  pass:/ {sub(/^  pass:[[:space:]]*/, ""); gsub(/"/, ""); print; exit}' "$MANIFEST")"
  [[ -n "$_pass" ]] && SURREAL_PASS="$_pass"
fi

cmd="${1:-status}"

ensure_bundle() {
  if [[ ! -x "$SURREAL_BIN" ]]; then
    echo "surreal not found at $SURREAL_BIN — run ./scripts/grok-bundle-install.sh" >&2
    exit 1
  fi
  mkdir -p "$DATA_DIR"
}

port_in_use() {
  if command -v lsof >/dev/null 2>&1; then
    lsof -i ":8000" -sTCP:LISTEN -t >/dev/null 2>&1
    return $?
  fi
  curl -sf -o /dev/null "http://127.0.0.1:8000/health" 2>/dev/null
}

pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

do_health() {
  curl -sf "http://127.0.0.1:8000/health" >/dev/null
}

do_status() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if pid_running "$pid"; then
      echo "running (pid $pid, bind $BIND)"
      do_health && echo "health: ok" || echo "health: unreachable"
      return 0
    fi
    echo "stale pid file (pid $pid not running)"
    rm -f "$PID_FILE"
  fi
  if port_in_use; then
    echo "port 8000 in use (not managed by this script — Docker?)"
    do_health && echo "health: ok" || echo "health: unreachable"
    return 0
  fi
  echo "stopped"
  return 1
}

do_start() {
  ensure_bundle
  if [[ -f "$PID_FILE" ]] && pid_running "$(cat "$PID_FILE")"; then
    echo "Already running (pid $(cat "$PID_FILE"))"
    return 0
  fi
  if port_in_use; then
    echo "Port 8000 already in use. Stop Docker Surreal or run: docker compose down" >&2
    exit 1
  fi
  echo "Starting SurrealDB (rocksdb:$DATA_DIR/db) on $BIND..."
  # disown so the server survives when this script's shell exits (e.g. CI / agent runners)
  nohup "$SURREAL_BIN" start \
    --log info \
    --bind "$BIND" \
    --user "$SURREAL_USER" \
    --pass "$SURREAL_PASS" \
    "rocksdb://$DATA_DIR/db" \
    >>"$LOG_FILE" 2>&1 &
  local spid=$!
  disown "$spid" 2>/dev/null || true
  echo "$spid" >"$PID_FILE"
  sleep 1
  for _ in $(seq 1 30); do
    if do_health; then
      echo "SurrealDB ready (pid $(cat "$PID_FILE"))"
      return 0
    fi
    sleep 0.5
  done
  echo "SurrealDB failed to become healthy — see $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2 || true
  exit 1
}

do_stop() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if pid_running "$pid"; then
      echo "Stopping SurrealDB (pid $pid)..."
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
  echo "not running (no pid file)"
}

case "$cmd" in
  start) do_start ;;
  stop) do_stop ;;
  restart) do_stop; do_start ;;
  status) do_status; exit $? ;;
  health)
    do_health && echo "ok" || { echo "unhealthy" >&2; exit 1; }
    ;;
  -h|--help)
    echo "Usage: $0 {start|stop|status|health|restart}"
    exit 0
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    exit 1
    ;;
esac
