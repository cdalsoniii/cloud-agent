# Multi-Provider SDLC Batch Loop

A Python package that implements a **Baseten Chains**-based SDLC loop
(plan → code → test → validation → review → patch) across multiple sandbox
providers, with **Daytona** as the primary target and **E2B** and **Northflank**
as secondary options. It adds **formal validation** to the batch loop, using
the existing TypeScript validation framework and local business-rule heuristics.

## Structure

```
pybatch/
├── pyproject.toml
├── src/sdlc_batch/
│   ├── providers/
│   │   ├── base.py          # SandboxProvider interface
│   │   ├── daytona.py       # Daytona SDK provider
│   │   ├── e2b.py           # E2B sandbox provider
│   │   └── northflank.py    # Northflank subprocess skeleton
│   ├── spawner.py           # MultiProviderSpawner
│   ├── validation.py        # ValidationEngine
│   ├── github.py            # GitHub PR publisher (httpx REST)
│   ├── tokens.py            # Dual-account resolve_github_token + preflight
│   ├── verify_prs.py        # PR verification helper
│   ├── sdlc_chain.py        # Baseten Chains entrypoint + worker
│   └── driver.py            # Local batch submitter + sandbox spawner CLI
```

### Dual-account tokens

`resolve_github_token(owner)` (no shell):

| Owner | Preference |
|-------|------------|
| BrightforestX | `~/.config/gh/hosts.yml` OAuth → `GITHUB_TOKEN_BRIGHTFOREST_ORG_PX_CLOUD_AGENT` |
| cdalsoniii | personal env → same gh OAuth |

Per-job publish uses the owner-specific token. Load `.env` via Python (`run_test_batch.load_env`) — do not bash-source.

```bash
SDLC_JOBS_FILE=jobs-brightforest-e2e.json PYTHONPATH=src python3 run_test_batch.py
```

## Install

```bash
cd pybatch
python -m venv .venv
source .venv/bin/activate
pip install -e ".[perf,dev]"
```

## Required environment

```bash
export BASETEN_API_KEY=...
export CHAIN_URL="https://chain-<id>.api.baseten.co/production/run_remote"

# For Daytona
export DAYTONA_API_KEY=...
export DAYTONA_API_URL="https://app.daytona.io/api"  # optional

# For E2B
export E2B_API_KEY=...

# For Northflank (skeleton)
export NORTHFLANK_API_TOKEN=...

# For PR creation
export GITHUB_TOKEN=...
```

## 1. Spawn sandboxes (gather OPENCODE_BASE_URLS)

```bash
# Spawn one Daytona sandbox and one E2B sandbox
python -m sdlc_batch.driver spawn --providers daytona,e2b --instances 1
```

This prints a comma-separated list of OpenCode URLs. Paste that value into the
Baseten Chain secret `OPENCODE_BASE_URLS`.

## 2. Deploy the chain

```bash
cd pybatch
pip install -e ".[perf]"
export BASETEN_API_KEY=...
truss chains push src/sdlc_batch/sdlc_chain.py --watch
```

In the Baseten UI, add secrets:

- `OPENCODE_BASE_URLS` — comma-separated OpenCode `serve` URLs
- `OPENCODE_BEARER` — optional password if `opencode serve --password` is used
- `BASETEN_API_KEY` — auto-injected by Baseten, but confirm it is present
- `GITHUB_TOKEN` — required if jobs set `create_pr: true`

## 3. Submit jobs

```bash
export CHAIN_URL="https://chain-<id>.api.baseten.co/production/run_remote"
export BASETEN_API_KEY=...
python -m sdlc_batch.driver submit jobs.json
```

Example `jobs.json` with validation:

```json
[
  {
    "job_id": "PR-1234",
    "repo_url": "https://github.com/acme/service",
    "branch": "main",
    "task": "Add pagination to /users",
    "test_cmd": "pytest -q tests/",
    "lint_cmd": "ruff check .",
    "max_iterations": 5,
    "model": "zai-org/GLM-5",
    "validation": {
      "lint_cmd": "ruff check .",
      "validation_cmd": "pytest -q tests/integration",
      "rule_specs": ["endpoint must return application/json"],
      "rule_codes": ["return jsonify({'data': users})"]
    }
  }
]
```

## Validation integration

The SDLC loop now includes a **validation phase** after tests pass:

1. **Custom command validation** (`validation_cmd`) runs inside the sandbox (source of truth).
2. **Formal suite expansion** — if `validation_cmd` is unset, `formal_suite` / `formal_paths` expand into a command (Quint typecheck, Dafny verify, or `./scripts/verify-local.sh`).
3. **Lint** (`lint_cmd`) runs inside the sandbox.
4. **Business-rule heuristics** compare `rule_specs` to `rule_codes`.
5. **TypeScript validation runner** can be invoked if `run_typescript_validation: true`.

