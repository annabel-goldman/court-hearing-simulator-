#!/bin/bash
# Backend setup script - installs dependencies with uv

set -e

cd "$(dirname "$0")"
export UV_CACHE_DIR="${UV_CACHE_DIR:-../.run/uv-cache}"
mkdir -p "$UV_CACHE_DIR"

echo "Setting up Court Simulator Backend..."

# Sync dependencies from pyproject.toml via uv
echo "Installing dependencies with uv..."
uv sync

echo ""
echo "Setup complete! To run the server:"
echo "  ./run.sh"
echo "or:"
echo "  uv run python -m hypercorn main:app --bind 0.0.0.0:8000 --worker-class trio --reload"
