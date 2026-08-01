# Cloud Agent Handoff

A complete system for orchestrating cloud agent handoffs via OpenCode skills and communicating with running sandboxes via Baseten chain.

## Features

- **Cloud Agent Handoff**: Handoff local agent tasks to cloud agents running in sandboxes
- **Baseten Chain Integration**: Plan generation and execution via Baseten chain portfolio
- **Sandbox Communication**: Query, monitor, and control running sandboxes through chain endpoints
- **Waterfall Orchestration**: Soft-try chain execution with sync fallback
- **Multi-Provider Support**: Daytona and Northflank sandbox providers
- **Health Monitoring**: Continuous sandbox monitoring and status checking
- **Comprehensive Documentation**: Generated architecture, API reference, and usage guides
- **SDLC Batch Loop**: Multi-provider sandbox batching with formal validation (see [`pybatch/README.md`](pybatch/README.md))

## Agent state (ontology + GSD)

| Path | Description |
|------|-------------|
| [`.px/`](.px/README.md) | Ontology / formal pointers (load before inventing classes) |
| [`.gsd/`](.gsd/README.md) | OpenGSD loop state for formal happy-path M0–M3 |

```bash
# Formal happy path (cloud-agent + assistant-ui path probes)
npm run test:prd
npm run smoke:formal
npm run verify:all
```

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, data flow, integration points, security |
| [API.md](docs/API.md) | Complete API reference for all interfaces and CLI commands |
| [GUIDE.md](docs/GUIDE.md) | Usage examples, patterns, troubleshooting, best practices |
| [formal-prd-planner.md](docs/formal-prd-planner.md) | Formal System PRD planning pipeline |

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   Local Agent (You)                        │
└────────────────────┬────────────────────────────────────┘
                     │
           ┌─────────▼──────────┐
           │  Cloud Agent       │
           │  Handoff Skill     │
           └─────────┬──────────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────▼───┐  ┌────▼────┐  ┌────▼────┐
   │ Waterfall│  │ Handoff │  │ Chain   │
   │ Mode     │  │ Mode    │  │ Sandbox │
   └────┬────┘  └────┬────┘  └────┬────┘
        │            │            │
   ┌────▼────┐  ┌────▼────┐  ┌────▼────┐
   │ Baseten │  │ Sandbox │  │ Baseten │
   │ Chain   │  │ Direct  │  │ Chain   │
   │ (Plan)  │  │ Execute │  │ (Comms) │
   └────┬────┘  └────┬────┘  └────┬────┘
        │            │            │
        └────────────┴────────────┘
                     │
              ┌──────▼──────┐
              │   Sandbox   │
              │  (Daytona/  │
              │  Northflank)│
              └─────────────┘
```

## Installation

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run health check
npm run health
```

## Configuration

Create a `.env` file with:

```env
# Required
BASETEN_API_KEY=your_baseten_api_key

# Sandbox providers (at least one required)
DAYTONA_API_KEY=your_daytona_api_key
NORTHFLANK_API_TOKEN=your_northflank_token

# Optional
BASETEN_CHAIN_PORTFOLIO_ID=nwxlx5wy
SMART_ROUTER_MODE=waterfall
SMART_ROUTER_CHAIN_SPECIALTY=opencode-agent-wiring
SMART_ROUTER_WATERFALL_CHAIN_TIMEOUT_MS=60000
SMART_ROUTER_WATERFALL_SYNC_TIMEOUT_MS=120000
SANDBOX_PROVIDER=daytona
DRY_RUN=0
VERBOSE=0

# Local SurrealDB (sandbox logs + event logger)
SURREALDB_URL=http://localhost:8000
SURREALDB_NS=main
SURREALDB_DB=main
SURREALDB_USER=root
SURREALDB_PASS=root
```

## Cursor / agent skill

Discoverable skill (preferred for Cursor agents):

- [`.agents/skills/cloud-agent/SKILL.md`](.agents/skills/cloud-agent/SKILL.md)

OpenCode-oriented root skill: [`SKILL.md`](SKILL.md)

Invoke by asking the agent to use the **cloud-agent** skill (handoff, sandbox logs, SurrealDB verify).

## Usage

### Cloud Agent Handoff

