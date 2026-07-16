# Cloud Agent Handoff - Usage Guide

## Quick Start

### 1. Verify Installation

```bash
cd /Users/clifforddalsoniii/Documents/Personal/employment/partners/experiments/cloud-agent

# Check everything is set up
npm run health

# Run tests to verify
DRY_RUN=1 npm test
```

### 2. Set Up Environment

Create a `.env` file (or use existing from parent directory):

```bash
# Copy from parent project
source ../gpu-inference-stack/.env

# Or set minimal required variables
export BASETEN_API_KEY=your_baseten_key
export DAYTONA_API_KEY=your_daytona_key
export GIT_TOKEN=your_github_token
```

### 3. Run Your First Handoff

```bash
# Dry-run (simulated, no real sandbox created)
DRY_RUN=1 npx tsx src/orchestrator.ts \
  --mode waterfall \
  --task "Add a hello world endpoint" \
  --target my-project

# Live execution (creates real sandbox)
npx tsx src/orchestrator.ts \
  --mode waterfall \
  --task "Implement user authentication" \
  --target assistant-ui
```

## Common Use Cases

### Use Case 1: Implement a New Feature

**Goal**: Add a new feature to your project with tests and documentation.

```bash
npx tsx src/cloud-agent-handoff.ts \
  --task "Add user profile management API with CRUD endpoints, validation, and tests" \
  --target backend-api \
  --priority high \
  --chain-specialty prd-daytona-execute
```

**What happens**:
1. Chain generates a detailed implementation plan
2. Daytona sandbox is created and bootstrapped
3. OpenCode server starts in sandbox
4. Agent implements the feature, adds tests, runs validation
5. Results committed to feature branch

### Use Case 2: Fix a Bug

**Goal**: Fix a critical bug with regression tests.

```bash
npx tsx src/cloud-agent-handoff.ts \
  --task "Fix race condition in user registration that causes duplicate entries" \
  --target backend-api \
  --priority critical \
  --branch-prefix "fix/registration-race"
```

**What happens**:
1. Plan includes bug analysis and reproduction steps
2. Sandbox creates isolated environment with failing test
3. Agent implements fix and adds regression test
4. Validates fix doesn't break existing functionality

### Use Case 3: Refactor Code

**Goal**: Refactor legacy code with confidence.

```bash
npx tsx src/cloud-agent-handoff.ts \
  --task "Refactor authentication middleware to use async/await instead of callbacks" \
  --target backend-api \
  --priority normal
```

**What happens**:
1. Plan identifies all files using callbacks
2. Sandbox runs full test suite before changes
3. Agent performs refactoring
4. Tests re-run to verify no regressions

### Use Case 4: Generate Documentation

**Goal**: Document a complex system or API.

```bash
npx tsx src/cloud-agent-handoff.ts \
  --task "Document the payment processing flow with sequence diagrams and API examples" \
  --target backend-api \
  --priority normal
```

**What happens**:
1. Plan analyzes codebase for payment logic
2. Agent creates comprehensive documentation
3. Includes code examples, diagrams, and edge cases

### Use Case 5: Add Tests

**Goal**: Increase test coverage for critical paths.

```bash
npx tsx src/cloud-agent-handoff.ts \
  --task "Add comprehensive tests for the checkout flow including edge cases and error handling" \
  --target e2e-tests \
  --priority high
```

## Working with Existing Sandboxes

### Monitor a Running Sandbox

```bash
# Start monitoring
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation monitor

# Check status
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation query

# Get logs
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation logs \
  --payload '{"lines": 100}'
```

### Pause and Resume

```bash
# Pause to save costs
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation pause

# Resume later
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id abc123 \
  --operation resume
```

## Workflow Patterns

### Pattern 1: Plan First, Execute Later

Useful for reviewing the plan before committing resources:

```bash
# Step 1: Generate plan
npx tsx src/cloud-agent-handoff.ts \
  --task "Implement OAuth2 authentication" \
  --target backend-api \
  --plan-only

# Review plan at tmp/plans/handoff-*.md

# Step 2: Execute saved plan
npx tsx src/cloud-agent-handoff.ts \
  --execute-only \
  --plan-file tmp/plans/handoff-xxx-plan.md
```

