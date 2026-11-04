#!/usr/bin/env bash
# Start the SAM 3 segmenter (its own env) and the SAM 3D API server (port 7860).
set -euo pipefail

MODELS_DIR="${MODELS_DIR:-/models}"
SAM3D_ROOT="${SAM3D_ROOT:-/opt/sam-3d-objects}"
export HF_HOME="$MODELS_DIR/hf"

if [ "${MOCK:-0}" != "1" ]; then
  : "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token whose account was granted access to facebook/sam-3d-objects and facebook/sam3}"
  export HF_TOKEN

  # SAM 3D Objects checkpoints, downloaded once into the models volume (doc/setup.md).
  ckpt="$MODELS_DIR/sam-3d-objects"
  if [ ! -f "$ckpt/hf/pipeline.yaml" ]; then
    echo "[start] downloading facebook/sam-3d-objects (first run only)…"
    rm -rf "$ckpt/download"
    micromamba run -n sam3d hf download --repo-type model --local-dir "$ckpt/download" --max-workers 1 facebook/sam-3d-objects
    mkdir -p "$ckpt"
    mv "$ckpt/download/checkpoints" "$ckpt/hf"
    rm -rf "$ckpt/download"
  fi
  mkdir -p "$SAM3D_ROOT/checkpoints"
  ln -sfn "$ckpt/hf" "$SAM3D_ROOT/checkpoints/hf"

  # SAM 3 downloads facebook/sam3 into HF_HOME on first start.
  micromamba run -n sam3 python /app/segmenter.py &
  seg=$!
  for _ in $(seq 1 900); do
    curl -sf http://127.0.0.1:8001/health >/dev/null && break
    kill -0 "$seg" 2>/dev/null || { echo "[start] SAM 3 failed to start"; exit 1; }
    sleep 1
  done
fi

export CONDA_PREFIX="$MAMBA_ROOT_PREFIX/envs/sam3d"
micromamba run -n sam3d python /app/app.py &
api=$!
# Stop everything if either process exits.
wait -n
kill "${seg:-}" "$api" 2>/dev/null || true
exit 1
