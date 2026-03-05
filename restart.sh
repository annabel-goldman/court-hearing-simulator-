#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.run"
mkdir -p "$LOG_DIR"

if command -v bun >/dev/null 2>&1; then
  FRONTEND_PM="bun"
  FRONTEND_INSTALL_CMD=(bun install)
  FRONTEND_BUILD_CMD=(bun run build)
  FRONTEND_DEV_CMD=(bun run dev --host 0.0.0.0 --port 5173)
elif command -v npm >/dev/null 2>&1; then
  FRONTEND_PM="npm"
  FRONTEND_INSTALL_CMD=(npm install)
  FRONTEND_BUILD_CMD=(npm run build)
  FRONTEND_DEV_CMD=(npm run dev -- --host 0.0.0.0 --port 5173)
else
  echo "Error: bun or npm is required."
  exit 1
fi

log() {
  echo "[restart] $*"
}

list_port_pids() {
  local port="$1"
  lsof -ti tcp:"$port" 2>/dev/null | awk 'NF' | sort -u || true
}

kill_pid_gracefully() {
  local pid="$1"
  local grace_seconds="${2:-3}"
  local i

  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi

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
    log "Stopping $label from pid file ($pid)."
    kill_pid_gracefully "$pid" 3
  fi
  rm -f "$pidfile"
}

kill_port_listeners() {
  local port="$1"
  local pids
  local attempts=0

  while true; do
    pids="$(list_port_pids "$port")"
    if [[ -z "$pids" ]]; then
      return 0
    fi

    log "Stopping processes on port $port: $(echo "$pids" | tr '\n' ' ')"
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      kill_pid_gracefully "$pid" 3
    done <<< "$pids"

    attempts=$((attempts + 1))
    if (( attempts >= 3 )); then
      break
    fi
  done

  pids="$(list_port_pids "$port")"
  if [[ -n "$pids" ]]; then
    log "Warning: port $port still has listeners: $(echo "$pids" | tr '\n' ' ')"
  fi
}

wait_for_port() {
  local port="$1"
  local timeout_seconds="${2:-15}"
  local i
  for ((i = 0; i < timeout_seconds; i++)); do
    if [[ -n "$(list_port_pids "$port")" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

log "Killing existing backend/frontend listeners..."
kill_pidfile_if_present "backend" "$LOG_DIR/backend.pid"
kill_pidfile_if_present "frontend" "$LOG_DIR/frontend.pid"
kill_port_listeners 8000
kill_port_listeners 5173
kill_port_listeners 3000

log "Setting up backend..."
(
  cd "$ROOT_DIR/backend"
  bash setup.sh
)

log "Preparing frontend dependencies with $FRONTEND_PM..."
(
  cd "$ROOT_DIR/frontend"
  if [[ ! -d node_modules ]]; then
    "${FRONTEND_INSTALL_CMD[@]}"
  fi
)

log "Building frontend..."
(
  cd "$ROOT_DIR/frontend"
  "${FRONTEND_BUILD_CMD[@]}"
)

log "Starting backend..."
(
  cd "$ROOT_DIR/backend"
  nohup bash run.sh > "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$LOG_DIR/backend.pid"
)

sleep 1
log "Starting frontend..."
(
  cd "$ROOT_DIR/frontend"
  nohup "${FRONTEND_DEV_CMD[@]}" > "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
)

if wait_for_port 8000 15; then
  log "Backend is listening on port 8000."
else
  log "Warning: backend did not bind port 8000 within timeout."
fi

if wait_for_port 5173 15; then
  log "Frontend is listening on port 5173."
else
  log "Warning: frontend did not bind port 5173 within timeout."
fi

log "Done."
log "Backend:  http://localhost:8000"
log "Frontend: http://localhost:5173"
log "Logs:"
echo "  - $LOG_DIR/backend.log"
echo "  - $LOG_DIR/frontend.log"
