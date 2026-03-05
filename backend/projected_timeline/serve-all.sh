#!/usr/bin/env bash
# serve-all.sh — Launch all 3 model tiers in parallel
#   LARGE  Qwen3.5-35B-A3B   :8001
#   SMALL  Qwen3-4B           :8002
#   TINY   gemma-3-1b-it      :8003
#
# Usage:  ./serve-all.sh          (all 3)
#         ./serve-all.sh large    (just large)
#         ./serve-all.sh small tiny
#
# Ctrl-C stops all servers.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PIDS=()

cleanup() {
    echo ""
    echo "[serve-all] Stopping all servers …"
    for pid in "${PIDS[@]}"; do
        kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null
    echo "[serve-all] Done."
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Determine which tiers to launch
# ---------------------------------------------------------------------------
if [ $# -eq 0 ]; then
    TIERS=(large small tiny)
else
    TIERS=("$@")
fi

# ---------------------------------------------------------------------------
# Verify llama.cpp is built
# ---------------------------------------------------------------------------
if [ ! -f "llama.cpp/llama-server" ]; then
    echo "[serve-all] llama.cpp not built — building via serve.sh first …"
    bash serve.sh &
    wait $!
fi

# ---------------------------------------------------------------------------
# Model definitions
# ---------------------------------------------------------------------------
declare -A REPO FILE ALIAS PORT CTX

REPO[large]="unsloth/Qwen3.5-35B-A3B-GGUF"
FILE[large]="Qwen3.5-35B-A3B-UD-Q4_K_XL.gguf"
ALIAS[large]="unsloth/Qwen3.5-35B-A3B"
PORT[large]=8001
CTX[large]=65536

REPO[small]="unsloth/Qwen3-4B-GGUF"
FILE[small]="Qwen3-4B-Q4_K_M.gguf"
ALIAS[small]="unsloth/Qwen3-4B"
PORT[small]=8002
CTX[small]=8192

REPO[tiny]="bartowski/google_gemma-3-1b-it-GGUF"
FILE[tiny]="google_gemma-3-1b-it-Q8_0.gguf"
ALIAS[tiny]="gemma-3-1b-it"
PORT[tiny]=8003
CTX[tiny]=8192

# ---------------------------------------------------------------------------
# Download helper
# ---------------------------------------------------------------------------
download_model() {
    local tier=$1
    local repo="${REPO[$tier]}"
    local file="${FILE[$tier]}"
    local path="${repo}/${file}"

    if [ -f "$path" ]; then
        echo "[serve-all] ${tier^^} model already present."
        return
    fi
    echo "[serve-all] Downloading ${tier^^} model: ${file} …"
    uv pip install -q huggingface_hub hf_transfer 2>/dev/null || true
    HF_HUB_ENABLE_HF_TRANSFER=1 uv run python -c "
from huggingface_hub import hf_hub_download
hf_hub_download(repo_id='${repo}', filename='${file}', local_dir='${repo}')
"
    echo "[serve-all] ${tier^^} download complete."
}

# ---------------------------------------------------------------------------
# Launch helper
# ---------------------------------------------------------------------------
launch_server() {
    local tier=$1
    local repo="${REPO[$tier]}"
    local file="${FILE[$tier]}"
    local alias="${ALIAS[$tier]}"
    local port="${PORT[$tier]}"
    local ctx="${CTX[$tier]}"
    local model_path="${repo}/${file}"

    download_model "$tier"

    echo "[serve-all] Starting ${tier^^} on :${port}  (${alias}, ctx=${ctx})"
    LLAMA_CACHE="${repo}" ./llama.cpp/llama-server \
        --model "${model_path}" \
        --alias "${alias}" \
        --ctx-size "${ctx}" \
        --temp 0.6 \
        --top-p 0.95 \
        --top-k 20 \
        --min-p 0.00 \
        --port "${port}" \
        2>&1 | sed "s/^/[${tier^^}] /" &
    PIDS+=($!)
}

# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
echo "[serve-all] Launching tiers: ${TIERS[*]}"
echo ""

for tier in "${TIERS[@]}"; do
    tier=$(echo "$tier" | tr '[:upper:]' '[:lower:]')
    if [[ -z "${REPO[$tier]+x}" ]]; then
        echo "[serve-all] Unknown tier: $tier (valid: large, small, tiny)"
        exit 1
    fi
    launch_server "$tier"
done

echo ""
echo "[serve-all] All servers launching. Ctrl-C to stop all."
echo "  LARGE → http://localhost:${PORT[large]:-8001}/v1"
echo "  SMALL → http://localhost:${PORT[small]:-8002}/v1"
echo "  TINY  → http://localhost:${PORT[tiny]:-8003}/v1"
echo ""

wait
