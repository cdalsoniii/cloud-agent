---
name: cloud-agent-handoff
version: 1.0.0
compatibility: opencode, claude
metadata:
  workflow: cloud-agent-orchestration
  tier: sync-first
  products: [generic, assistant-ui, gpu-inference-stack]
  sandbox_providers: [daytona, northflank]
  chain_specialties: [opencode-agent-wiring, prd-daytona-execute, dev-router]
---

# Cloud Agent Handoff Skill

Orchestrate cloud agent handoffs via OpenCode skills and communicate with running sandboxes via Baseten chain.

## When to use

- Handoff a local agent task to a cloud agent running in a sandbox
- Communicate with a running sandbox via Baseten chain for plan generation or execution
- Bridge between local OpenCode orchestration and remote cloud execution
- Coordinate multi-step workflows where planning happens on Baseten chain and execution happens in sandboxes

## Architecture

```
Local Agent → Cloud Agent Handoff Skill → Baseten Chain (planning) → Sandbox (execution)
                     ↓
              [Skill Router] → [Chain Portfolio] → [Sandbox Provider]
```

## Commands

```bash
# Handoff a task to cloud agent with full pipeline
npx tsx cloud-agent-handoff.ts --task "implement feature X" --target assistant-ui --full

# Plan only via Baseten chain
npx tsx cloud-agent-handoff.ts --task "implement feature X" --plan-only

# Execute in running sandbox with saved plan
npx tsx cloud-agent-handoff.ts --execute-only --sandbox-id <id> --plan-file tmp/plans/task-plan.md

# Communicate with running sandbox via Baseten chain
npx tsx baseten-chain-sandbox.ts --sandbox-id <id> --operation query --payload '{"status": true}'

# Full orchestration combining both
npx tsx orchestrator.ts --mode handoff-chain --task "implement feature X" --target assistant-ui
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `BASETEN_API_KEY` | Baseten API key for chain communication | Yes |
| `BASETEN_CHAIN_PORTFOLIO_ID` | Portfolio chain ID (default: nwxlx5wy) | No |
| `DAYTONA_API_KEY` | Daytona API key for sandbox management | Yes (for Daytona) |
| `NORTHFLANK_API_TOKEN` | Northflank API token | Yes (for Northflank) |
| `SMART_ROUTER_MODE` | Router mode: waterfall, sync, or chain | No (default: waterfall) |
| `SANDBOX_PROVIDER` | Preferred sandbox provider: daytona, northflank | No (default: daytona) |
| `OPENCODE_SERVE_PORT` | OpenCode server port (default: 4096) | No |

## OpenCode Interactive

Load this skill in OpenCode, then ask:

> Handoff this task to a cloud agent: implement the cloud-agent handoff feature in the assistant-ui repository using Daytona sandbox and Baseten chain.

> Communicate with my running sandbox via Baseten chain to check execution status and get the next steps.

## Integration with Existing Skills

- `chain-sandbox-bridge` — Use for plan → sandbox execution only
- `baseten-chain` — Use for chain-only operations
- `orchestrator` — Use for multi-provider batch routing
- `northflank-sandbox-lifecycle` — Use for sandbox CRUD operations

## Implementation

- `cloud-agent-handoff.ts` — Main handoff logic
- `baseten-chain-sandbox.ts` — Chain ↔ sandbox communication
- `orchestrator.ts` — Combined orchestration system

## Validation

- Run `npm test` to execute unit tests
- Run `npm run test:integration` for integration tests with live chain/sandbox
- Run `npm run lint` to check code quality

## Notes

- The skill defaults to `waterfall` mode: tries Baseten chain first, falls back to sync execution
- Chain timeout is configurable via `SMART_ROUTER_WATERFALL_CHAIN_TIMEOUT_MS`
- Sandbox max age is configurable via `FLEET_SANDBOX_MAX_AGE_HOURS`
- Always set `GPU_IDLE_AUTO_PAUSE=1` in development to minimize costs