Repo-level formal specs live under [`config/verification/`](../config/verification/README.md). Local/CI:

```bash
npm run verify:all          # or ./scripts/verify-local.sh
npm run verify:quint
npm run verify:setup        # download Alloy/TLA jars, install Quint/Dafny
```

Example job using `formal_suite` (no explicit `validation_cmd`):

```json
{
  "job_id": "formal-lifecycle-001",
  "repo_url": "https://github.com/cdalsoniii/cloud-agent.git",
  "task": "Improve sandbox-lifecycle Quint edge case",
  "validation": {
    "formal_suite": "quint",
    "formal_paths": ["config/verification/quint/sandbox-lifecycle.qnt"],
    "max_validation_iterations": 4
  },
  "create_pr": true
}
```

Or call the verify script directly via `validation_cmd`:

```json
"validation": {
  "validation_cmd": "bash scripts/verify-local.sh --suite quint"
}
```

Validation results are returned in each `SdlcResult`:

```json
{
  "job_id": "PR-1234",
  "ok": true,
  "iterations": 2,
  "validation_passed": true,
  "validation": [
    {"engine": "lint", "passed": true, "message": "lint"},
    {"engine": "business-rule", "passed": true, "message": "keyword coverage 100%"}
  ]
}
```

## PR creation

Each job can optionally publish its changes as a GitHub pull request. Set
`create_pr: true` and add `pr_title` / `pr_body` (optional) in the job:

```json
{
  "job_id": "batch-10-pr-001",
  "repo_url": "https://github.com/owner/repo",
  "branch": "main",
  "task": "Add a README badge",
  "test_cmd": "echo 'no tests'",
  "create_pr": true,
  "pr_branch_prefix": "sdlc-batch",
  "pr_title": "docs: add README badge",
  "pr_body": "Automated change from SDLC batch."
}
```

The worker will ask the sandbox to create a branch, commit, and push, then open
the PR via the GitHub API. The returned `SdlcResult` includes `pr_url`,
`pr_number`, and `pr_branch`.

A ready-made 10-PR batch is provided in `jobs-10-prs.json`.

### Verify the created PRs

```bash
# Verify PRs from driver results file
python -m sdlc_batch.driver verify \
  --repo-url https://github.com/owner/repo \
  --results results.json \
  --branch-prefix sdlc-batch

# Or verify by explicit job IDs
python -m sdlc_batch.driver verify \
  --repo-url https://github.com/owner/repo \
  --job-ids batch-10-pr-001,batch-10-pr-002,...,batch-10-pr-010
```

## Batching strategy

Two layers of batching maximize throughput:

1. **Megabatch**: each HTTP request to the chain carries up to `JOBS_PER_MEGABATCH`
   jobs (default 64). The orchestrator replica fans them out with `asyncio.create_task`.
2. **Parallel megabatches**: the driver sends up to `MAX_PARALLEL_MEGABATCHES`
   megabatches concurrently via the Baseten Performance Client (or plain httpx
   as a fallback).

Set these via environment:

```bash
export JOBS_PER_MEGABATCH=64
export MAX_PARALLEL_MEGABATCHES=8
```

## Tuning on Baseten

On the `OpenCodeWorker` Chainlet:

- `concurrency_target`: 128
- `target_utilization`: 40–50%
- `min_replicas`: 1 (avoid cold starts during dev)

On the `SdlcOrchestrator` Chainlet:

- `concurrency_target`: 32–64

## Provider priority

The default priority order is `daytona` → `e2b` → `northflank`. Override it with:

```bash
python -m sdlc_batch.driver spawn --providers daytona,e2b --instances 2
```

## Tests

```bash
cd pybatch
python -m venv .venv
source .venv/bin/activate
pip install -e ".[perf,dev]"
pytest
```

## Async entrypoint

For very long SDLC runs, use the async Baseten entrypoint:

```
POST https://chain-<id>.api.baseten.co/production/async_run_remote
```

with a `webhook_endpoint` to receive the `BatchResponse` when the loop completes.


## Daytona quota reaper

Before large batches (10+ sandboxes), free disk quota with the SDK reaper:

```bash
# Dry-run
python reap_daytona.py --max-age-hours 2 --include-started-if-aged

# Apply deletes
python reap_daytona.py --max-age-hours 2 --include-started-if-aged --apply --max-remaining 20 --require-free-gib 1
```

Exit code `2` means remaining sandbox count still exceeds `--max-remaining` (quota risk).