```bash
# Full pipeline: plan via chain + execute in sandbox
npx tsx src/cloud-agent-handoff.ts --task "implement feature X" --target assistant-ui --full

# Plan only (via Baseten chain)
npx tsx src/cloud-agent-handoff.ts --task "implement feature X" --plan-only

# Execute with existing plan
npx tsx src/cloud-agent-handoff.ts --execute-only --plan-file tmp/plans/plan.md

# Specify sandbox provider and priority
npx tsx src/cloud-agent-handoff.ts --task "fix bug Y" --priority critical --sandbox-provider northflank
```

### Baseten Chain Sandbox Communication

```bash
# Query sandbox status
npx tsx src/baseten-chain-sandbox.ts --sandbox-id abc123 --operation query

# Execute command in sandbox
npx tsx src/baseten-chain-sandbox.ts --sandbox-id abc123 --operation execute --payload '{"cmd": "npm test"}'

# Get sandbox logs
npx tsx src/baseten-chain-sandbox.ts --sandbox-id abc123 --operation logs

# Monitor sandbox continuously
npx tsx src/baseten-chain-sandbox.ts --sandbox-id abc123 --monitor

# Pause/Resume sandbox
npx tsx src/baseten-chain-sandbox.ts --sandbox-id abc123 --operation pause
npx tsx src/baseten-chain-sandbox.ts --sandbox-id abc123 --operation resume
```

### Orchestrator

```bash
# Waterfall mode (chain soft-try → sync fallback)
npx tsx src/orchestrator.ts --mode waterfall --task "implement feature X" --target assistant-ui

# Full mode (chain + sandbox full orchestration)
npx tsx src/orchestrator.ts --mode full --task "implement feature X" --target assistant-ui

# Handoff only (direct sandbox execution, no chain)
npx tsx src/orchestrator.ts --mode handoff --task "implement feature X" --target assistant-ui

# Chain-sandbox only (direct chain communication with running sandbox)
npx tsx src/orchestrator.ts --mode chain-sandbox --sandbox-id abc123 --operation query
```

## Modes Explained

### Waterfall Mode (Default)

1. **Chain Soft-Try**: Attempt plan generation via Baseten chain with timeout
2. **Sync Fallback**: If chain fails/times out, generate plan locally
3. **Sandbox Execution**: Execute plan in sandbox via chain or direct

### Full Mode

1. **Chain Planning**: Always use Baseten chain for plan generation
2. **Sandbox Execution**: Execute plan in sandbox
3. **No Fallback**: If chain fails, execution is marked as failed

### Handoff Mode

- Direct sandbox execution without chain planning
- Local plan generation only
- Fastest but least sophisticated

### Chain-Sandbox Mode

- Only chain communication with running sandbox
- No plan generation or execution
- Use for monitoring, querying, and controlling sandboxes

## Sandbox logs → local SurrealDB

When you fetch sandbox logs (`getSandboxLogs` or `--operation logs`), content is written to the `sandbox_log` table on your local SurrealDB instance (`SURREALDB_URL`).

```bash
# Probe write/read (requires SurrealDB running)
npm run logs:verify

# Fetch live sandbox logs and persist
npm run logs:sync -- --fetch --sandbox-id <id>

# List recent persisted logs
npm run logs:sync -- --list --limit 10
```

Schema: [`schema.surql`](schema.surql) (`sandbox_log`). Writer: [`src/event-logger.ts`](src/event-logger.ts).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run handoff` | Run cloud agent handoff |
| `npm run chain-sandbox` | Run chain-sandbox communication |
| `npm run orchestrate` | Run full orchestrator |
| `npm run health` | Check health of all services |
| `npm run logs:verify` | Probe sandbox_log write/read on SurrealDB |
| `npm run logs:sync` | Fetch / list / manually write sandbox logs |
| `npm test` | Run unit tests |
| `npm run test:integration` | Run integration tests |
| `npm run lint` | Lint code |
| `npm run build` | Build TypeScript |
| `npm run dev` | Watch mode for development |

## Integration with Existing Skills

This system integrates with the existing OpenCode skills:

- `chain-sandbox-bridge`: Use for plan → sandbox execution only
- `baseten-chain`: Use for chain-only operations
- `orchestrator`: Use for multi-provider batch routing
- `northflank-sandbox-lifecycle`: Use for sandbox CRUD operations

## Testing

```bash
# Unit tests
npm test

