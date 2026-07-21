# PR Sandbox Orchestrator

The PR Sandbox Orchestrator creates an isolated sandbox environment, merges provisional changes from Pull Requests, runs the full test suite, starts the application, and exposes it via a Cloudflare tunnel for external access.

## Overview

This tool automates the process of:
1. **Fetching PRs** - Retrieves open PRs from GitHub or uses specified PR numbers
2. **Creating a sandbox** - Spins up a Daytona or Northflank sandbox
3. **Cloning the repo** - Clones the target repository into the sandbox
4. **Merging PRs** - Fetches and merges the selected PRs into the base branch
5. **Installing dependencies** - Detects and uses the correct package manager
6. **Running tests** - Executes the full test suite (unit, integration, e2e, Playwright)
7. **Starting the app** - Detects and runs the start script
8. **Creating a tunnel** - Exposes the app via a Cloudflare tunnel
9. **Reporting results** - Saves execution results and reports the tunnel URL

## Prerequisites

### Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_TOKEN` | Yes* | GitHub personal access token for fetching PRs |
| `DAYTONA_API_KEY` | Yes | Daytona API key for sandbox creation |
| `CLOUDFLARE_API_TOKEN` | Yes** | Cloudflare API token for tunnel creation |
| `CLOUDFLARE_ACCOUNT_ID` | Yes** | Cloudflare account ID |
| `SANDBOX_PROVIDER` | No | Sandbox provider: `daytona` or `northflank` (default: `daytona`) |

*Required when using `--pr all` to fetch PRs from GitHub API. Not needed when specifying PR numbers directly with `--pr 123,456`.

**Required unless using `--skip-tunnel`.

### GitHub Token Permissions

Your GitHub token needs the following permissions:
- `repo` scope for private repositories
- `public_repo` scope for public repositories (minimum)

## Usage

### Basic Usage

```bash
# Merge all open PRs and create tunnel
npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr all

# Merge specific PRs
npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr 123,456

# Dry run (simulate without creating real resources)
npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr all --dry-run
```

### Using npm Script

```bash
npm run pr-sandbox -- --repo https://github.com/owner/repo --pr all
```

### Options

| Option | Default | Description |
|--------|---------|-------------|
| `--repo <url>` | - | Target repository URL (required) |
| `--pr <value>` | `all` | PR strategy: `all` or comma-separated numbers |
| `--provider <name>` | `daytona` | Sandbox provider: `daytona` or `northflank` |
| `--branch <name>` | `main` | Base branch to merge PRs into |
| `--dry-run` | false | Simulate execution without creating real resources |
| `--skip-tests` | false | Skip running tests |
| `--skip-tunnel` | false | Skip creating Cloudflare tunnel |
| `--keep-sandbox` | false | Don't destroy sandbox after execution |
| `--timeout <seconds>` | `3600` | Execution timeout |
| `--verbose` | false | Enable verbose logging |
| `--help` | - | Show help message |

## Workflow Steps

### 1. Environment Validation

