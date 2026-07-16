# Cloud Agent Handoff - API Reference

## Core Interfaces

### AgentHandoffRequest

Task specification for cloud agent delegation.

```typescript
interface AgentHandoffRequest {
  /** Unique task identifier (auto-generated if not provided) */
  id: string;
  
  /** Task description - be specific about what to implement */
  task: string;
  
  /** Target repository or project name */
  target: string;
  
  /** Execution priority affects resource allocation and timeouts */
  priority: 'low' | 'normal' | 'high' | 'critical';
  
  /** Additional context (file paths, existing code, requirements) */
  context?: Record<string, unknown>;
  
  /** Request timeout in milliseconds (default: 60000) */
  timeout?: number;
  
  /** Preferred sandbox provider */
  sandboxProvider?: 'daytona' | 'northflank';
  
  /** Whether to use Baseten chain for plan generation (default: true) */
  useChain?: boolean;
  
  /** Chain specialty to use for planning (default: prd-daytona-execute) */
  chainSpecialty?: string;
  
  /** Git branch prefix for PRs (default: feat/cloud-agent) */
  branchPrefix?: string;
  
  /** Tags for categorization and filtering */
  tags?: string[];
  
  /** Set to true to skip execution, generate plan only */
  planOnly?: boolean;
}
```

### AgentHandoffResult

Execution result with status and artifacts.

```typescript
interface AgentHandoffResult {
  /** Overall success status */
  ok: boolean;
  
  /** Handoff ID (matches request ID) */
  id: string;
  
  /** Sandbox provider used for execution */
  sandboxProvider: string;
  
  /** Sandbox ID if created/used */
  sandboxId?: string;
  
  /** Chain execution ID if chain was used */
  chainExecutionId?: string;
  
  /** Paths to generated plan files */
  planFiles?: string[];
  
  /** Execution step results */
  executeResults?: Array<{
    segment: string;
    status: 'ok' | 'error' | 'pending';
    branch?: string;
    details?: string;
  }>;
  
  /** Error message if failed */
  error?: string;
  
  /** ISO timestamp of completion */
  timestamp: string;
}
```

### SandboxChainRequest

Request for communicating with a running sandbox via chain.

```typescript
interface SandboxChainRequest {
  /** Chain specialty to route request */
  specialty: string;
  
  /** Target sandbox ID */
  sandboxId: string;
  
  /** Operation type */
  operation: 'query' | 'execute' | 'monitor' | 'health' | 'logs' | 'pause' | 'resume';
  
  /** Operation payload */
  payload: Record<string, unknown>;
  
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
  
  /** Portfolio ID override (default: from env) */
  portfolioId?: string;
}
```

### SandboxChainResponse

Response from sandbox communication.

```typescript
interface SandboxChainResponse {
  /** Operation success status */
  ok: boolean;
  
  /** Chain execution ID */
  executionId?: string;
  
  /** Current sandbox state */
  sandboxState?: {
    id: string;
    status: 'running' | 'paused' | 'stopped' | 'error';
    url?: string;
    lastActivity?: string;
  };
  
  /** Response data */
  data?: Record<string, unknown>;
  
  /** Error if operation failed */
  error?: string;
  
  /** ISO timestamp */
  timestamp: string;
}
```

## CLI Commands

### Cloud Agent Handoff

```bash
npx tsx src/cloud-agent-handoff.ts [options]
```

**Options**:

| Option | Description | Default |
|--------|-------------|---------|
| `--task TEXT` | Task description to implement | **Required** |
| `--target REPO` | Target repository/project | `assistant-ui` |
| `--priority LEVEL` | Priority: low/normal/high/critical | `normal` |
| `--sandbox-provider PROVIDER` | Provider: daytona/northflank | `daytona` |
| `--plan-only` | Generate plan only, skip execution | `false` |
| `--execute-only` | Execute existing plan file | `false` |
| `--plan-file PATH` | Path to existing plan file | - |
| `--chain-specialty SPEC` | Baseten chain specialty | `prd-daytona-execute` |
| `--branch-prefix PREFIX` | Git branch prefix | `feat/cloud-agent` |
| `--timeout MS` | Request timeout in milliseconds | `60000` |
| `--dry-run` | Simulate without live execution | `false` |
| `--verbose` | Enable detailed logging | `false` |

**Examples**:

```bash
# Full pipeline - plan and execute
npx tsx src/cloud-agent-handoff.ts \
  --task "Add user authentication API" \
  --target backend-api \
  --priority high

# Plan only
npx tsx src/cloud-agent-handoff.ts \
  --task "Implement caching layer" \
  --target data-pipeline \
  --plan-only

# Execute with existing plan
npx tsx src/cloud-agent-handoff.ts \
  --execute-only \
  --plan-file tmp/plans/my-plan.md

# Use Northflank with verbose output
npx tsx src/cloud-agent-handoff.ts \
  --task "Deploy monitoring dashboard" \
  --sandbox-provider northflank \
  --verbose
```

### Baseten Chain Sandbox

```bash
npx tsx src/baseten-chain-sandbox.ts [options]
```

**Options**:

| Option | Description | Default |
|--------|-------------|---------|
| `--sandbox-id ID` | Target sandbox ID | **Required** |
| `--operation OP` | Operation type | `query` |
| `--specialty SPEC` | Chain specialty | `dev-router` |
| `--payload JSON` | JSON payload for operation | `{}` |
| `--timeout MS` | Request timeout | `30000` |
| `--monitor` | Continuous monitoring mode | `false` |

**Operations**:

- `query` - Get sandbox status
- `execute` - Execute command in sandbox
- `monitor` - Continuous monitoring (use with `--monitor`)
- `health` - Health check
- `logs` - Retrieve logs
- `pause` - Pause sandbox
- `resume` - Resume sandbox

**Examples**:

```bash
# Query sandbox status
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation query

# Execute command
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation execute \
  --payload '{"cmd": "npm test"}'

# Monitor continuously
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --monitor

# Get logs
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation logs \
  --payload '{"lines": 50}'

# Pause sandbox
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation pause
```

### Orchestrator

```bash
npx tsx src/orchestrator.ts [options]
```

**Options**:

| Option | Description | Default |
|--------|-------------|---------|
| `--mode MODE` | Execution mode | `waterfall` |
| `--task TEXT` | Task description | **Required** (except chain-sandbox) |
| `--target REPO` | Target repository | `assistant-ui` |
| `--sandbox-id ID` | Sandbox ID (for chain-sandbox mode) | - |
| `--operation OP` | Operation (for chain-sandbox mode) | `query` |
| `--plan-only` | Plan only | `false` |
| `--execute-only` | Execute only | `false` |
| `--dry-run` | Simulate execution | `false` |
| `--verbose` | Verbose output | `false` |
| `--output-format FMT` | Output format: json/yaml/markdown | `json` |

**Modes**:

- `waterfall` - Chain soft-try, fallback to sync (default)
- `full` - Chain + sandbox full orchestration
- `handoff` - Direct sandbox execution without chain
- `chain-sandbox` - Direct chain-sandbox communication only

**Examples**:

```bash
# Waterfall mode (default)
npx tsx src/orchestrator.ts \
  --mode waterfall \
  --task "Implement feature X" \
  --target assistant-ui

# Full mode with verbose output
npx tsx src/orchestrator.ts \
  --mode full \
  --task "Refactor API endpoints" \
  --target backend-api \
  --verbose

# Chain-sandbox query mode
npx tsx src/orchestrator.ts \
  --mode chain-sandbox \
  --sandbox-id abc123 \
  --operation query

# Handoff mode (direct, no chain planning)
npx tsx src/orchestrator.ts \
  --mode handoff \
  --task "Fix critical bug" \
  --priority critical
```

### Health Check

```bash
npx tsx src/health-check.ts [options]
```

**Options**:

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose` | Show detailed output | `false` |

**Checks**:
- Environment variables (BASETEN_API_KEY, etc.)
- Baseten chain API connectivity
- Daytona sandbox API accessibility
- Northflank sandbox API accessibility

**Example**:

```bash
# Quick check
npx tsx src/health-check.ts

# Detailed check
npx tsx src/health-check.ts --verbose
```

## Programmatic API

### Using CloudAgentOrchestrator

```typescript
import { CloudAgentOrchestrator } from './src/orchestrator.js';
import { getDefaultConfig } from './src/types.js';

const config = {
  ...getDefaultConfig(),
  mode: 'waterfall',
  defaultSandboxProvider: 'daytona',
  chainPortfolioId: 'nwxlx5wy',
  basetenApiKey: process.env.BASETEN_API_KEY,
};

const orchestrator = new CloudAgentOrchestrator(config);

// Execute a task
const result = await orchestrator.waterfall({
  id: 'handoff-123',
  task: 'Implement user authentication',
  target: 'my-app',
  priority: 'high',
  useChain: true,
  chainSpecialty: 'prd-daytona-execute',
});

console.log(result.ok ? 'Success' : 'Failed');
console.log('Plan files:', result.planFiles);
console.log('Execution:', result.executeResults);
```

### Using BasetenChainSandbox

```typescript
import { BasetenChainSandbox } from './src/baseten-chain-sandbox.js';