# Integration tests (requires live API keys)
DRY_RUN=1 npm run test:integration

# Health check
npm run health

# Health check with verbose output
npm run health -- --verbose
```

## Directory Structure

```
cloud-agent/
├── .agents/skills/cloud-agent/     # Cursor/agent skill (preferred)
├── src/
│   ├── types.ts                    # Shared types and utilities
│   ├── cloud-agent-handoff.ts      # Main handoff implementation
│   ├── baseten-chain-sandbox.ts    # Chain-sandbox communication
│   ├── event-logger.ts             # SurrealDB event + sandbox_log writer
│   ├── sync-sandbox-logs.ts        # Verify / sync sandbox logs
│   ├── orchestrator.ts             # Combined orchestration
│   └── health-check.ts             # Health check utility
├── schema.surql                    # SurrealDB tables (incl. sandbox_log)
├── tmp/
│   ├── plans/                      # Generated plans
│   └── results/                    # Execution results
├── test/
│   └── integration.test.ts         # Integration tests
├── package.json
├── tsconfig.json
├── SKILL.md                        # OpenCode skill definition
└── README.md                       # This file
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `BASETEN_API_KEY` | Yes | - | Baseten API key |
| `DAYTONA_API_KEY` | No* | - | Daytona API key |
| `NORTHFLANK_API_TOKEN` | No* | - | Northflank API token |
| `BASETEN_CHAIN_PORTFOLIO_ID` | No | `qelg6953` | Chain portfolio ID (must be a deployed model in your Baseten account) |
| `SMART_ROUTER_MODE` | No | `waterfall` | Router mode |
| `SMART_ROUTER_CHAIN_SPECIALTY` | No | `opencode-agent-wiring` | Default chain specialty |
| `SMART_ROUTER_WATERFALL_CHAIN_TIMEOUT_MS` | No | `60000` | Chain timeout |
| `SMART_ROUTER_WATERFALL_SYNC_TIMEOUT_MS` | No | `120000` | Sync timeout |
| `SANDBOX_PROVIDER` | No | `daytona` | Default sandbox provider |
| `SURREALDB_URL` | No* | - | Local SurrealDB for sandbox logs (`http://localhost:8000`) |
| `SURREALDB_NS` | No | `main` | SurrealDB namespace |
| `SURREALDB_DB` | No | `main` | SurrealDB database |
| `SURREALDB_USER` | No | `root` | SurrealDB user |
| `SURREALDB_PASS` | No | `root` | SurrealDB password |
| `DRY_RUN` | No | `0` | Dry run mode |
| `VERBOSE` | No | `0` | Verbose logging |

\*Required for durable sandbox log persistence. Without it, logs fall back to in-memory storage.

*At least one sandbox provider API key is required for actual execution.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feat/amazing-feature`)
3. Commit your changes (`git commit -m 'feat: add amazing feature'`)
4. Push to the branch (`git push origin feat/amazing-feature`)
5. Open a Pull Request

## Troubleshooting

### Baseten Chain Returns 404

**Problem**: The chain endpoint returns `404 Not Found`.

**Solution**: 
1. Verify your `BASETEN_CHAIN_PORTFOLIO_ID` points to an actual deployed model in your Baseten account
2. The correct endpoint format is: `https://model-{MODEL_ID}.api.baseten.co/environments/production/sync`
3. Check available models via: `curl -H "Authorization: Api-Key $BASETEN_API_KEY" https://api.baseten.co/v1/models`

### Health Check Shows API Key Missing

**Problem**: Health check reports `BASETEN_API_KEY not configured` even when set in `.env`.

**Solution**: The `loadEnv()` function must be called before reading environment variables. Ensure `src/health-check.ts` calls `loadEnv(process.cwd())` before `getDefaultConfig()`.

### TypeScript Build Errors

**Problem**: `npm run build` fails with type errors.

**Solution**: Run scripts directly via `npx tsx src/<script>.ts` without building. The project uses `tsx` for execution.

## License

MIT
\n## ✅ Verified Connectivity\n\n- OpenCode Server :4096 ✅ Healthy\n- Cloud Agent Server :3000 ✅ Running\n- Baseten Chain qelg6953 ✅ Responds\n- Northflank Sandbox ✅ Ready\n- Proxy Path :9876 → Chain ✅ Confirmed
