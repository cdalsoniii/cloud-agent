"""Local batch driver for the multi-provider SDLC chain."""

from __future__ import annotations

import asyncio
import json
import math
import os
import sys
import uuid
from pathlib import Path
from typing import Iterable

try:
    from baseten_performance_client import PerformanceClient
except ImportError:
    PerformanceClient = None  # type: ignore

import httpx

from sdlc_batch.spawner import MultiProviderSpawner
from sdlc_batch.validation import ValidationEngine
from sdlc_batch.verify_prs import verify_prs, verify_from_results_file


JOBS_PER_MEGABATCH = int(os.environ.get("JOBS_PER_MEGABATCH", "64"))
MAX_PARALLEL_MEGABATCHES = int(os.environ.get("MAX_PARALLEL_MEGABATCHES", "8"))


def _chunk(items: list[dict], size: int) -> Iterable[list[dict]]:
    for i in range(0, len(items), size):
        yield items[i : i + size]


def _split_url(chain_url: str) -> tuple[str, str]:
    proto, rest = chain_url.split("://", 1)
    host, _, path = rest.partition("/")
    return f"{proto}://{host}", f"/{path}"


def submit_with_performance_client(jobs: list[dict]) -> list[dict]:
    """Submit megabatches using the Baseten Performance Client."""
    if PerformanceClient is None:
        raise ImportError(
            "baseten_performance_client is not installed. "
            "Install with: pip install 'baseten-performance-client'"
        )

    chain_url = os.environ["CHAIN_URL"]
    api_key = os.environ["BASETEN_API_KEY"]
    base_url, url_path = _split_url(chain_url)
    client = PerformanceClient(base_url=base_url, api_key=api_key)

    megabatches = list(_chunk(jobs, JOBS_PER_MEGABATCH))
    payloads = [{"request": {"jobs": batch}} for batch in megabatches]

    print(
        f"[driver] {len(jobs)} jobs -> {len(payloads)} megabatches "
        f"of up to {JOBS_PER_MEGABATCH} (max_concurrent={MAX_PARALLEL_MEGABATCHES})",
        file=sys.stderr,
    )

    response = client.batch_post(
        url_path=url_path,
        payloads=payloads,
        max_concurrent_requests=MAX_PARALLEL_MEGABATCHES,
        timeout_s=1800,
        hedge_delay=None,
    )

    results: list[dict] = []
    for r in response.data:
        results.extend(r["results"])
    return results


def submit_with_httpx(jobs: list[dict]) -> list[dict]:
    """Fallback submitter using plain httpx (no Performance Client)."""
    chain_url = os.environ["CHAIN_URL"]
    api_key = os.environ["BASETEN_API_KEY"]

    megabatches = list(_chunk(jobs, JOBS_PER_MEGABATCH))

    print(
        f"[driver] {len(jobs)} jobs -> {len(megabatches)} megabatches "
        f"of up to {JOBS_PER_MEGABATCH} (httpx fallback, max_concurrent={MAX_PARALLEL_MEGABATCHES})",
        file=sys.stderr,
    )

    async def _post(batch: list[dict]) -> list[dict]:
        async with httpx.AsyncClient(timeout=httpx.Timeout(1800.0)) as client:
            r = await client.post(
                chain_url,
                json={"jobs": batch},
                headers={"Authorization": f"Api-Key {api_key}"},
            )
            r.raise_for_status()
            return r.json()["results"]

    async def _run() -> list[dict]:
        semaphore = asyncio.Semaphore(MAX_PARALLEL_MEGABATCHES)

        async def _bounded(batch: list[dict]) -> list[dict]:
            async with semaphore:
                return await _post(batch)

        results = await asyncio.gather(*[_bounded(batch) for batch in megabatches])
        return [item for sublist in results for item in sublist]

    return asyncio.run(_run())


def submit(jobs: list[dict]) -> list[dict]:
    """Submit jobs to the chain, preferring Performance Client if available."""
    if PerformanceClient is not None:
        try:
            return submit_with_performance_client(jobs)
        except Exception as e:
            print(f"[driver] PerformanceClient failed: {e}; falling back to httpx", file=sys.stderr)
    return submit_with_httpx(jobs)


