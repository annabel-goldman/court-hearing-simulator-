#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_DIR="$ROOT_DIR/.run"
mkdir -p "$LOG_DIR"

log() {
  echo "[start] $*"
}

list_port_pids() {
  local port="$1"
  lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null | awk 'NF' | sort -u || true
}

wait_for_port() {
  local port="$1"
  local timeout_seconds="${2:-20}"
  local i
  for ((i = 0; i < timeout_seconds; i++)); do
    if [[ -n "$(list_port_pids "$port")" ]]; then
      return 0
    fi
    sleep 1
  done
  return 1
}

if ! command -v bun >/dev/null 2>&1; then
  echo "Error: bun is required. Install from https://bun.sh"
  exit 1
fi

if ! command -v uv >/dev/null 2>&1; then
  echo "Error: uv is required. Install from https://docs.astral.sh/uv/"
  exit 1
fi

log "Stopping any existing Court Simulator services..."
bash "$ROOT_DIR/stop.sh" >/dev/null 2>&1 || true

log "Syncing backend dependencies (uv)..."
(
  cd "$ROOT_DIR/backend"
  uv sync --quiet
)

log "Installing frontend dependencies (bun)..."
(
  cd "$ROOT_DIR/frontend"
  bun install --frozen-lockfile
)

log "Rebuilding frontend..."
(
  cd "$ROOT_DIR/frontend"
  bun run build
)

log "Starting frontend dev server (background)..."
(
  cd "$ROOT_DIR/frontend"
  nohup bun run dev -- --host 0.0.0.0 --port 5173 > "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
)

if wait_for_port 5173 20; then
  log "Frontend listening on http://localhost:5173"
else
  log "Warning: frontend did not bind port 5173 within timeout."
fi

log "Frontend log: $LOG_DIR/frontend.log"
log "Starting backend (foreground)..."

cd "$ROOT_DIR/backend"
exec uv run hypercorn main:app --bind 0.0.0.0:8000 --worker-class trio --reload
