# Cloud Agent Handoff - Architecture

## System Overview

The Cloud Agent Handoff system enables local agents to delegate tasks to cloud-based agents running in sandboxes, orchestrated through Baseten chain for planning and Daytona/Northflank for execution.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           LOCAL DEVELOPMENT ENVIRONMENT                      │
│                                                                              │
│  ┌──────────────┐     ┌──────────────┐     ┌──────────────────────────┐    │
│  │   You /      │────▶│  Cloud Agent │────▶│  Baseten Chain Portfolio │    │
│  │   Local AI   │     │  Handoff CLI │     │  (nwxlx5wy)              │    │
│  └──────────────┘     └──────────────┘     └──────────────────────────┘    │
│                              │                          │                    │
│                              │                          │ Plan Generation   │
│                              │                          ▼                    │
│                              │                   ┌──────────────┐           │
│                              │                   │   Plan File  │           │
│                              │                   │  (tmp/plans) │           │
│                              │                   └──────────────┘           │
│                              │                          │                    │
│                              │ Execute                   │                    │
│                              ▼                          ▼                    │
│  ┌─────────────────────────────────────────────────────────────────────┐     │
│  │                         SANDBOX ENVIRONMENT                        │     │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────┐  │     │
│  │  │   Daytona    │───▶│ OpenCode     │───▶│   Agent Execution    │  │     │
│  │  │   Sandbox    │    │ Serve (:4096)│    │   (opencode-sdk)     │  │     │
│  │  └──────────────┘    └──────────────┘    └──────────────────────┘  │     │
│  │         │                                              │             │     │
│  │         │ Bootstrap                                    │ Git         │     │
│  │         │ (clone repo)                                 │ Commit      │     │
│  │         ▼                                              ▼             │     │
│  │  ┌──────────────┐                            ┌──────────────────┐   │     │
│  │  │   Git Repo   │◀───────────────────────────│  Feature Branch  │   │     │
│  │  │   (GitHub)   │         Push PR            │  (feat/xxx)      │   │     │
│  └─────────────────────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Cloud Agent Handoff (`src/cloud-agent-handoff.ts`)

**Purpose**: Main entry point for delegating tasks to cloud agents.

**Workflow**:
1. Parses CLI arguments and validates configuration
2. Generates plan via Baseten chain (with local fallback)
3. Executes plan in sandbox via `chain-daytona-opencode-prd.ts`
4. Tracks results and returns status

**Key Interfaces**:
- `AgentHandoffRequest`: Task specification with target, priority, provider
- `AgentHandoffResult`: Execution status with plan files and step results

### 2. Baseten Chain Sandbox (`src/baseten-chain-sandbox.ts`)

**Purpose**: Communicates with Baseten chain portfolio for plan generation and sandbox control.

**Features**:
- Chain execution with specialty routing (`prd-daytona-execute`, `dev-router`, `roadmap`)
- Sandbox status querying
- Log retrieval
- Pause/resume operations
- Continuous monitoring

**Architecture**:
```
BasetenChainSandbox
├── executeChain()        → POST to portfolio endpoint
├── communicateWithSandbox() → Chain-mediated sandbox ops
├── querySandboxStatus()   → Health check
├── getSandboxLogs()      → Log retrieval
├── pauseSandbox()        → Resource management
├── resumeSandbox()       → Resource management
└── monitorSandbox()      → Continuous monitoring loop
```

### 3. Orchestrator (`src/orchestrator.ts`)

**Purpose**: Unified orchestration combining multiple execution modes.

**Modes**:

| Mode | Chain Planning | Sandbox Execution | Fallback | Use Case |
|------|---------------|-------------------|----------|----------|
| `waterfall` | Soft-try (timeout) | Yes | Sync local | Default, resilient |
| `full` | Required | Yes | None | Full chain control |
| `handoff` | None | Direct | N/A | Fast, no chain |
| `chain-sandbox` | N/A | Direct chain only | N/A | Monitor/control |

