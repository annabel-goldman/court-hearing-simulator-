#!/bin/bash
# Launch both backend and frontend

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Start backend in background (sync deps first)
echo "Starting backend..."
(cd "$ROOT/backend" && uv sync --quiet && uv run uvicorn main:app --reload --port 8000) &
BACKEND_PID=$!

# Start frontend in background
echo "Starting frontend..."
cd "$ROOT/frontend" && bun run dev &
FRONTEND_PID=$!

echo ""
echo "Backend:  http://localhost:8000"
echo "Frontend: http://localhost:5173"
echo ""
echo "Press Ctrl+C to stop both servers."

# Wait and clean up on exit
trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
