# OpenCode SDK milestone runner

Type-safe OpenCode client with **event subscription** (`client.event.subscribe()`), wired for formal happy-path milestones under `.gsd/`.

Docs: [OpenCode SDK — Events](https://opencode.ai/docs/sdk/#events)

## What it does

1. Loads cloud-agent `.env` via **dotenv** (never bash-source — Fly tokens break shells).
2. Connects with `createOpencodeClient({ baseUrl })` to local or Daytona `opencode serve`.
3. Subscribes to the SSE event stream **before** prompting (when prompting).
4. Writes NDJSON events + markdown summaries under `.gsd/evidence/`.
5. Appends a short note to `.gsd/STATE.md` (disable with `--no-update-state`).

## Commands

From `experiments/01-platform/cloud-agent`:

```bash
# Plan only (no network)
npm run opencode:milestone:dry -- --milestone M1

# Listen to events on an existing serve
opencode serve --hostname 127.0.0.1 --port 4096   # separate terminal
npm run opencode:milestone:listen -- --base-url http://127.0.0.1:4096

# Prompt a milestone + capture events
npm run opencode:milestone -- --mode prompt --milestone M1

# Daytona SDK create → opencode serve → prompt + events
npm run opencode:milestone:daytona -- --milestone M1
```

Direct:

```bash
npx tsx scripts/opencode-sdk-milestone.ts --mode dry-run --milestone M1
npx tsx scripts/opencode-sdk-milestone.ts --mode daytona --milestone M2 --destroy-sandbox
```

## Env

| Variable | Role |
|----------|------|
| `OPENCODE_BASE_URL` / `OPENCODE_DAYTONA_BASE_URL` | Server URL |
| `OPENCODE_SERVE_PORT` | Default `4096` |
| `OPENCODE_MODEL` | e.g. `openai/gpt-oss-120b` (Baseten Model APIs id) |
| `BASETEN_API_KEY` | Sandbox / inference auth |
| `BASETEN_PROXY_BASE_URL` | OpenAI-compatible base (proxy or `https://inference.baseten.co/v1`) |
| `DAYTONA_API_KEY` | Required for `--mode daytona` |
| `MILESTONE_IDLE_MS` | Idle wait / event timeout (default 180000) |

Sibling tooling (same patterns): `../gpu-inference-stack/scripts/daytona-opencode-listen.ts`, `../gpu-inference-stack/scripts/sandbox/agents/agent-opencode-sdk.ts`.

## Evidence layout

```
.gsd/evidence/<UTC>-opencode-sdk-<label>.jsonl   # SSE events
.gsd/evidence/<UTC>-opencode-sdk-<label>.md      # human summary
```
