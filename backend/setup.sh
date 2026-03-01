#!/usr/bin/env bash
# Backend setup script - creates venv and installs dependencies

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "[backend/setup] Preparing backend environment..."

if [[ ! -d "venv" ]]; then
  echo "[backend/setup] Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate
echo "[backend/setup] Installing Python dependencies..."
pip install -r requirements.txt

echo "[backend/setup] Done."
