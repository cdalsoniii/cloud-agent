---
name: cloud-agent-handoff
description: >-
  OpenCode-oriented cloud-agent handoff skill. For Cursor/agent discovery prefer
  .agents/skills/cloud-agent/SKILL.md (includes SurrealDB sandbox log wiring).
version: 1.1.0
compatibility: opencode, claude, cursor
metadata:
  workflow: cloud-agent-orchestration
  tier: sync-first
  products: [generic, assistant-ui, gpu-inference-stack]
  sandbox_providers: [daytona, northflank]
  chain_specialties: [opencode-agent-wiring, prd-daytona-execute, dev-router]
---

# Cloud Agent Handoff Skill

Orchestrate cloud agent handoffs via OpenCode skills and communicate with running sandboxes via Baseten chain. Sandbox logs are persisted to local SurrealDB (`sandbox_log`).

> **Cursor agents:** load [`.agents/skills/cloud-agent/SKILL.md`](.agents/skills/cloud-agent/SKILL.md) for the full workflow (env names, SurrealDB verify steps, CLI map).

## When to use

- Handoff a local agent task to a cloud agent running in a sandbox
- Communicate with a running sandbox via Baseten chain for plan generation or execution
- Bridge between local OpenCode orchestration and remote cloud execution
- Confirm sandbox logs are written to local SurrealDB

## Commands

```bash
# From partners/experiments/01-platform/cloud-agent
npx tsx src/cloud-agent-handoff.ts --task "implement feature X" --target assistant-ui --full
npx tsx src/baseten-chain-sandbox.ts --sandbox-id <id> --operation logs
npm run logs:verify
npm run logs:sync -- --list
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BASETEN_API_KEY` | Baseten API key for chain communication | Yes |
| `BASETEN_CHAIN_PORTFOLIO_ID` | Portfolio chain ID | No |
| `DAYTONA_API_KEY` | Daytona API key for sandbox management | Yes (for Daytona) |
| `NORTHFLANK_API_TOKEN` | Northflank API token | Yes (for Northflank) |
| `SANDBOX_PROVIDER` | `daytona` or `northflank` | No |
| `SURREALDB_URL` | Local SurrealDB HTTP endpoint | For durable logs |
| `SURREALDB_NS` / `SURREALDB_DB` | Namespace / database (default `main`) | No |
| `SURREALDB_USER` / `SURREALDB_PASS` | Auth (default `root`) | No |
| `SMART_ROUTER_MODE` | `waterfall`, `sync`, or `chain` | No |
| `DRY_RUN` / `VERBOSE` | Safety / debug | No |

## Sandbox logs → SurrealDB

`BasetenChainSandbox.getSandboxLogs()` calls `logSandboxLogs()` in `src/event-logger.ts`, which `CREATE`s rows in `sandbox_log` on `SURREALDB_URL`. Verify with `npm run logs:verify`.

## Implementation

- `src/cloud-agent-handoff.ts` — Main handoff logic
- `src/baseten-chain-sandbox.ts` — Chain ↔ sandbox communication + log persist
- `src/orchestrator.ts` — Combined orchestration
- `src/event-logger.ts` — SurrealDB event + sandbox log writer
- `src/sync-sandbox-logs.ts` — Verify / fetch / list helper

## Notes

- Defaults to `waterfall` mode: Baseten chain first, sync fallback
- Without `SURREALDB_URL`, log writes use an in-memory fallback (not durable)
- Never commit `.env` secrets
