#!/usr/bin/env bash
# gsd-baseten-drive.sh — Drive GSD headless against cloud-agent .gsd/ with Baseten-oriented env.
#
# GSD (gsd-pi / local gsd-2 `gsd` on PATH) does not ship a first-class "baseten" provider.
# This wrapper:
#   1. Loads cloud-agent .env via node+dotenv (never bash-source)
#   2. Exports OpenAI-compatible vars pointing at Baseten Model APIs / proxy
#   3. Runs `gsd headless` in this repo so .gsd/STATE.md is the durable project state
#   4. Records evidence under .gsd/evidence/
#
# Usage:
#   bash scripts/gsd-baseten-drive.sh query
#   bash scripts/gsd-baseten-drive.sh status
#   bash scripts/gsd-baseten-drive.sh next
#   bash scripts/gsd-baseten-drive.sh auto
#
# Optional:
#   GSD_MODEL=openrouter/x-ai/grok-build-0.1   # GSD orchestrator model (provider/model)
#   BASETEN_INFERENCE_MODEL=openai/gpt-oss-120b
#   SKIP_VERIFY=1                              # skip local gates after headless

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
EVIDENCE_DIR="$ROOT/.gsd/evidence"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
CMD="${1:-query}"
shift || true

mkdir -p "$EVIDENCE_DIR"

# Export env from dotenv without bash-sourcing .env
eval "$(
  cd "$ROOT" && node --input-type=module <<'NODE'
import dotenv from 'dotenv';
import path from 'path';
const root = process.cwd();
dotenv.config({ path: path.join(root, '.env') });
dotenv.config({ path: path.join(root, '../gpu-inference-stack/.env') });

const basetenKey = process.env.BASETEN_API_KEY || '';
const proxy =
  process.env.BASETEN_PROXY_BASE_URL ||
  process.env.BASETEN_MODEL_APIS_BASE ||
  'https://inference.baseten.co/v1';
const inferenceModel =
  process.env.BASETEN_INFERENCE_MODEL ||
  process.env.OPENCODE_MODEL ||
  'openai/gpt-oss-120b';

const exports = {
  BASETEN_API_KEY: basetenKey,
  BASETEN_PROXY_BASE_URL: proxy,
  BASETEN_INFERENCE_MODEL: inferenceModel,
  // OpenAI-compatible surface for tools/agents that read these
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL || proxy,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY || basetenKey,
  OPENCODE_MODEL: process.env.OPENCODE_MODEL || inferenceModel,
  GSD_BASETEN_WIRED: '1',
};

for (const [k, v] of Object.entries(exports)) {
  if (!v) continue;
  const escaped = String(v).replace(/'/g, "'\\''");
  process.stdout.write(`export ${k}='${escaped}'\n`);
}
NODE
)"

LOG="$EVIDENCE_DIR/${STAMP}-gsd-baseten-${CMD}.txt"
{
  echo "# gsd-baseten-drive"
  echo "UTC: $STAMP"
  echo "cwd: $ROOT"
  echo "cmd: gsd headless $CMD $*"
  echo "OPENAI_BASE_URL=${OPENAI_BASE_URL:-}"
  echo "BASETEN_INFERENCE_MODEL=${BASETEN_INFERENCE_MODEL:-}"
  echo "BASETEN_API_KEY=$([[ -n "${BASETEN_API_KEY:-}" ]] && echo set || echo unset)"
  echo "GSD_MODEL=${GSD_MODEL:-"(default from ~/.gsd/agent/settings.json)"}"
  echo ""
} | tee "$LOG"

if ! command -v gsd >/dev/null 2>&1; then
  echo "ERROR: gsd not on PATH. Install local gsd-2 (npm i -g from tools/cli/gsd-2) or @opengsd/gsd-pi." | tee -a "$LOG"
  exit 1
fi

cd "$ROOT"

MODEL_ARGS=()
if [[ -n "${GSD_MODEL:-}" ]]; then
  MODEL_ARGS=(--model "$GSD_MODEL")
fi

set +e
gsd headless "${MODEL_ARGS[@]}" --timeout "${GSD_TIMEOUT_MS:-120000}" "$CMD" "$@" 2>&1 | tee -a "$LOG"
GSD_EC=${PIPESTATUS[0]}
set -e

echo "" | tee -a "$LOG"
echo "gsd_exit=$GSD_EC" | tee -a "$LOG"

# Always snapshot STATE after drive
{
  echo ""
  echo "## .gsd/STATE.md (head)"
  head -n 40 "$ROOT/.gsd/STATE.md"
} | tee -a "$LOG"

if [[ "${SKIP_VERIFY:-0}" != "1" && "$CMD" != "query" && "$CMD" != "status" ]]; then
  echo "" | tee -a "$LOG"
  echo "## verify gates (best effort)" | tee -a "$LOG"
  npm run test:prd 2>&1 | tee -a "$LOG" || true
fi

# Note: GSD deriveState may claim milestones "complete" while human STATE.md
# still tracks product blockers — prefer STATE.md for honest progress.
echo "evidence=$LOG"
exit "$GSD_EC"
