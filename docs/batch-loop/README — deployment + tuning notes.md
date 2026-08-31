# Baseten × OpenCode SDLC loop

> **Note:** This directory is the original reference implementation. The
> production-ready, multi-provider version lives in
> [`/pybatch`](/pybatch/README.md) and adds Daytona, E2B, Northflank support,
> plus formal validation inside the batch loop.

A Baseten [Chains](https://docs.baseten.co/development/chain/overview) app
that drives one or many sandboxed [OpenCode](https://opencode.ai) servers
through a **plan → code → test → review → patch** loop, batching aggressively
onto the same Chainlet replica.

## Files

| File | Purpose |
| --- | --- |
| `sdlc_chain.py` | The Chain: `SdlcOrchestrator` (entrypoint) + `OpenCodeWorker`. |
| `driver.py` | Local batch submitter using `baseten_performance_client`. |
| `spawn_sandboxes.py` | Optional E2B helper to boot N `opencode serve` boxes. |

## Why batching lands on the same chainlet

Two knobs, working together:

1. **Megabatch payload.** The entrypoint accepts `BatchRequest.jobs: list[SdlcJob]`.
   Every job in one HTTP request is fanned out with `asyncio.create_task` on the
   **same replica**, so the replica-local `httpx.AsyncClient` (with HTTP/2 keepalive)
   is reused for every OpenCode call. This is Baseten's own
   [recommended client pattern](https://docs.baseten.co/inference/http-client-configuration).
2. **`concurrency_target` on `OpenCodeWorker`.** In the Baseten UI, set the
   worker's `concurrency_target` high (start at 128) and `target_utilization`
   around 40–50%. Baseten's router will pack up to that many concurrent
   `run_remote` calls onto **one** worker replica before spinning a second one
   — see [Autoscaling](https://docs.baseten.co/deployment/autoscaling/overview#concurrency-target)
   and [Autoscaling Engines guidance](https://docs.baseten.co/engines/performance-concepts/autoscaling-engines).

If you want to force everything onto one replica for a bounded workload, set
`min_replicas = max_replicas = 1` on the worker and raise `concurrency_target`
until latency starts to climb.

## Deploy

```bash
pip install truss-chains baseten
export BASETEN_API_KEY=...
# Set the sandbox URLs the workers will talk to (comma-separated):
truss chains push sdlc_chain.py --watch
```

Add secrets in the Baseten UI (Chain → Settings → Secrets):

- `OPENCODE_BASE_URLS` — e.g. `https://sbx-a.e2b.dev,https://sbx-b.e2b.dev`
- `OPENCODE_BEARER` — only if you launched `opencode serve --password`

## Boot sandboxes (optional)

```bash
export BASETEN_API_KEY=...
export E2B_API_KEY=...
python spawn_sandboxes.py 8 | tee sandbox_urls.txt
# paste the CSV into the OPENCODE_BASE_URLS secret in the Baseten UI
```

Each sandbox has `OPENAI_BASE_URL=https://inference.baseten.co/v1` so
OpenCode's own model calls also flow through Baseten's OpenAI-compatible
Model APIs — one auth surface, one bill.

## Submit work

```bash
export CHAIN_URL="https://chain-<id>.api.baseten.co/production/run_remote"
export BASETEN_API_KEY=...
python driver.py jobs.json
```

`jobs.json` is a list of `SdlcJob` objects:

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
    "model": "zai-org/GLM-5"
  }
]
```

## Tuning quick-reference

| Symptom | Knob |
| --- | --- |
| Cold starts hurt latency | `min_replicas: 1` on both Chainlets |
| Batch stalls waiting on OpenCode | Add more URLs to `OPENCODE_BASE_URLS` |
| Worker replica CPU-bound | Lower `JOBS_PER_MEGABATCH`, raise `max_replicas` |
| Want more coalescing on one replica | Raise worker `concurrency_target`, lower `MAX_PARALLEL_MEGABATCHES` |
| Timeouts on long refactors | Raise `timeout_s` in `driver.py` and httpx `read` timeout in the worker |

## Async invocation

For very long SDLC runs, hit the async entrypoint instead:

```
POST https://chain-<id>.api.baseten.co/production/async_run_remote
```

and provide a `webhook_endpoint` — Baseten will POST the `BatchResponse` when
done. See [async inference](https://docs.baseten.co/inference/async).
