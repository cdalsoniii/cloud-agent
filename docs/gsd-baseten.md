# GSD CLI + Baseten

## Reality check

Installed CLI: **`gsd`** from local gsd-2 / gsd-pi (`gsd --version` → 2.58.x).  
There is **no native `baseten` provider** in `gsd --list-models`. Orchestrator models come from providers like `openrouter` / `groq` (see `~/.gsd/agent/settings.json`).

Baseten is wired for:

1. **OpenCode agents in Daytona** — `OPENCODE_MODEL=baseten/openai/gpt-oss-120b` (+ `BASETEN_API_KEY`)
2. **Env export helper** — `scripts/gsd-baseten-drive.sh` loads cloud-agent `.env` via dotenv and exports OpenAI-compatible vars for tools that speak that protocol

## Commands

```bash
cd experiments/01-platform/cloud-agent

# Snapshot GSD-derived state (does not replace human STATE.md)
npm run gsd:baseten:query

# One unit / auto (uses GSD_MODEL if set; still reads this repo's .gsd/)
bash scripts/gsd-baseten-drive.sh next
bash scripts/gsd-baseten-drive.sh auto

# Override GSD orchestrator model (available provider)
GSD_MODEL=openrouter/x-ai/grok-build-0.1 bash scripts/gsd-baseten-drive.sh query
```

## Env keys (from cloud-agent / gpu-inference-stack `.env`)

| Key | Use |
|-----|-----|
| `BASETEN_API_KEY` | Auth for Model APIs / chains |
| `BASETEN_PROXY_BASE_URL` | Optional local proxy (may be ngrok — can be down) |
| Prefer | `https://inference.baseten.co/v1` for Model APIs |
| `OPENCODE_MODEL` | e.g. `baseten/openai/gpt-oss-120b` or `baseten/moonshotai/Kimi-K2.6` |

**Never bash-source `.env`** — Fly tokens break shells. The drive script uses Node dotenv.

## Honest note on `gsd headless query`

GSD's deriveState may report milestones “complete” from its own registry parse while human `.gsd/STATE.md` still lists product blockers. **Prefer `STATE.md` for progress truth.**
