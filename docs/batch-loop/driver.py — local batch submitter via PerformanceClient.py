"""
Local driver: submit large batches of SDLC jobs to the deployed
SdlcOrchestrator chain on Baseten, using the Baseten Performance Client so
we can push hundreds of concurrent POSTs against a single chain URL
without hitting the Python GIL.

Two batching layers are stacked here on purpose:
  * "megabatch": one HTTP request to the chain carries N jobs. The chain
    replica handles that whole megabatch inside one asyncio event loop and
    fans out to the OpenCodeWorker chainlet -- Baseten's router packs those
    fan-out RPCs onto the same worker replica up to its concurrency_target.
  * "parallel megabatches": we still send several megabatches at once via
    PerformanceClient.batch_post so multiple orchestrator replicas can run
    in parallel when you have thousands of jobs.

Env:
  BASETEN_API_KEY       required
  CHAIN_URL             https://chain-<id>.api.baseten.co/production/run_remote
"""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import uuid
from pathlib import Path
from typing import Iterable

from baseten_performance_client import PerformanceClient


# Tune to match the worker Chainlet's concurrency_target so we saturate a
# single replica before spilling to the next one. If worker concurrency_target=128,
# a good starting point is JOBS_PER_MEGABATCH=64 (~50% utilization).
JOBS_PER_MEGABATCH = int(os.environ.get("JOBS_PER_MEGABATCH", "64"))
MAX_PARALLEL_MEGABATCHES = int(os.environ.get("MAX_PARALLEL_MEGABATCHES", "8"))


def _chunk(items: list[dict], size: int) -> Iterable[list[dict]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def submit(jobs: list[dict]) -> list[dict]:
    """
    jobs: list of dicts matching the SdlcJob schema.
    returns: flat list of SdlcResult dicts.
    """
    chain_url = os.environ["CHAIN_URL"]
    api_key = os.environ["BASETEN_API_KEY"]

    # Split chain URL into base + path for PerformanceClient.
    # Example: https://chain-abc.api.baseten.co/production/run_remote
    #          base = https://chain-abc.api.baseten.co
    #          path = /production/run_remote
    proto, rest = chain_url.split("://", 1)
    host, _, path = rest.partition("/")
    base_url = f"{proto}://{host}"
    url_path = f"/{path}"

    client = PerformanceClient(base_url=base_url, api_key=api_key)

    megabatches = list(_chunk(jobs, JOBS_PER_MEGABATCH))
    payloads = [{"request": {"jobs": batch}} for batch in megabatches]

    print(
        f"[driver] {len(jobs)} jobs -> "
        f"{len(payloads)} megabatches of up to {JOBS_PER_MEGABATCH} "
        f"(max_concurrent={MAX_PARALLEL_MEGABATCHES})",
        file=sys.stderr,
    )

    response = client.batch_post(
        url_path=url_path,
        payloads=payloads,
        max_concurrent_requests=MAX_PARALLEL_MEGABATCHES,
        timeout_s=1800,     # SDLC loops can take a while
        hedge_delay=None,   # don't hedge duplicate work
    )

    results: list[dict] = []
    for r in response.data:
        results.extend(r["results"])
    return results


# ---------------------------------------------------------------------------

def _demo_jobs() -> list[dict]:
    """A handful of demo tasks to exercise the pipeline."""
    return [
        {
            "job_id": str(uuid.uuid4()),
            "repo_url": "https://github.com/pallets/flask-website",
            "task": "Add a /health endpoint that returns JSON {\"ok\": true}",
            "test_cmd": "pytest -q",
            "max_iterations": 3,
            "model": "zai-org/GLM-5",
        },
        {
            "job_id": str(uuid.uuid4()),
            "repo_url": "https://github.com/pallets/flask-website",
            "task": "Type-annotate the top-level app factory",
            "test_cmd": "pytest -q",
            "lint_cmd": "ruff check .",
            "max_iterations": 3,
            "model": "zai-org/GLM-5",
        },
    ]


if __name__ == "__main__":
    if len(sys.argv) > 1:
        jobs = json.loads(Path(sys.argv[1]).read_text())
    else:
        jobs = _demo_jobs()

    out = submit(jobs)
    print(json.dumps(out, indent=2))