Checks that all required environment variables are set:
- `DAYTONA_API_KEY` (for sandbox creation)
- `GIT_TOKEN` (for git operations)
- `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (for tunnel, unless skipped)

### 2. PR Fetching

**Option A: Fetch from GitHub API**
- Uses `--pr all` to query the GitHub API for open PRs
- Requires a valid `GITHUB_TOKEN`

**Option B: Specify PR numbers**
- Use `--pr 123,456` to specify exact PR numbers
- No GitHub API call needed
- Faster and works even with API rate limits

### 3. Sandbox Creation

Creates a sandbox using the configured provider:
- **Daytona**: Uses the Node `@daytona/sdk` (create / git.clone / process.executeCommand / delete). No `provider.sh` shell wrapper on the hot path.
- **Northflank**: Uses the Northflank provider

The sandbox ID is extracted from the creation output and stored for later use.

### 4. Repository Clone

Clones the target repository into `/tmp/repo` inside the sandbox:
```bash
git clone <repo-url> /tmp/repo
git config user.name "sandbox-agent"
git config user.email "sandbox-agent@users.noreply.github.com"
```

### 5. PR Merge

For each PR:
```bash
git fetch origin pull/<number>/head:pr-<number>
git checkout <branch>
git merge --no-ff pr-<number> -m "Merge PR #<number>: <title>"
```

### 6. Dependency Installation

Detects and uses the correct package manager:
```bash
npm install || pnpm install || yarn install
```

### 7. Test Execution

Reads `package.json` to detect test scripts and runs them in order:
1. `npm test` (if `scripts.test` exists)
2. `npm run test:unit` (if `scripts['test:unit']` exists)
3. `npm run test:integration` (if `scripts['test:integration']` exists)
4. `npm run test:e2e` (if `scripts['test:e2e']` exists)
5. `npx playwright test` (if Playwright is installed)

### 8. Application Start

Detects the start script from `package.json`:
1. `npm start` (if `scripts.start` exists)
2. `npm run dev` (if `scripts.dev` exists)
3. `npm run serve` (if `scripts.serve` exists)

Starts the app in the background and verifies it's running via health check.

### 9. Cloudflare Tunnel

Installs `cloudflared` if not present and creates a tunnel:
```bash
cloudflared tunnel --url http://localhost:<port>
```

Extracts the tunnel URL from the logs (format: `https://*.trycloudflare.com`).

### 10. Result Reporting

Saves results to `tmp/results/pr-sandbox-<id>.json`:
```json
{
  "id": "pr-sandbox-1784340461630-2m61jo",
  "ok": true,
  "repo": "https://github.com/owner/repo",
  "pr": "123,456",
  "provider": "daytona",
  "sandboxId": "abc123",
  "tunnelUrl": "https://abc123.trycloudflare.com",
  "steps": [
    { "ok": true, "step": "validate-environment" },
    { "ok": true, "step": "fetch-prs", "output": "Found 2 open PRs" },
    { "ok": true, "step": "create-sandbox", "output": "Sandbox created: abc123" },
    { "ok": true, "step": "clone-repo", "output": "Repository cloned successfully" },
    { "ok": true, "step": "merge-prs", "output": "Merged 2 PRs: #123, #456" },
    { "ok": true, "step": "install-dependencies", "output": "Dependencies installed successfully" },
    { "ok": true, "step": "run-tests", "output": "All tests passed successfully" },
    { "ok": true, "step": "start-application", "output": "Application started on port 3000" },
    { "ok": true, "step": "create-tunnel", "tunnelUrl": "https://abc123.trycloudflare.com" }
  ],
  "timestamp": "2026-07-18T02:07:41.631Z"
}
```

## Examples

### Example 1: Basic Usage

```bash
npx tsx src/pr-sandbox-orchestrator.ts \
  --repo https://github.com/my-org/my-app \
  --pr all
```

### Example 2: Specific PRs

```bash
npx tsx src/pr-sandbox-orchestrator.ts \
  --repo https://github.com/my-org/my-app \
  --pr 42,101,205
```

### Example 3: Dry Run

```bash
npx tsx src/pr-sandbox-orchestrator.ts \
  --repo https://github.com/my-org/my-app \
  --pr all \
  --dry-run \
  --verbose
```

### Example 4: Skip Tests, Keep Sandbox

```bash
npx tsx src/pr-sandbox-orchestrator.ts \
  --repo https://github.com/my-org/my-app \
  --pr 42 \
  --skip-tests \
  --keep-sandbox
```

### Example 5: Different Provider

```bash
npx tsx src/pr-sandbox-orchestrator.ts \
  --repo https://github.com/my-org/my-app \
  --pr all \
  --provider northflank
```

## Error Handling

### GitHub API Failures