**Waterfall Flow**:
```
User Request
    │
    ▼
┌──────────────┐
│  Try Chain   │────timeout?──┐
│   (60s)     │              │
└──────────────┘              │
    │ success                 │
    ▼                         │
Plan Generated                │
    │                         │
    ▼                         │
Execute in Sandbox            │
    │                         │
    ▼                         │
Done                         │
                             │
                    ┌─────────▼─────────┐
                    │   Sync Fallback   │
                    │  (Local Plan Gen) │
                    └─────────┬─────────┘
                              │
                              ▼
                        Execute in Sandbox
```

## Data Flow

### Plan Generation Flow

```
1. User specifies task: "Implement feature X in assistant-ui"
                    │
                    ▼
2. Orchestrator sends to Baseten Chain:
   {
     "specialty": "prd-daytona-execute",
     "input": {
       "task": "Implement feature X",
       "target": "assistant-ui",
       "operation": "plan"
     }
   }
                    │
                    ▼
3. Chain returns structured plan:
   # Implementation Plan
   ### 1. Analyze Requirements
   ### 2. Design Implementation
   ### 3. Implement Changes
   ### 4. Test and Validate
   ### 5. Commit and Create PR
                    │
                    ▼
4. Plan saved to tmp/plans/handoff-{id}.md
```

### Execution Flow

```
1. Plan loaded from file
                    │
                    ▼
2. Daytona sandbox created:
   - Clone repository
   - Start OpenCode serve (:4096)
                    │
                    ▼
3. Agent executes in sandbox:
   - Reads plan
   - Implements changes
   - Runs tests
   - Commits to branch
                    │
                    ▼
4. Results returned:
   - Sandbox ID
   - Branch name
   - Test results
   - PR link (if created)
```

## Integration Points

### Baseten Chain Portfolio

**Endpoint**: `https://app.baseten.co/api/v1/models/{portfolioId}/predict`

**Specialties** (from `config/baseten-chain-ids.json`):
- `prd-daytona-execute`: Main execution specialty
- `opencode-agent-wiring`: Agent configuration
- `dev-router`: Sandbox routing and monitoring
- `roadmap`: Planning and roadmap generation
- `deep-research-brief`: Research tasks

**Request Format**:
```json
{
  "request": {
    "task": "string",
    "target": "string",
    "priority": "normal|high|critical",
    "operation": "plan|execute"
  },
  "specialty": "prd-daytona-execute"
}
```

### Daytona Sandbox

**Bootstrap Process** (from `scripts/sandbox-daytona.sh`):
1. Create sandbox with API key
2. Clone repository using GIT_TOKEN
3. Install dependencies
4. Start `opencode serve` on port 4096
5. Verify health endpoint

**Execution**:
```bash
# Inside sandbox
npx tsx scripts/agent-opencode-sdk.ts \
  --task "$PLAN_TEXT" \
  --branch "feat/xxx" \
  --timeout 1800
```

### OpenCode Server

**Endpoints** (inside sandbox):
- `GET /health` - Health check
- `POST /execute` - Task execution
- `GET /status` - Execution status

## Configuration

### Environment Variables

```bash
# Required
BASETEN_API_KEY=wcg2jGiU.lfzu28HouNbIFIsVvGD7tuJ3DokRW4bd

# Sandbox Providers (at least one)
DAYTONA_API_KEY=dtn_ccd302e6d1f2c292360a6daaec36220924b05396122e6e129912b63285c32279
NORTHFLANK_API_TOKEN=nf-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

# Optional - Chain Configuration
BASETEN_CHAIN_PORTFOLIO_ID=nwxlx5wy
SMART_ROUTER_CHAIN_SPECIALTY=prd-daytona-execute
SMART_ROUTER_WATERFALL_CHAIN_TIMEOUT_MS=60000
SMART_ROUTER_WATERFALL_SYNC_TIMEOUT_MS=120000

# Optional - Sandbox
SANDBOX_PROVIDER=daytona
CHAIN_DAYTONA_TIMEOUT_SEC=1800

# Optional - Git
GIT_REPO_URL=https://github.com/user/repo.git
GIT_TOKEN=ghp_xxx
```