const chain = new BasetenChainSandbox(config);

// Generate plan
const planResult = await chain.executeChain({
  specialty: 'prd-daytona-execute',
  input: {
    task: 'Add caching layer',
    target: 'data-pipeline',
    operation: 'plan',
  },
});

// Query sandbox status
const status = await chain.querySandboxStatus('sandbox-123');
console.log('Sandbox status:', status.sandboxState?.status);

// Monitor sandbox
await chain.monitorSandbox('sandbox-123', 10000); // 10s interval

// Get logs
const logs = await chain.getSandboxLogs('sandbox-123', 100);
```

### Direct Sandbox Communication

```typescript
// Execute operation in sandbox
const response = await chain.communicateWithSandbox({
  specialty: 'dev-router',
  sandboxId: 'sandbox-123',
  operation: 'execute',
  payload: {
    cmd: 'npm test',
    env: { NODE_ENV: 'test' },
  },
});

// Pause sandbox
await chain.pauseSandbox('sandbox-123');

// Resume sandbox
await chain.resumeSandbox('sandbox-123');
```

## Environment Variables

### Required

| Variable | Purpose | Example |
|----------|---------|---------|
| `BASETEN_API_KEY` | Baseten chain authentication | `wcg2jGiU.lfzu28Hou...` |

### Sandbox Providers (at least one)

| Variable | Purpose | Example |
|----------|---------|---------|
| `DAYTONA_API_KEY` | Daytona sandbox management | `dtn_...` |
| `NORTHFLANK_API_TOKEN` | Northflank sandbox management | `nf-...` |

### Optional

| Variable | Purpose | Default |
|----------|---------|---------|
| `BASETEN_CHAIN_PORTFOLIO_ID` | Portfolio chain ID | `nwxlx5wy` |
| `SMART_ROUTER_MODE` | Router mode | `waterfall` |
| `SMART_ROUTER_CHAIN_SPECIALTY` | Default chain specialty | `prd-daytona-execute` |
| `SMART_ROUTER_WATERFALL_CHAIN_TIMEOUT_MS` | Chain timeout | `60000` |
| `SMART_ROUTER_WATERFALL_SYNC_TIMEOUT_MS` | Sync timeout | `120000` |
| `SANDBOX_PROVIDER` | Default provider | `daytona` |
| `CHAIN_DAYTONA_TIMEOUT_SEC` | Daytona execution timeout | `1800` |
| `DRY_RUN` | Enable dry-run mode | `0` |
| `VERBOSE` | Enable verbose logging | `0` |
| `GIT_REPO_URL` | Repository to clone in sandbox | Auto-detected |
| `GIT_TOKEN` | Git authentication token | Auto-detected |

## Error Codes

| Code | Meaning | Resolution |
|------|---------|------------|
| `BASETEN_API_KEY missing` | Chain API key not configured | Set BASETEN_API_KEY env var |
| `DAYTONA_API_KEY missing` | Daytona not configured | Set DAYTONA_API_KEY or use --dry-run |
| `Chain timeout` | Chain took too long | Increase timeout or use sync fallback |
| `Sandbox create failed` | Could not create sandbox | Check API key, quotas, network |
| `Bootstrap failed` | Sandbox setup failed | Check logs, repo access, dependencies |
| `Agent execution failed` | Task execution failed | Check plan, sandbox logs, timeout |
| `Git push failed` | Could not push branch | Check GIT_TOKEN, branch permissions |

## TypeScript Types

All types are exported from `src/types.js`:

```typescript
import {
  AgentHandoffRequest,
  AgentHandoffResult,
  SandboxChainRequest,
  SandboxChainResponse,
  OrchestratorConfig,
  ChainExecutionResult,
  SandboxProvider,
  SandboxInfo,
  SandboxCreateOptions,
  SandboxExecuteResult,
} from './src/types.js';
```

## Testing

```bash
# Run all tests
npm test

# Run with coverage
npm test -- --coverage

# Integration tests (requires API keys)
DRY_RUN=1 npm test

# Health check
npm run health
```

## Package Scripts

```json
{
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "test": "node --test dist/**/*.test.js",
    "test:integration": "npx tsx test/integration.test.ts",
    "lint": "eslint src/**/*.ts",
    "handoff": "npx tsx src/cloud-agent-handoff.ts",
    "chain-sandbox": "npx tsx src/baseten-chain-sandbox.ts",
    "orchestrate": "npx tsx src/orchestrator.ts",
    "health": "npx tsx src/health-check.ts"
  }
}
```