If the GitHub API returns 401 (unauthorized) or 404 (not found), the orchestrator will:
1. Log a detailed error message
2. Suggest using `--pr <numbers>` instead of `--pr all`
3. Exit with error code 1

### Sandbox Creation Failures

If sandbox creation fails:
1. The error is logged with full details
2. The orchestrator exits without attempting further steps
3. No resources are left in an inconsistent state

### Test Failures

If tests fail:
1. The test output is captured in the results
2. The orchestrator stops at the test step
3. The sandbox is destroyed (unless `--keep-sandbox` is used)

### Tunnel Creation Failures

If the Cloudflare tunnel fails:
1. The error is logged
2. The orchestrator continues to report results
3. The tunnel URL will be undefined in the results

## Cleanup

By default, the sandbox is destroyed after execution. To keep it alive:
```bash
npx tsx src/pr-sandbox-orchestrator.ts --repo <url> --pr all --keep-sandbox
```

To manually destroy a kept sandbox:
```bash
npx tsx src/baseten-chain-sandbox.ts --sandbox-id <id> --operation destroy
```

## Integration with CI/CD

### GitHub Actions

```yaml
name: PR Sandbox Test
on:
  workflow_dispatch:
    inputs:
      repo:
        description: 'Repository URL'
        required: true
      pr:
        description: 'PR numbers (comma-separated) or "all"'
        default: 'all'

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Setup Node.js
        uses: actions/setup-node@v3
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm install
      - name: Run PR Sandbox
        env:
          DAYTONA_API_KEY: ${{ secrets.DAYTONA_API_KEY }}
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
        run: |
          npx tsx src/pr-sandbox-orchestrator.ts \
            --repo ${{ github.event.inputs.repo }} \
            --pr ${{ github.event.inputs.pr }} \
            --verbose
      - name: Upload results
        uses: actions/upload-artifact@v3
        with:
          name: pr-sandbox-results
          path: tmp/results/*.json
```

## Troubleshooting

### "GitHub API authentication failed"

**Cause**: Invalid or expired GitHub token
**Solution**: 
1. Generate a new token at https://github.com/settings/tokens
2. Ensure it has `repo` or `public_repo` scope
3. Set it as `GITHUB_TOKEN` environment variable

### "No sandbox in state"

**Cause**: Sandbox creation failed or state file was lost
**Solution**:
1. Check Daytona API key is valid
2. Check `SANDBOX_STATE_FILE` environment variable
3. Run with `--dry-run` to test the flow

### "Application failed to start"

**Cause**: No start script found or app crashed
**Solution**:
1. Ensure `package.json` has a `start`, `dev`, or `serve` script
2. Check app logs in the sandbox at `/tmp/app.log`
3. Use `--skip-tests` to focus on app startup

### "Failed to extract tunnel URL"

**Cause**: Cloudflared failed to start or URL format changed
**Solution**:
1. Check `/tmp/cloudflared.log` in the sandbox
2. Ensure `CLOUDFLARE_API_TOKEN` is valid
3. Use `--skip-tunnel` if tunnel is not needed

## Architecture

```
pr-sandbox-orchestrator.ts
├── PRSandboxOrchestrator
│   ├── execute()
│   │   ├── validateEnvironment()
│   │   ├── fetchPRs()
│   │   ├── createSandbox()
│   │   ├── cloneRepo()
│   │   ├── mergePRs()
│   │   ├── installDependencies()
│   │   ├── runTests()
│   │   ├── startApplication()
│   │   ├── createTunnel()
│   │   └── reportResults()
│   └── destroySandbox()
└── main()
```

## Related Tools

- `cloud-agent-handoff.ts` - General cloud agent handoff
- `baseten-chain-sandbox.ts` - Baseten chain sandbox communication
- `orchestrator.ts` - Main orchestrator with multiple modes
- `daytona-workflow.ts` - Daytona-specific workflow with formal verification

## License

Part of the cloud-agent-handoff project.