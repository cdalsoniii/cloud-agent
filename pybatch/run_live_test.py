"""Helper to load .env and run the live SDLC batch test."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

from sdlc_batch.spawner import MultiProviderSpawner
from sdlc_batch.driver import submit


def load_env(path: str) -> None:
    """Load a simple KEY=VALUE env file, skipping malformed lines."""
    if not Path(path).is_file():
        return
    for line in Path(path).read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    load_env(str(root / ".env"))
    load_env(str(root.parent / ".env"))

    required = ["DAYTONA_API_KEY", "BASETEN_API_KEY", "GITHUB_TOKEN", "CHAIN_URL"]
    missing = [v for v in required if not os.environ.get(v)]
    if missing:
        raise SystemExit(f"Missing env vars: {missing}")

    print("Spawning Daytona sandboxes...")
    urls = asyncio.run(_spawn())
    print(f"Sandbox URLs: {urls}")

    print("Submitting batch...")
    jobs = json.loads(Path("jobs-10-prs-dual.json").read_text())
    results = submit(jobs)
    Path("results.json").write_text(json.dumps(results, indent=2))
    print(f"Results written to results.json")

    print("Verifying PRs...")
    asyncio.run(_verify(results))


async def _spawn() -> list[str]:
    spawner = MultiProviderSpawner(providers=["daytona"], instances_per_provider=2)
    instances = await spawner.spawn()
    health = await spawner.health_check_all()
    urls = []
    for inst in instances:
        status = "healthy" if health.get(inst.id) else "unhealthy"
        print(f"[{inst.provider}] {inst.id} -> {inst.base_url} ({status})")
        urls.append(inst.base_url)
    await spawner.destroy_all()
    return urls


async def _verify(results: list[dict]) -> None:
    from sdlc_batch.verify_prs import verify_prs

    repos = {r["repo_url"] for r in results if r.get("repo_url")}
    for repo_url in repos:
        job_ids = [r["job_id"] for r in results if r.get("repo_url") == repo_url and r.get("create_pr")]
        if not job_ids:
            continue
        report = await verify_prs(repo_url, job_ids, branch_prefix="sdlc-batch", state="open")
        print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
