#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if command -v bun >/dev/null 2>&1; then
  FRONTEND_INSTALL_CMD=(bun install)
  FRONTEND_BUILD_CMD=(bun run build)
  FRONTEND_PM="bun"
elif command -v npm >/dev/null 2>&1; then
  FRONTEND_INSTALL_CMD=(npm install)
  FRONTEND_BUILD_CMD=(npm run build)
  FRONTEND_PM="npm"
else
  echo "Error: bun or npm is required."
  exit 1
fi

if [[ "${1:-}" == "--clean" ]]; then
  echo "[rebuild] Removing backend venv and frontend node_modules..."
  rm -rf "$ROOT_DIR/backend/venv" "$ROOT_DIR/frontend/node_modules"
fi

echo "[rebuild] Setting up backend..."
(
  cd "$ROOT_DIR/backend"
  bash setup.sh
)

echo "[rebuild] Installing frontend dependencies with $FRONTEND_PM..."
(
  cd "$ROOT_DIR/frontend"
  "${FRONTEND_INSTALL_CMD[@]}"
)

echo "[rebuild] Building frontend..."
(
  cd "$ROOT_DIR/frontend"
  "${FRONTEND_BUILD_CMD[@]}"
)

echo "[rebuild] Done."
echo "[rebuild] Run bash dev.sh to start backend + frontend."
