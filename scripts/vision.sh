#!/usr/bin/env bash
# Local open-weights vision reader (OpenAI-compatible on :8090), restarted automatically if the OS kills it.
# First run downloads Qwen2.5-VL-3B (~3 GB) into the Hugging Face cache.
MODEL="${LOCAL_VISION_HF:-ggml-org/Qwen2.5-VL-3B-Instruct-GGUF:Q4_K_M}"
while true; do
  llama-server -hf "$MODEL" --port "${LOCAL_VISION_PORT:-8090}" -c 4096 -np 1 -ngl 99 --no-webui
  echo "vision server exited ($?); restarting in 3s" >&2
  sleep 3
done
