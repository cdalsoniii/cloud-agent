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

**Root Cause**: Baseten blocks unknown IP ranges (Daytona sandbox IPs are not in Baseten's allow list). This is a security measure to prevent abuse.

**Workarounds:**

### 1. Host Proxy + ngrok (Recommended for Baseten)

`baseten-proxy.js` creates a local HTTP proxy that forwards to Baseten with auth injection. ngrok exposes it to the sandbox.

**Setup:**
```bash
# 1. Start the proxy on the host machine
cd cloud-agent
export BASETEN_API_KEY=<your-key>
export BASETEN_MODEL_ID=qelg6953
node baseten-proxy.js &

# 2. Start ngrok tunnel
ngrok http 9876 &

# 3. Get the ngrok URL
curl -sS http://127.0.0.1:4040/api/tunnels | python3 -c "
import json, sys
data = json.load(sys.stdin)
for t in data.get('tunnels', []):
    u = t.get('public_url', '')
    if u.startswith('https://'):
        print(u)
        break
"

# 4. Update sandbox opencode config
python3 scripts/sandbox_daytona.py shell --command \
  'cat > ~/.config/opencode/opencode.json << EOF
{"provider":{"baseten-proxy":{"npm":"@ai-sdk/openai-compatible",
"options":{"baseURL":"https://<ngrok-url>/v1","apiKey":"sk-proxy"},
"models":{"qwen-coder":{"name":"Qwen-2.5-Coder-32B-Instruct","tool_call":true}}}},
"small_model":"baseten-proxy/qwen-coder"}'

# 5. Restart opencode server
python3 scripts/sandbox_daytona.py shell --command \
  'pkill -f "opencode serve" || true; sleep 2; cd ~/gpu-inference-stack && \
   nohup opencode serve --hostname 127.0.0.1 --port 4096 > /tmp/opencode.log 2>&1 &'
```

**Note**: Requires adding `*.ngrok-free.app` to `DOMAIN_ALLOW` (18/20 domains as of latest commit).

### 2. Fireworks AI Fallback (Alternative)

Fireworks AI is reachable from the sandbox (domain allow list includes `*.fireworks.ai`). Tested successfully with `gpt-oss-120b` model.

```bash
python3 scripts/sandbox_daytona.py shell --command \
  'cat > ~/.config/opencode/opencode.json << EOF
{"provider":{"fireworks-ai":{"npm":"@ai-sdk/openai-compatible",
"options":{"baseURL":"https://api.fireworks.ai/inference/v1",
"apiKey":"fw_PBxvxxy78mNCuUN3vYE3Hb"},
"models":{"gpt-oss-120b":{"name":"Fireworks GPT-OSS-120B","tool_call":true}}}},
"small_model":"fireworks-ai/gpt-oss-120b"}'
```

### 3. Northflank Proxy (When Available)

`*.code.run` is in the allow list but current proxy is down (503). Deploy a new Northflank service to provide a working proxy.

### 4. Automatic Provider Fallback (Mastra Workflow)

The updated Mastra workflow now automatically tries providers in order:
1. **Baseten** (direct) → if 403, fallback to:
2. **Fireworks** → if unavailable, fallback to:
3. **Proxy** (ngrok tunnel) → if unavailable, fallback to:
4. **Northflank**

Configure the preferred provider:
```bash
npx tsx src/mastra/index.ts --task "Implement feature" --provider baseten --proxy-url https://<ngrok>.ngrok-free.app
```

## Integration Test Results

- **17/17 integration tests passed** in `DRY_RUN=1` mode
- Tests cover: full workflow, chain plan generation, sandbox communication, plan structure validation
- Run with: `npm run test:integration` (requires `DRY_RUN=1`)

## Live Test Results

- **Sandbox**: `d57eaa11-9246-49b8-9981-b5cc21a9acd7` (Daytona large)
- **Proxy**: `https://bdd5-2600-4040-2dfe-3d00-4111-653e-a532-bce4.ngrok-free.app`
- **Baseten via proxy**: ✅ 200 OK, generates React components, Python scripts, bash scripts
- **Fireworks direct**: ✅ 200 OK (tested `gpt-oss-120b`)
- **Northflank proxy**: ❌ 503 (service down)

## Next Steps

1. **Connect to SurrealDB**: When SurrealDB is available, load rules into the database for runtime enforcement
2. **Add retry logic**: Implement exponential backoff for 408 timeouts
3. **Metrics**: Add OpenTelemetry instrumentation to track step timing and success rates
4. **Dashboard**: Use the existing dashboard to visualize workflow execution
5. **Automated testing**: Run `mastra:verify` in CI/CD pipeline before deployment
6. **Provider health monitoring**: Add periodic health checks for each provider and automatic failover