### File Structure

```
cloud-agent/
├── src/
│   ├── types.ts                    # Shared interfaces and utilities
│   ├── cloud-agent-handoff.ts      # Main handoff CLI
│   ├── baseten-chain-sandbox.ts   # Chain communication client
│   ├── orchestrator.ts            # Unified orchestration
│   └── health-check.ts            # Service health validation
├── test/
│   └── integration.test.ts        # 17 passing tests
├── tmp/
│   ├── plans/                     # Generated plans
│   └── results/                   # Execution results
├── SKILL.md                        # OpenCode skill definition
├── README.md                       # User documentation
└── ARCHITECTURE.md                 # This file
```

## Security Considerations

1. **API Keys**: Never commit `.env` files. Use environment variables or secret managers.
2. **Sandbox Isolation**: Each task runs in a fresh sandbox. Sandboxes are destroyed after execution (unless `--keep-sandbox`).
3. **Git Tokens**: `GIT_TOKEN` is used only inside sandbox for cloning/pushing. Not exposed to chain.
4. **Plan Files**: Contain task descriptions but no secrets. Stored in `tmp/` (gitignored).

## Performance Characteristics

| Operation | Typical Time | Notes |
|-----------|-------------|-------|
| Chain plan generation | 5-30s | Depends on task complexity |
| Sandbox creation | 30-60s | Daytona cold start |
| Bootstrap (clone + deps) | 60-120s | Depends on repo size |
| Agent execution | 5-30min | Depends on task scope |
| Total waterfall | 6-35min | End-to-end |

## Error Handling

### Retry Strategy

```typescript
// Chain operations: 2 attempts with exponential backoff
retry(fn, { attempts: 2, delay: 2000, backoff: 2 })

// Sandbox operations: 3 attempts
retry(fn, { attempts: 3, delay: 1000, backoff: 2 })
```

### Fallback Behavior

| Failure Point | Fallback Action | Result |
|--------------|----------------|--------|
| Chain timeout | Use local plan generation | Local plan + sandbox exec |
| Chain error | Use local plan generation | Local plan + sandbox exec |
| Sandbox create fail | Exit with error | Sync fallback (OpenCode) |
| Sandbox exec fail | Retry 2x, then exit | Error with logs |
| Git push fail | Continue with local branch | Warning, manual PR needed |

## Monitoring and Observability

### Health Check

```bash
npm run health -- --verbose
```

Checks:
- Environment variables configured
- Baseten chain API accessible
- Daytona API accessible
- Northflank API accessible (if configured)

### Execution Logs

```bash
# View plan
ls tmp/plans/

# View results
ls tmp/results/

# Monitor sandbox
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --monitor
```

## Extending the System

### Adding a New Chain Specialty

1. Add specialty to `baseten-chain-ids.json`
2. Update `buildChainPayload()` in `baseten-chain-sandbox.ts`
3. Add test case in `integration.test.ts`

### Adding a New Sandbox Provider

1. Implement `SandboxProvider` interface in `types.ts`
2. Add provider CLI to `sandbox-{provider}.sh`
3. Update `executeInSandbox()` in `cloud-agent-handoff.ts`
4. Add provider-specific tests

## References

- [Baseten Chain Portfolio](https://app.baseten.co/models/nwxlx5wy)
- [Daytona API Docs](https://www.daytona.io/docs)
- [OpenCode SDK](https://github.com/opencode-ai/opencode)
- [gpu-inference-stack/scripts/chain-daytona-opencode-prd.ts](../gpu-inference-stack/scripts/chain-daytona-opencode-prd.ts)
