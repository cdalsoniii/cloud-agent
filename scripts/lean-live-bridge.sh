#!/usr/bin/env bash
# lean-live-bridge.sh — Start/stop the Lean live HTTP/SSE bridge
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RUNTIME_DIR="$REPO_ROOT/.px/lean-live"
PID_FILE="$RUNTIME_DIR/bridge.pid"
LOG_FILE="$RUNTIME_DIR/bridge.log"
BRIDGE="$SCRIPT_DIR/lean-live-bridge.mjs"

cmd="${1:-status}"

mkdir -p "$RUNTIME_DIR"

pid_running() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

do_status() {
  if [[ -f "$PID_FILE" ]] && pid_running "$(cat "$PID_FILE")"; then
    echo "running (pid $(cat "$PID_FILE"))"
    return 0
  fi
  echo "stopped"
  return 1
}

do_start() {
  if do_status >/dev/null 2>&1; then
    echo "Already running (pid $(cat "$PID_FILE"))"
    return 0
  fi
  nohup node "$BRIDGE" >>"$LOG_FILE" 2>&1 &
  local spid=$!
  disown "$spid" 2>/dev/null || true
  sleep 0.5
  if [[ -f "$PID_FILE" ]] && pid_running "$(cat "$PID_FILE")"; then
    echo "lean-live-bridge ready (pid $(cat "$PID_FILE"))"
    return 0
  fi
  if pid_running "$spid"; then
    echo "$spid" >"$PID_FILE"
    echo "lean-live-bridge ready (pid $spid)"
    return 0
  fi
  echo "bridge failed — see $LOG_FILE" >&2
  tail -20 "$LOG_FILE" >&2 || true
  exit 1
}

do_stop() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if pid_running "$pid"; then
      kill "$pid" 2>/dev/null || true
      sleep 0.5
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
  status) do_status; exit $? ;;
  -h|--help)
    echo "Usage: $0 {start|stop|status|restart}"
    exit 0
    ;;
  *)
    echo "Unknown command: $cmd" >&2
    exit 1
    ;;
esac
