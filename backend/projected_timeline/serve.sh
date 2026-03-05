#!/usr/bin/env bash
# serve.sh — Build llama.cpp (CUDA), download Qwen3.5-35B-A3B Q4_K_XL, serve on :8001
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

MODEL_REPO="unsloth/Qwen3.5-35B-A3B-GGUF"
MODEL_FILE="Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf"
MODEL_ALIAS="unsloth/Qwen3.5-35B-A3B"
MODEL_PATH="${MODEL_REPO}/${MODEL_FILE}"
PORT=8001

# ---------------------------------------------------------------------------
# 1. Build llama.cpp (skip if already built)
# ---------------------------------------------------------------------------
if [ ! -f "llama.cpp/llama-server" ]; then
    echo "[serve.sh] Building llama.cpp with CUDA support …"
    sudo apt-get update -qq
    sudo apt-get install -y pciutils build-essential cmake curl libcurl4-openssl-dev

    if [ ! -d "llama.cpp" ]; then
        git clone https://github.com/ggml-org/llama.cpp
    fi

    # Determine the CUDA architecture to target.
    # CUDA < 12.8 cannot compile compute_120 / compute_120a (Blackwell).
    # Compiling for sm_89 (Ada Lovelace) produces a binary that runs on
    # Blackwell GPUs via CUDA's forward-compatibility guarantee — no native
    # Blackwell optimisations, but fully functional.  Upgrade to CUDA 12.8+
    # for optimal RTX 5090 / B-series performance.
    NVCC_VER=$(nvcc --version 2>/dev/null | grep -oP 'release \K[0-9]+\.[0-9]+' | head -1)
    GPU_SM=$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -1 | tr -d '.')
    CUDA_ARCH_FLAG=""
    if [ -n "$GPU_SM" ] && [ "$GPU_SM" -ge 120 ]; then
        # Blackwell GPU detected
        NVCC_MAJOR=$(echo "$NVCC_VER" | cut -d. -f1)
        NVCC_MINOR=$(echo "$NVCC_VER" | cut -d. -f2)
        if [ -z "$NVCC_MAJOR" ] || [ "$NVCC_MAJOR" -lt 12 ] || \
           { [ "$NVCC_MAJOR" -eq 12 ] && [ "$NVCC_MINOR" -lt 8 ]; }; then
            echo "[serve.sh] WARNING: CUDA ${NVCC_VER} cannot compile for Blackwell (sm_${GPU_SM})."
            echo "[serve.sh]   Targeting sm_89 (Ada Lovelace) — runs on RTX 5090 via forward compat."
            echo "[serve.sh]   Install CUDA 12.8+ for native Blackwell performance."
            CUDA_ARCH_FLAG="-DCMAKE_CUDA_ARCHITECTURES=89"
        fi
    fi

    cmake llama.cpp -B llama.cpp/build \
        -DBUILD_SHARED_LIBS=OFF \
        -DGGML_CUDA=ON \
        ${CUDA_ARCH_FLAG}

    cmake --build llama.cpp/build --config Release -j --clean-first \
        --target llama-cli llama-server llama-gguf-split

    cp llama.cpp/build/bin/llama-* llama.cpp/
    echo "[serve.sh] llama.cpp build complete."
else
    echo "[serve.sh] llama.cpp already built — skipping."
fi

# ---------------------------------------------------------------------------
# 2. Download model (skip if already present)
# ---------------------------------------------------------------------------
if [ ! -f "${MODEL_PATH}" ]; then
    echo "[serve.sh] Downloading ${MODEL_FILE} …"
    uv pip install -q huggingface_hub hf_transfer
    HF_HUB_ENABLE_HF_TRANSFER=1 uv run python -c "
from huggingface_hub import hf_hub_download
hf_hub_download(
    repo_id='${MODEL_REPO}',
    filename='${MODEL_FILE}',
    local_dir='${MODEL_REPO}',
)
"
    echo "[serve.sh] Download complete."
else
    echo "[serve.sh] Model already present — skipping download."
fi

# ---------------------------------------------------------------------------
# 3. Start llama-server (OpenAI-compatible API on :8001)
# ---------------------------------------------------------------------------
echo "[serve.sh] Starting llama-server on port ${PORT} …"
echo "[serve.sh] Model alias: ${MODEL_ALIAS}"
echo "[serve.sh] Press Ctrl-C to stop."
echo ""

export LLAMA_CACHE="${MODEL_REPO}"

./llama.cpp/llama-server \
    --model "${MODEL_PATH}" \
    --alias "${MODEL_ALIAS}" \
    --ctx-size 65536 \
    --temp 0.6 \
    --top-p 0.95 \
    --top-k 20 \
    --min-p 0.00 \
    --port "${PORT}"
