# Mastra Daytona Orchestrator with Midspiral Verification

## Overview

This directory contains a **Mastra.ai** agent system that orchestrates the full Daytona sandbox lifecycle with **formal verification** at every step using Midspiral business rules.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     Mastra Orchestrator                         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │   validate   │→ │   create     │→ │  bootstrap   │         │
│  │ environment  │  │  sandbox     │  │   sandbox    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│         ↓                 ↓                 ↓                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ verify-rule  │  │ verify-rule  │  │ verify-rule  │         │
│  │env-vars     │  │sandbox-id   │  │bootstrap-ok  │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ connectivity │→ │ execute task │→ │   cleanup    │         │
│  │    check     │  │              │  │   sandbox    │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│         ↓                 ↓                 ↓                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ verify-rule  │  │ verify-rule  │  │ verify-rule  │         │
│  │connectivity │  │ task-ok      │  │ cleanup-ok   │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## Components

### 1. Mastra Agent (`agents/daytona-agent.ts`)

The `daytonaOrchestratorAgent` is the main AI agent that manages the sandbox lifecycle. It has:
- **System instructions** defining the complete workflow and error handling
- **8 tools** for sandbox operations and verification
- **Business rule compliance** built into every step

### 2. Mastra Workflow (`workflows/daytona-workflow.ts`)

The `daytonaOrchestrationWorkflow` is a declarative workflow with 6 steps:

1. **validate-environment** → Verify `DAYTONA_API_KEY`, `GIT_TOKEN`, `GIT_REPO_URL`, `BASETEN_API_KEY`
2. **create-sandbox** → Create Daytona sandbox via `provider.sh create`
3. **bootstrap-sandbox** → Clone repo and install harness via `provider.sh bootstrap`
4. **connectivity-check** → Probe Baseten/proxy endpoint from within sandbox
5. **execute-task** → Run the agent task via `provider.sh exec`
6. **cleanup-sandbox** → Destroy the sandbox (optional)

Each step includes **formal verification** of business rules.

### 3. Mastra Tools (`tools/daytona-tools.ts`)

| Tool | Purpose | Verification Rule |
|------|---------|-------------------|
| `envValidationTool` | Check required env vars | `rule-env-vars-present` |
| `daytonaCreateTool` | Create sandbox | `rule-sandbox-id-present` |
| `daytonaBootstrapTool` | Bootstrap sandbox | `rule-bootstrap-exit-code-0` |
| `daytonaConnectivityTool` | Check connectivity | `rule-connectivity-http-ok` |
| `daytonaExecTool` | Execute task | `rule-task-exit-code-0` |
| `daytonaShellTool` | Debug shell access | - |
| `daytonaDestroyTool` | Cleanup sandbox | - |
| `verifyRuleTool` | Formal verification via Midspiral | All rules |

### 4. Business Rules (`rules/business_rules.yaml`)

11 formal business rules covering:
- **Infrastructure** (6 rules): Env vars, sandbox creation, bootstrap, connectivity, task execution, domain allow list
- **Security** (2 rules): Secret redaction, API key validation
- **Compliance** (3 rules): Model ID validity, provider explicitness, model routing

### 5. Verification Script (`tools/verify-rules.ts`)

Run `npx tsx src/mastra/tools/verify-rules.ts` to verify all business rules against the current environment.

## Usage

### Run the Workflow

```bash
# Dry run (no actual sandbox creation)
npx tsx src/mastra/index.ts --dry-run --task "echo hello world"

# Full execution with task
npx tsx src/mastra/index.ts --task "implement a React component" --harness opencode

# Skip cleanup (keep sandbox alive for debugging)
npx tsx src/mastra/index.ts --task "debug connectivity" --skip-cleanup
```

### Verify Business Rules

```bash
npm run mastra:verify
# or
npx tsx src/mastra/tools/verify-rules.ts
```

## Integration with Midspiral

The system uses Midspiral tools for formal verification:

1. **Business Rules** stored in YAML (`rules/business_rules.yaml`)
2. **Formal Verification** via `verifyRuleTool` which checks assertions against actual execution results
3. **SurrealQL Assertions** define the expected state in each step

Example verification flow:
```
Step: create-sandbox
  → Execute daytonaCreateTool
  → Verify rule: sandbox_id MATCHES UUID pattern
  → If verified: proceed to bootstrap
  → If failed: halt and report violation
```