### Pattern 2: Multi-Stage Implementation

Break large tasks into smaller segments:

```bash
# Segment 1: Database schema
npx tsx src/cloud-agent-handoff.ts \
  --task "Create database schema and migration for user profiles" \
  --target backend-api \
  --branch-prefix "feat/user-profiles"

# Segment 2: API endpoints (after segment 1)
npx tsx src/cloud-agent-handoff.ts \
  --task "Add REST API endpoints for user profile CRUD operations" \
  --target backend-api \
  --branch-prefix "feat/user-profiles"

# Segment 3: Frontend integration
npx tsx src/cloud-agent-handoff.ts \
  --task "Add frontend UI components for user profile management" \
  --target frontend-app \
  --branch-prefix "feat/user-profiles"
```

### Pattern 3: Continuous Integration

Integrate with CI/CD pipeline:

```yaml
# .github/workflows/cloud-agent.yml
name: Cloud Agent Handoff
on:
  workflow_dispatch:
    inputs:
      task:
        description: 'Task description'
        required: true
      target:
        description: 'Target repository'
        required: true

jobs:
  handoff:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run Cloud Agent
        env:
          BASETEN_API_KEY: ${{ secrets.BASETEN_API_KEY }}
          DAYTONA_API_KEY: ${{ secrets.DAYTONA_API_KEY }}
          GIT_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          npx tsx src/orchestrator.ts \
            --mode waterfall \
            --task "${{ github.event.inputs.task }}" \
            --target "${{ github.event.inputs.target }}"
```

### Pattern 4: Batch Processing

Process multiple tasks in parallel:

```bash
#!/bin/bash
# tasks.sh

TASKS=(
  "Add input validation to all API endpoints"
  "Implement rate limiting middleware"
  "Add request logging and monitoring"
  "Create admin dashboard for user management"
)

for task in "${TASKS[@]}"; do
  npx tsx src/cloud-agent-handoff.ts \
    --task "$task" \
    --target backend-api \
    --priority normal &
done

wait
echo "All tasks submitted"
```

## Troubleshooting

### Issue: Chain timeout

```bash
# Increase timeout
npx tsx src/orchestrator.ts \
  --task "Complex task" \
  --target my-project \
  --timeout 120000

# Or use sync mode (faster, no chain)
SMART_ROUTER_MODE=sync npx tsx src/orchestrator.ts \
  --task "Simple task" \
  --target my-project
```

### Issue: Sandbox creation fails

```bash
# Check health
npx tsx src/health-check.ts --verbose

# Verify API keys
echo $DAYTONA_API_KEY | head -c 10

# Try with dry-run to test plan generation
DRY_RUN=1 npx tsx src/cloud-agent-handoff.ts \
  --task "Test task" \
  --target my-project
```

### Issue: Tests fail in sandbox

```bash
# Check sandbox logs
npx tsx src/baseten-chain-sandbox.ts \
  --sandbox-id <id> \
  --operation logs \
  --payload '{"lines": 200}'

# Verify test command in plan
# Plans should include: npm test, pytest, etc.
```

### Issue: Git push fails

```bash
# Verify token
export GIT_TOKEN=ghp_xxx

# Check permissions
# Token needs: repo, write:packages

# Manual push
# If automatic push fails, you'll have the branch locally
# Check tmp/results/handoff-*.json for branch name
```

## Best Practices

### 1. Task Descriptions

**Good**:
```bash
--task "Add pagination to the /users API endpoint with cursor-based pagination, support for page size limits, and comprehensive tests"
```

**Bad**:
```bash
--task "Fix users"
```

### 2. Priority Selection

| Priority | Use Case | Timeout |
|----------|----------|---------|
| `critical` | Production bugs, security fixes | 30 min |
| `high` | Feature deadlines, performance issues | 20 min |
| `normal` | Standard features, refactors | 15 min |
| `low` | Documentation, cleanup | 10 min |

### 3. Branch Naming

```bash
# Features
--branch-prefix "feat/user-profiles"

# Bug fixes
--branch-prefix "fix/registration-race"

# Documentation
--branch-prefix "docs/api-reference"

# Refactoring
--branch-prefix "refactor/auth-middleware"
```

