#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v bun >/dev/null 2>&1; then
  FRONTEND_INSTALL_CMD=(bun install)
  FRONTEND_RUN_CMD=(bun run dev --host 0.0.0.0 --port 5173)
  FRONTEND_PM="bun"
elif command -v npm >/dev/null 2>&1; then
  FRONTEND_INSTALL_CMD=(npm install)
  FRONTEND_RUN_CMD=(npm run dev -- --host 0.0.0.0 --port 5173)
  FRONTEND_PM="npm"
else
  echo "Error: either bun or npm is required to run the frontend."
  echo "Install bun (https://bun.sh) or Node.js/npm (https://nodejs.org)."
  exit 1
fi

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi

  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi

  wait 2>/dev/null || true
  exit "$exit_code"
}

trap cleanup EXIT INT TERM

if [[ ! -d "$ROOT_DIR/frontend/node_modules" ]]; then
  echo "[dev] Installing frontend dependencies with $FRONTEND_PM..."
  (
    cd "$ROOT_DIR/frontend"
    "${FRONTEND_INSTALL_CMD[@]}"
  )
fi

echo "[dev] Starting backend on http://localhost:8000"
(
  cd "$ROOT_DIR/backend"
  bash run.sh
) &
BACKEND_PID=$!

echo "[dev] Starting frontend on http://localhost:5173"
(
  cd "$ROOT_DIR/frontend"
  "${FRONTEND_RUN_CMD[@]}"
) &
FRONTEND_PID=$!

echo "[dev] Backend PID: $BACKEND_PID"
echo "[dev] Frontend PID: $FRONTEND_PID"
echo "[dev] Press Ctrl+C to stop both services."

while true; do
  if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "[dev] Backend exited. Stopping frontend."
    break
  fi

  if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "[dev] Frontend exited. Stopping backend."
    break
  fi

  sleep 1
done