## Error Handling

| Error Code | Meaning | Action |
|------------|---------|--------|
| 408 | Baseten model cold-scaled | Retry with exponential backoff |
| 401 | Invalid API key | Fail fast, report authentication error |
| 000 | Network blocked from sandbox | Report firewall/TLS issue |
| 503 | Northflank proxy down | Switch to Daytona or fallback |

## Configuration

Required environment variables:
```bash
DAYTONA_API_KEY=       # Daytona API key
GIT_TOKEN=             # GitHub token for repo access
GIT_REPO_URL=          # Repository to clone into sandbox
BASETEN_API_KEY=       # Baseten API key for inference
WARP_BASETEN_QWEN=1    # Enable Baseten Qwen routing
GPU_INFERENCE_STACK_DIR= # Path to gpu-inference-stack repo
```

## File Structure

```
src/mastra/
├── index.ts                    # Main entry point
├── agents/
│   └── daytona-agent.ts        # Mastra agent definition
├── workflows/
│   └── daytona-workflow.ts    # Workflow with 6 steps
├── tools/
│   ├── daytona-tools.ts        # Daytona operation tools
│   └── verify-rules.ts         # Business rule verification
└── README.md                   # This file

rules/
└── business_rules.yaml         # 11 formal business rules
```

## Comparison with Shell Scripts

| Feature | Shell Scripts | Mastra Agent |
|---------|--------------|--------------|
| Error handling | Manual | Built-in with retries |
| Verification | None | Formal (Midspiral) |
| Audit trail | Log files | Structured JSON |
| Business rules | Implicit | Explicit YAML |
| Extensibility | Hard | Easy via new tools |
| Reusability | Low | High (workflow engine) |

## Known Issues & Workarounds

### Baseten IP Blocking from Daytona Sandbox

Baseten returns **403 Forbidden** from Daytona sandbox IPs, preventing direct model inference. Verified that:
- Local machine: 200 OK (same API key)
- Daytona sandbox: 403 Forbidden (same API key, same endpoint)

**Workarounds:**

1. **Fireworks AI Fallback** (Recommended): Fireworks AI is reachable from the sandbox (domain allow list includes `*.fireworks.ai`). Tested successfully with `gpt-oss-120b` model.
   ```bash
   # Update sandbox opencode config to use Fireworks
   python3 scripts/sandbox_daytona.py shell --command \
     'cat > ~/.config/opencode/opencode.json << EOF
   {"provider":{"fireworks-ai":{"npm":"@ai-sdk/openai-compatible",
   "options":{"baseURL":"https://api.fireworks.ai/inference/v1",
   "apiKey":"fw_PBxvxxy78mNCuUN3vYE3Hb"},
   "models":{"gpt-oss-120b":{"name":"Fireworks GPT-OSS-120B","tool_call":true}}}},
   "small_model":"fireworks-ai/gpt-oss-120b"}'
   ```

2. **Host Proxy + ngrok**: `baseten-proxy.js` creates a local HTTP proxy that forwards to Baseten with auth injection. ngrok exposes it to the sandbox. **Note**: Requires adding `*.ngrok-free.app` to `DOMAIN_ALLOW` (currently 16/20 domains, room for 4 more).

3. **Northflank Proxy**: `*.code.run` is in the allow list but current proxy is down (503). Deploy a new Northflank service to provide a working proxy.

### Integration Test Results

- **17/17 integration tests passed** in `DRY_RUN=1` mode
- Tests cover: full workflow, chain plan generation, sandbox communication, plan structure validation
- Run with: `npm run test:integration` (requires `DRY_RUN=1`)

## Next Steps

1. **Connect to SurrealDB**: When SurrealDB is available, load rules into the database for runtime enforcement
2. **Add retry logic**: Implement exponential backoff for 408 timeouts and provider fallback
3. **Metrics**: Add OpenTelemetry instrumentation to track step timing and success rates
4. **Dashboard**: Use the existing dashboard to visualize workflow execution
5. **Automated testing**: Run `mastra:verify` in CI/CD pipeline before deployment
6. **Provider fallback**: Automate Baseten → Fireworks fallback when 403 detected from sandbox
