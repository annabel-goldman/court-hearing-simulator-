#!/usr/bin/env bash
# serve-small.sh — Download Qwen3-4B Q4_K_M & serve on :8002  (SMALL tier)
# Requires llama.cpp already built by serve.sh — run that first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODEL_REPO="unsloth/Qwen3-4B-GGUF"
MODEL_FILE="Qwen3-4B-Q4_K_M.gguf"
MODEL_ALIAS="unsloth/Qwen3-4B"
MODEL_PATH="${MODEL_REPO}/${MODEL_FILE}"
PORT=8002

# ---------------------------------------------------------------------------
# 1. Verify llama.cpp is built
# ---------------------------------------------------------------------------
if [ ! -f "llama.cpp/llama-server" ]; then
    echo "[serve-small] llama.cpp not built — run serve.sh first."
    exit 1
fi

# ---------------------------------------------------------------------------
# 2. Download model (skip if present)
# ---------------------------------------------------------------------------
if [ ! -f "${MODEL_PATH}" ]; then
    echo "[serve-small] Downloading ${MODEL_FILE} …"
    uv pip install -q huggingface_hub hf_transfer
    HF_HUB_ENABLE_HF_TRANSFER=1 uv run python -c "
from huggingface_hub import hf_hub_download
hf_hub_download(
    repo_id='${MODEL_REPO}',
    filename='${MODEL_FILE}',
    local_dir='${MODEL_REPO}',
)
"
    echo "[serve-small] Download complete."
else
    echo "[serve-small] Model already present — skipping download."
fi

# ---------------------------------------------------------------------------
# 3. Start llama-server on :8002
# ---------------------------------------------------------------------------
echo "[serve-small] Starting llama-server on port ${PORT} …"
echo "[serve-small] Model: ${MODEL_ALIAS}  (SMALL tier — agent analysis, quality)"
echo "[serve-small] Press Ctrl-C to stop."
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
