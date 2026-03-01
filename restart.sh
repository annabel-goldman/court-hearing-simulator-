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

kill_port() {
  local port="$1"
  local pids
  pids="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -z "$pids" ]]; then
    return
  fi

  echo "[restart] Stopping processes on port $port: $pids"
  while IFS= read -r pid; do
    [[ -z "$pid" ]] && continue
    kill "$pid" 2>/dev/null || true
  done <<< "$pids"

  sleep 1
  local remaining
  remaining="$(lsof -ti tcp:"$port" 2>/dev/null || true)"
  if [[ -n "$remaining" ]]; then
    while IFS= read -r pid; do
      [[ -z "$pid" ]] && continue
      kill -9 "$pid" 2>/dev/null || true
    done <<< "$remaining"
  fi
}

echo "[restart] Killing existing backend/frontend listeners..."
kill_port 8000
kill_port 5173
kill_port 3000

echo "[restart] Setting up backend..."
(
  cd "$ROOT_DIR/backend"
  bash setup.sh
)

echo "[restart] Preparing frontend dependencies with $FRONTEND_PM..."
(
  cd "$ROOT_DIR/frontend"
  if [[ ! -d node_modules ]]; then
    "${FRONTEND_INSTALL_CMD[@]}"
  fi
)

echo "[restart] Building frontend..."
(
  cd "$ROOT_DIR/frontend"
  "${FRONTEND_BUILD_CMD[@]}"
)

echo "[restart] Starting backend..."
(
  cd "$ROOT_DIR/backend"
  nohup bash run.sh > "$LOG_DIR/backend.log" 2>&1 &
  echo $! > "$LOG_DIR/backend.pid"
)

sleep 1
echo "[restart] Starting frontend..."
(
  cd "$ROOT_DIR/frontend"
  nohup "${FRONTEND_DEV_CMD[@]}" > "$LOG_DIR/frontend.log" 2>&1 &
  echo $! > "$LOG_DIR/frontend.pid"
)

sleep 1
echo "[restart] Done."
echo "[restart] Backend:  http://localhost:8000"
echo "[restart] Frontend: http://localhost:5173"
echo "[restart] Logs:"
echo "  - $LOG_DIR/backend.log"
echo "  - $LOG_DIR/frontend.log"
