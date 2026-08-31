#!/usr/bin/env bash
# Launch Grok CLI with OPENROUTER_API_KEY from cloud-agent/.env (Grok does not read .env itself).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v grok >/dev/null 2>&1; then
  echo "grok CLI not found on PATH" >&2
  exit 1
fi

eval "$(npx tsx -e "
import { loadEnv } from './src/types.ts';
loadEnv(process.cwd());
const key = process.env.OPENROUTER_API_KEY?.trim() || '';
if (!key) {
  console.error('OPENROUTER_API_KEY is missing in .env');
  process.exit(1);
}
process.stdout.write('export OPENROUTER_API_KEY=' + JSON.stringify(key) + '\n');
")"

exec grok "$@"
