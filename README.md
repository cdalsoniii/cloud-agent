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

## Documentation

| Document | Description |
|----------|-------------|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | System architecture, data flow, integration points, security |
| [API.md](docs/API.md) | Complete API reference for all interfaces and CLI commands |
| [GUIDE.md](docs/GUIDE.md) | Usage examples, patterns, troubleshooting, best practices |

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
```

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

## Scripts

| Script | Description |
|--------|-------------|
| `npm run handoff` | Run cloud agent handoff |
| `npm run chain-sandbox` | Run chain-sandbox communication |
| `npm run orchestrate` | Run full orchestrator |
| `npm run health` | Check health of all services |
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
├── src/
│   ├── types.ts                    # Shared types and utilities
│   ├── cloud-agent-handoff.ts      # Main handoff implementation
│   ├── baseten-chain-sandbox.ts    # Chain-sandbox communication
│   ├── orchestrator.ts             # Combined orchestration
│   └── health-check.ts             # Health check utility
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
| `DRY_RUN` | No | `0` | Dry run mode |
| `VERBOSE` | No | `0` | Verbose logging |

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
