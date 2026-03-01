#!/usr/bin/env bash
# Run the backend server in the virtual environment

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ ! -d "venv" ]]; then
  echo "[backend/run] Virtual environment not found. Running setup..."
  bash setup.sh
fi

source venv/bin/activate

BACKEND_HOST="${BACKEND_HOST:-0.0.0.0}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
BACKEND_RELOAD="${BACKEND_RELOAD:-0}"

UVICORN_CMD=(uvicorn main:app --host "$BACKEND_HOST" --port "$BACKEND_PORT")
if [[ "$BACKEND_RELOAD" == "1" ]]; then
  UVICORN_CMD+=(--reload)
fi

echo "[backend/run] Starting backend on http://localhost:${BACKEND_PORT} (reload=${BACKEND_RELOAD})"
exec "${UVICORN_CMD[@]}"
