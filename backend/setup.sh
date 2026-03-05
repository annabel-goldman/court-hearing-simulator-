#!/bin/bash
# Backend setup script - installs dependencies with uv

set -e

cd "$(dirname "$0")"

echo "Setting up Court Simulator Backend..."

# Sync dependencies from pyproject.toml via uv
echo "Installing dependencies with uv..."
uv sync

echo ""
echo "Setup complete! To run the server:"
echo "  ./run.sh"
echo "or:"
echo "  uv run uvicorn main:app --reload --port 8000"
