---
name: cloud-agent
description: >-
  Orchestrate cloud-agent handoffs into Daytona/Northflank sandboxes via Baseten
  chain, and persist sandbox logs to local SurrealDB. Use when the user asks to
  run cloud-agent, hand off a task to a sandbox, fetch sandbox logs, sync logs to
  SurrealDB, or start the Mastra/Daytona MCP workflow in partners/experiments
  cloud-agent.
---

# Cloud Agent

Project root: `partners/experiments/01-platform/cloud-agent`

## When to use

- Handoff a local task to a cloud sandbox (Daytona / Northflank)
- Plan via Baseten chain, then execute in a sandbox
- Fetch sandbox logs and confirm they land in local SurrealDB
- Run Mastra Daytona MCP / PR sandbox orchestration

## Quick start

```bash
cd partners/experiments/01-platform/cloud-agent
npm install
npm run health -- --verbose
npm run logs:verify          # probe SurrealDB sandbox_log write/read
```

Handoff:

```bash
npx tsx src/cloud-agent-handoff.ts --task "implement feature X" --target assistant-ui --full
# or dry-run
DRY_RUN=1 npx tsx src/cloud-agent-handoff.ts --task "smoke" --plan-only
```

Sandbox logs → SurrealDB:

```bash
# Live fetch (chain) + persist
npm run logs:sync -- --fetch --sandbox-id <id>

# Or via chain-sandbox CLI (also persists)
npm run chain-sandbox -- --sandbox-id <id> --operation logs

# List recent rows
npm run logs:sync -- --list --limit 10
```

## Required env vars (names only)

Set in `.env` (never commit secrets):

| Variable | Required | Purpose |
|----------|----------|---------|
| `BASETEN_API_KEY` | Yes | Chain portfolio calls |
| `DAYTONA_API_KEY` | For Daytona | Sandbox create/exec |
| `NORTHFLANK_API_TOKEN` | For Northflank | Alternate provider |
| `SANDBOX_PROVIDER` | No | `daytona` (default) or `northflank` |
| `BASETEN_CHAIN_PORTFOLIO_ID` | No | Deployed model / portfolio id |
| `SURREALDB_URL` | For log persist | e.g. `http://localhost:8000` |
| `SURREALDB_NS` | No | default `main` |
| `SURREALDB_DB` | No | default `main` |
| `SURREALDB_USER` / `SURREALDB_PASS` | No | default `root` / `root` |
| `GIT_TOKEN` / `GIT_REPO_URL` | Mastra/PR flows | Repo access in sandbox |
| `DRY_RUN` / `VERBOSE` | No | Safety / debug |

At least one of `DAYTONA_API_KEY` or `NORTHFLANK_API_TOKEN` is required for live sandbox work.

## Sandbox log → SurrealDB path

```
getSandboxLogs / logs:sync --fetch
        ↓
BasetenChainSandbox.getSandboxLogs()
        ↓
event-logger.logSandboxLogs()
        ↓
CREATE sandbox_log  →  SURREALDB_URL (NS/DB from env)
```

- Table: `sandbox_log` (SCHEMALESS; auto-`DEFINE` on first write)
- Schema file: `schema.surql`
- Writer: `src/event-logger.ts` (`logSandboxLogs`)
- Auto-hook: `src/baseten-chain-sandbox.ts` persists on every `getSandboxLogs`
- Verify CLI: `npm run logs:verify`

If `SURREALDB_URL` is unset, writes fall back to an in-memory store (not durable).

## Verify logs arrived

1. Ensure local SurrealDB is up (`curl -s http://localhost:8000/health` → 200).
2. `npm run logs:verify` — must print `OK: sandbox logs are writing to local SurrealDB.`
3. After a live sandbox: `npm run logs:sync -- --list --sandbox-id <id>`
4. Optional SurrealQL:

```bash
curl -s -X POST "$SURREALDB_URL/sql" \
  -H "Accept: application/json" \
  -H "surreal-ns: ${SURREALDB_NS:-main}" \
  -H "surreal-db: ${SURREALDB_DB:-main}" \
  -u "${SURREALDB_USER:-root}:${SURREALDB_PASS:-root}" \
  -H "Content-Type: text/plain" \
  -d "SELECT log_id, sandbox_id, source, created_at FROM sandbox_log ORDER BY created_at DESC LIMIT 5;"
```

## Agent workflow checklist

```
- [ ] cd cloud-agent; confirm .env has BASETEN_* + provider key + SURREALDB_URL
- [ ] npm run health -- --verbose
- [ ] npm run logs:verify
- [ ] Run handoff / chain-sandbox / orchestrate as needed
- [ ] npm run logs:sync -- --list (or --fetch --sandbox-id …)
- [ ] Do not print or commit secret values
```

## Related entrypoints

| Script | Command |
|--------|---------|
| Handoff | `npm run handoff` |
| Chain sandbox | `npm run chain-sandbox` |
| Orchestrator | `npm run orchestrate` |
| PR sandbox | `npm run pr-sandbox` |
| Mastra MCP | `npm run mastra:mcp` |
| Health | `npm run health` |

OpenCode-oriented root skill (legacy frontmatter): `SKILL.md` at repo root.
Cursor/agent discovery: this file under `.agents/skills/cloud-agent/`.

## Extra detail

See [reference.md](reference.md) for modes, troubleshooting, and file map.
