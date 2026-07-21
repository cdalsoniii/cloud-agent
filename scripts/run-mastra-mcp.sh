#!/usr/bin/env bash
# Launch cloud-agent Mastra MCP (stdio) for Cursor.
# Env is loaded by mcp-server.ts via dotenv (do not bash-source .env — it may contain
# unquoted values that break shell parsing).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STACK_DIR="${GPU_INFERENCE_STACK_DIR:-$(cd "$ROOT/../gpu-inference-stack" && pwd)}"
cd "$ROOT"

export GPU_INFERENCE_STACK_DIR="$STACK_DIR"
export SANDBOX_PROVIDER="${SANDBOX_PROVIDER:-daytona}"
export MCP_TRANSPORT="${MCP_TRANSPORT:-stdio}"
export CLOUD_AGENT_ROOT="$ROOT"

exec npx --yes tsx "$ROOT/src/mastra/mcp-server.ts"
