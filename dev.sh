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

# ---------------------------------------------------------------------------
# Color filter for backend output
# Highlights judge/orchestrator decision events; dims httpx noise.
#
# Key patterns to watch:
#   [★ ASKED ★]   — a question was fired (bright green)
#   [SUMMARY]     — one-line pass result for all agents (bold white)
#   [EVAL]        — pass started, shows transcript snippet (cyan)
#   [CANDIDATE]   — agent wants to ask and passed threshold (yellow)
#   [PASS]        — agent evaluated but won't ask this pass (dim)
#   blocked by    — gate blocked evaluation (dim yellow)
#   429           — rate limit hit (red)
# ---------------------------------------------------------------------------
_colorize_backend() {
  awk '
    /\[★ ASKED ★\]/   { printf "\033[1;32m%s\033[0m\n", $0; next }
    /\[SUMMARY\]/     { printf "\033[1;37m%s\033[0m\n", $0; next }
    /\[EVAL\]/        { printf "\033[36m%s\033[0m\n",   $0; next }
    /\[CANDIDATE\]/   { printf "\033[33m%s\033[0m\n",   $0; next }
    /\[PASS\]/        { printf "\033[2m%s\033[0m\n",    $0; next }
    /blocked by/      { printf "\033[2;33m%s\033[0m\n", $0; next }
    /skipping eval/   { printf "\033[2;33m%s\033[0m\n", $0; next }
    /429 Too Many/    { printf "\033[1;31m%s\033[0m\n", $0; next }
    /Retrying/        { printf "\033[31m%s\033[0m\n",   $0; next }
    /HTTP Request/    { printf "\033[2m%s\033[0m\n",    $0; next }
    /connection open|connection closed/ { printf "\033[2m%s\033[0m\n", $0; next }
    { print }
  '
}

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
) 2>&1 | _colorize_backend &
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
echo "[dev] Judge debug legend: [EVAL]=pass start [CANDIDATE]=wants to ask [SUMMARY]=pass result [★ ASKED ★]=question fired"

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
