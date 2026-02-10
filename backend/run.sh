#!/bin/bash
# Run the backend server in the virtual environment

cd "$(dirname "$0")"

# Create venv if it doesn't exist
if [ ! -d "venv" ]; then
    echo "Virtual environment not found. Running setup first..."
    ./setup.sh
fi

# Activate venv and run server
source venv/bin/activate
echo "Starting Court Simulator Backend on http://localhost:8000"
uvicorn main:app --reload --port 8000
