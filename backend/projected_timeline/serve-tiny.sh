#!/usr/bin/env bash
# serve-tiny.sh — Download gemma-3-1b-it Q8_0 & serve on :8003  (TINY tier)
# Requires llama.cpp already built by serve.sh — run that first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODEL_REPO="bartowski/google_gemma-3-1b-it-GGUF"
MODEL_FILE="google_gemma-3-1b-it-Q8_0.gguf"
MODEL_ALIAS="gemma-3-1b-it"
MODEL_PATH="${MODEL_REPO}/${MODEL_FILE}"
PORT=8003

# ---------------------------------------------------------------------------
# 1. Verify llama.cpp is built
# ---------------------------------------------------------------------------
if [ ! -f "llama.cpp/llama-server" ]; then
    echo "[serve-tiny] llama.cpp not built — run serve.sh first."
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Download model (skip if present)
# ---------------------------------------------------------------------------
if [ ! -f "${MODEL_PATH}" ]; then
    echo "[serve-tiny] Downloading ${MODEL_FILE} …"
    uv pip install -q huggingface_hub hf_transfer
    HF_HUB_ENABLE_HF_TRANSFER=1 uv run python -c "
from huggingface_hub import hf_hub_download
hf_hub_download(
    repo_id='${MODEL_REPO}',
    filename='${MODEL_FILE}',
    local_dir='${MODEL_REPO}',
)
"
    echo "[serve-tiny] Download complete."
else
    echo "[serve-tiny] Model already present — skipping download."
fi

# ---------------------------------------------------------------------------
# 3. Start llama-server on :8003
# ---------------------------------------------------------------------------
echo "[serve-tiny] Starting llama-server on port ${PORT} …"
echo "[serve-tiny] Model: ${MODEL_ALIAS}  (TINY tier — timeline/agenda generation)"
echo "[serve-tiny] Press Ctrl-C to stop."
echo ""

export LLAMA_CACHE="${MODEL_REPO}"

./llama.cpp/llama-server \
    --model "${MODEL_PATH}" \
    --alias "${MODEL_ALIAS}" \
    --ctx-size 8192 \
    --temp 0.6 \
    --top-p 0.95 \
    --top-k 20 \
    --min-p 0.00 \
    --port "${PORT}"
