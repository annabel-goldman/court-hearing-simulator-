#!/bin/bash
# Run the backend server with uv + hypercorn (trio backend)

cd "$(dirname "$0")"

# Ensure deps are synced (fast no-op if already up to date)
uv sync --quiet

echo "Starting Court Simulator Backend on http://localhost:8000 (trio)"
# hypercorn with --worker-class trio gives structured concurrency and allows
# anyio.to_thread.run_sync to offload CPU-bound MCTS without blocking the loop.
# Remove --reload in production.
uv run hypercorn main:app --bind 0.0.0.0:8000 --worker-class trio --reload
