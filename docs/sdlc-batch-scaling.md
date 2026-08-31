# SDLC Batch Scaling & Formal-Sync Improvements

Actionable guidance for increasing batch throughput and hardening the Baseten-managed SDLC loop (`pybatch` + Daytona + OpenCode JSON patches).

## Current loop

```
plan → deep_research → code (JSON patch) → formal_sync → test/lint
  → formal_suite / validation_cmd → PR → destroy sandbox
```

Job flags (defaults **on**):

| Field | Default | Effect |
|-------|---------|--------|
| `deep_research` | `true` | Extra plan-mode brief before coding |
| `sync_formal` | `true` | After each code patch, require formal updates under `config/verification/` when behavior changes |
| `default_formal_suite` | `"all"` | Used when `validation_cmd` / `formal_suite` unset and `sync_formal` is on |

Override per job: `"deep_research": false` / `"sync_formal": false`.

## How to increase batch size

### 1. Sandbox concurrency (Daytona disk is the limiter)

```bash
# Reap leftovers first (~300 GiB org quota)
cd pybatch && PYTHONPATH=src python3 reap_daytona.py

# Match sandboxes to jobs (1:1)
SDLC_SANDBOX_COUNT=10 SDLC_JOBS_FILE=jobs-....json PYTHONPATH=src python3 run_formal_batch.py
```

**Wave pattern** (recommended above ~8–10 concurrent):

```bash
# Process jobs in waves of 5 to stay under disk / API limits
SDLC_WAVE_SIZE=5 SDLC_SANDBOX_COUNT=5 ...
```

See `SDLC_WAVE_SIZE` in `run_formal_batch.py`.

### 2. Remote Chains vs `run_local`

| Mode | When |
|------|------|
| `chains.run_local` (current) | Dev / laptop orchestrator; sandboxes on Daytona |
| Deployed Chain (`CHAIN_URL` + `truss chains push`) | Production fan-out; component concurrency + autoscaling per [Baseten Chains](https://www.baseten.co/blog/baseten-chains-explained/) |

Keep **coding / JSON parse** local; keep **tests + formal verify** in sandboxes ([Daytona](https://www.daytona.io/), [E2B billing](https://e2b.dev/docs/billing)).

### 3. Cost / lifetime

- Destroy sandboxes in `finally` (already done).
- Prefer short-lived sandboxes; avoid leaving OpenCode serve idle.
- Cap `max_iterations` (default 4); fail closed on validation.

### 4. Idempotent PRs

Reuse stable `pr_branch_prefix` + `job_id` branch names so retries update the same PR instead of spawning duplicates.

## Deep research

In-loop: OpenCode plan-mode brief (constraints, risks, which formal files to touch).

Optional host pre-step (Cursor / OpenCode MCP):

```text
Call deep_research on the job task → attach brief into job.task or pr_body
```

## Formal validation always updated

1. **Prompt gate** — `sync_formal` forces a JSON patch that updates Quint/Alloy/Dafny when lifecycle/token/MCP/validation code changes.
2. **Command gate** — `formal_suite` / `./scripts/verify-local.sh` must pass before PR.
3. **CI** — `.github/workflows/formal-verification.yml` on `config/verification/**`.

Anti-pattern: code-only PRs that leave `config/verification/` stale (spec drift).

## Recommended job template

```json
{
  "job_id": "feature-x",
  "repo_url": "https://github.com/org/repo.git",
  "task": "...",
  "deep_research": true,
  "sync_formal": true,
  "default_formal_suite": "all",
  "validation": { "formal_suite": "quint" },
  "create_pr": true,
  "max_iterations": 4
}
```

## Research notes (2025–2026)

Synthesized via deep research (Perplexity): multi-agent plan→research→code→test→formal-verify→PR; sandbox concurrency budgets; Chains component concurrency; JSON-patch audits; formal sync with code; idempotent PR publish.

Key sources: [Baseten Chains](https://www.baseten.co/blog/baseten-chains-explained/), [Chains SDK](https://docs.baseten.co/reference/sdk/chains), [Daytona](https://www.daytona.io/), [E2B billing](https://e2b.dev/docs/billing), [GitLab CI stages](https://about.gitlab.com/topics/ci-cd/continuous-integration-best-practices/), [Create Pull Request action](https://github.com/marketplace/actions/create-pull-request).
