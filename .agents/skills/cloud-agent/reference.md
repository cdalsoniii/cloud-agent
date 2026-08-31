# Cloud Agent — Reference

## Modes

| Mode | Behavior |
|------|----------|
| `waterfall` | Chain soft-try → sync fallback → sandbox |
| `full` | Chain plan + sandbox; no fallback |
| `handoff` | Direct sandbox; local plan |
| `chain-sandbox` | Comms only with a running sandbox |

## Key files

| Path | Role |
|------|------|
| `src/cloud-agent-handoff.ts` | Task handoff into sandbox |
| `src/baseten-chain-sandbox.ts` | Chain ↔ sandbox ops; log persist hook |
| `src/orchestrator.ts` | Combined modes |
| `src/event-logger.ts` | SurrealDB writes (`sandbox_log`, SDLC events) |
| `src/sync-sandbox-logs.ts` | Verify / fetch / list log pipeline |
| `src/health-check.ts` | Includes SurrealDB connectivity |
| `schema.surql` | Table definitions including `sandbox_log` |
| `src/mastra/` | Daytona Mastra agent + MCP server |

## Troubleshooting

### SurrealDB probe fails

1. `curl -s http://localhost:8000/health` — must be 200
2. Confirm `.env`: `SURREALDB_URL`, `SURREALDB_NS`, `SURREALDB_DB`
3. Re-run `npm run logs:verify`
4. If NS/DB mismatch with older data, either set env to the old NS/DB or re-import `schema.surql`

### Logs CLI works but SELECT is empty

- Writers use headers `surreal-ns` / `surreal-db` from env (default `main` / `main`)
- Older event-logger used hard-coded `cloud-agent` / `rules` — check both namespaces if migrating

### Chain logs 404

- `BASETEN_CHAIN_PORTFOLIO_ID` must be a deployed model id in your Baseten account
- Endpoint shape: `https://model-{ID}.api.baseten.co/environments/production/sync`

### Health missing BASETEN_API_KEY

- Ensure `loadEnv(process.cwd())` runs before reading env (health-check already does)
- Run from the cloud-agent directory so `.env` is found

## Integration with other skills

- `chain-sandbox-bridge` — plan → sandbox only
- `baseten-chain` — chain-only
- `orchestrator` — multi-provider batch
- `northflank-sandbox-lifecycle` — sandbox CRUD
