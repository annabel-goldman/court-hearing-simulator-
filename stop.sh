#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.run"
STOPPED_ANY=0

log() {
  echo "[stop] $*"
}

list_port_pids() {
  local port="$1"
  lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NF' | sort -u || true
}

kill_pid_gracefully() {
  local pid="$1"
  local grace_seconds="${2:-3}"
  local i

  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

  log "Stopping PID $pid"
  STOPPED_ANY=1
  kill "$pid" 2>/dev/null || true
  for ((i = 0; i < grace_seconds; i++)); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 1
  done

  kill -9 "$pid" 2>/dev/null || true
}

kill_pidfile_if_present() {
  local label="$1"
  local pidfile="$2"
  if [[ ! -f "$pidfile" ]]; then
    return 0
  fi

  local pid
  pid="$(tr -d '[:space:]' < "$pidfile" 2>/dev/null || true)"
  if [[ -n "$pid" ]]; then
    log "Stopping $label from pid file ($pid)"
    kill_pid_gracefully "$pid" 3
  fi

  rm -f "$pidfile"
}

kill_port_listeners() {
  local port="$1"
  local pids

  pids="$(list_port_pids "$port")"
  if [[ -z "$pids" ]]; then
    return 0
  fi

  log "Stopping listeners on port $port: $(echo "$pids" | tr '\n' ' ')"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill_pid_gracefully "$pid" 3
  done <<< "$pids"
}

kill_pidfile_if_present "backend" "$LOG_DIR/backend.pid"
kill_pidfile_if_present "frontend" "$LOG_DIR/frontend.pid"
kill_port_listeners 8000
kill_port_listeners 5173
kill_port_listeners 3000

if [[ "$STOPPED_ANY" -eq 1 ]]; then
  log "Done. Court Simulator services stopped."
else
  log "No matching Court Simulator processes were running."
fi