def spawn_sandboxes(
    providers: list[str],
    instances_per_provider: int,
) -> list[str]:
    """Spawn sandboxes and print the comma-separated URL list.

    This is a convenience helper that can be used before deployment to gather
    OPENCODE_BASE_URLS values.
    """

    async def _spawn() -> list[str]:
        spawner = MultiProviderSpawner(
            providers=providers,
            instances_per_provider=instances_per_provider,
        )
        instances = await spawner.spawn()
        health = await spawner.health_check_all()
        urls = []
        for inst in instances:
            status = "healthy" if health.get(inst.id) else "unhealthy"
            print(f"[{inst.provider}] {inst.id} -> {inst.base_url} ({status})", file=sys.stderr)
            urls.append(inst.base_url)
        return urls

    return asyncio.run(_spawn())


# ---------------------------------------------------------------------------


def _demo_jobs() -> list[dict]:
    return [
        {
            "job_id": str(uuid.uuid4()),
            "repo_url": "https://github.com/pallets/flask-website",
            "task": "Add a /health endpoint that returns JSON {'ok': true}",
            "test_cmd": "pytest -q",
            "max_iterations": 3,
            "model": "zai-org/GLM-5",
            "validation": {
                "rule_specs": ["endpoint must return application/json"],
                "rule_codes": ["def health(): return jsonify({'ok': True})"],
            },
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
    import argparse

    parser = argparse.ArgumentParser(description="SDLC batch driver")
    subparsers = parser.add_subparsers(dest="command", required=True)

    submit_parser = subparsers.add_parser("submit", help="submit jobs to the chain")
    submit_parser.add_argument("jobs_json", nargs="?", help="JSON file with jobs list")
    submit_parser.add_argument(
        "--output", "-o", default="-", help="output file (default: stdout)"
    )

    spawn_parser = subparsers.add_parser("spawn", help="spawn sandboxes and print URLs")
    spawn_parser.add_argument(
        "--providers", default="daytona", help="comma-separated provider list (default: daytona)"
    )
    spawn_parser.add_argument(
        "--instances", type=int, default=1, help="instances per provider (default: 1)"
    )

    verify_parser = subparsers.add_parser("verify", help="verify PRs created by a batch run")
    verify_parser.add_argument("--repo-url", required=True, help="GitHub repository URL")
    verify_parser.add_argument(
        "--results", help="path to driver results JSON file (optional)"
    )
    verify_parser.add_argument(
        "--job-ids", help="comma-separated job IDs to verify (optional)"
    )
    verify_parser.add_argument(
        "--branch-prefix", default="sdlc-batch", help="PR branch prefix"
    )
    verify_parser.add_argument(
        "--state", default="open", help="PR state to check (open, closed, all)"
    )

    args = parser.parse_args()

    if args.command == "spawn":
        providers = [p.strip() for p in args.providers.split(",") if p.strip()]
        urls = spawn_sandboxes(providers, args.instances)
        print(",".join(urls))
        sys.exit(0)

    if args.command == "verify":
        async def _verify() -> dict:
            if args.results:
                return await verify_from_results_file(args.results, args.repo_url, args.branch_prefix)
            if args.job_ids:
                job_ids = [j.strip() for j in args.job_ids.split(",") if j.strip()]
                return await verify_prs(args.repo_url, job_ids, args.branch_prefix, args.state)
            raise SystemExit("verify requires --results or --job-ids")

        report = asyncio.run(_verify())
        print(json.dumps(report, indent=2))
        sys.exit(0 if report["ok"] else 1)

    if args.jobs_json:
        jobs = json.loads(Path(args.jobs_json).read_text())
    else:
        jobs = _demo_jobs()

    out = submit(jobs)
    output = json.dumps(out, indent=2)
    if args.output == "-":
        print(output)
    else:
        Path(args.output).write_text(output)