### 4. Cost Optimization

```bash
# Use pause/resume for long tasks
npx tsx src/baseten-chain-sandbox.ts --sandbox-id abc123 --operation pause

# Destroy after completion (default)
# Or keep for debugging
npx tsx src/cloud-agent-handoff.ts \
  --task "Task" \
  --target my-project \
  --keep-sandbox
```

### 5. Review Before Merge

```bash
# Plan-only mode for review
npx tsx src/cloud-agent-handoff.ts \
  --task "Implement complex feature" \
  --target my-project \
  --plan-only

# Review tmp/plans/handoff-*.md
# Then execute if approved
```

## Advanced Usage

### Custom Chain Specialty

```bash
# Use a specific chain specialty for specialized tasks
npx tsx src/cloud-agent-handoff.ts \
  --task "Perform deep research on GraphQL vs REST for our API" \
  --target backend-api \
  --chain-specialty deep-research-brief
```

### Custom Sandbox Configuration

```bash
# Extend timeout for complex tasks
CHAIN_DAYTONA_TIMEOUT_SEC=3600 \
  npx tsx src/cloud-agent-handoff.ts \
  --task "Migrate database schema with data migration" \
  --target backend-api

# Use specific provider
SANDBOX_PROVIDER=northflank \
  npx tsx src/cloud-agent-handoff.ts \
  --task "Deploy to production" \
  --target infrastructure
```

### Programmatic Integration

```typescript
import { CloudAgentOrchestrator } from './src/orchestrator.js';

const orchestrator = new CloudAgentOrchestrator(config);

// Execute multiple tasks
const tasks = [
  'Add user authentication',
  'Add user profiles',
  'Add admin dashboard',
];

for (const task of tasks) {
  const result = await orchestrator.waterfall({
    id: `handoff-${Date.now()}`,
    task,
    target: 'my-app',
    priority: 'normal',
  });

  if (!result.ok) {
    console.error('Failed:', task, result.error);
  } else {
    console.log('Success:', task, result.branch);
  }
}
```

## Tips and Tricks

1. **Start with dry-run**: Always test with `DRY_RUN=1` first to verify your setup
2. **Check plans**: Review generated plans in `tmp/plans/` before execution
3. **Monitor costs**: Sandboxes run per minute; pause when not needed
4. **Use verbose**: Add `--verbose` for debugging issues
5. **Save results**: Check `tmp/results/` for execution details and branch names

## Example Output

### Successful Execution

```json
{
  "ok": true,
  "id": "handoff-1784232575835-kx0skno2o",
  "sandboxProvider": "daytona",
  "chainExecutionId": "dry-run-1784232575835",
  "planFiles": [
    "/tmp/plans/handoff-1784232575835-plan.md"
  ],
  "executeResults": [
    {
      "segment": "01",
      "status": "ok",
      "details": "Executed in sandbox abc123"
    }
  ],
  "timestamp": "2026-07-16T20:13:45.380Z"
}
```

### Failed Execution

```json
{
  "ok": false,
  "id": "handoff-1784232575835-kx0skno2o",
  "error": "Sandbox creation failed: API rate limit exceeded",
  "sandboxProvider": "daytona",
  "planFiles": [
    "/tmp/plans/handoff-1784232575835-plan.md"
  ],
  "executeResults": [
    {
      "segment": "01",
      "status": "error",
      "details": "Sandbox creation failed: API rate limit exceeded"
    }
  ],
  "timestamp": "2026-07-16T20:13:45.380Z"
}
```

## Next Steps

1. **Explore API**: See [API.md](API.md) for complete API reference
2. **Architecture**: See [ARCHITECTURE.md](ARCHITECTURE.md) for system design
3. **Examples**: Check `tmp/plans/` for example generated plans
4. **Integration**: Add to your CI/CD pipeline for automated task execution

## Support

- **Health check**: `npm run health -- --verbose`
- **Test suite**: `DRY_RUN=1 npm test`
- **Plan review**: Check `tmp/plans/handoff-*.md` files
- **Logs**: Check `tmp/results/handoff-*.json` files
