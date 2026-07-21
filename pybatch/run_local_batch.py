"""Run the SDLC batch locally using spawned Daytona sandboxes and create real PRs."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import truss_chains as chains

from sdlc_batch.sdlc_chain import BatchRequest, SdlcOrchestrator
from sdlc_batch.spawner import MultiProviderSpawner
from sdlc_batch.verify_prs import verify_prs


def load_env(path: str) -> None:
    """Load a simple KEY=VALUE env file, skipping malformed lines."""
    if not Path(path).is_file():
        return
    for line in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        # Skip values that look like binary tokens.
        if key and value and key not in os.environ and not value.startswith("fm2_"):
            os.environ[key] = value


async def main() -> None:
    root = Path(__file__).resolve().parent.parent
    load_env(str(root / ".env"))
    load_env(str(root.parent / ".env"))

    required = ["DAYTONA_API_KEY", "BASETEN_API_KEY", "GITHUB_TOKEN"]
    missing = [v for v in required if not os.environ.get(v)]
    if missing:
        raise SystemExit(f"Missing env vars: {missing}")

    print("Spawning Daytona sandboxes...")
    spawner = MultiProviderSpawner(providers=["daytona"], instances_per_provider=2)
    instances = await spawner.spawn()
    health = await spawner.health_check_all()

    urls = []
    for inst in instances:
        status = "healthy" if health.get(inst.id) else "unhealthy"
        print(f"[{inst.provider}] {inst.id} -> {inst.base_url} ({status})")
        urls.append(inst.base_url)

    if not all(health.get(inst.id) for inst in instances):
        print("WARNING: not all sandboxes are healthy")

    os.environ["OPENCODE_BASE_URLS"] = ",".join(urls)

    try:
        print("Running batch locally with chains.run_local...")
        jobs = json.loads(Path("jobs-10-prs-dual.json").read_text())

        with chains.run_local(
            secrets={
                "OPENCODE_BASE_URLS": os.environ["OPENCODE_BASE_URLS"],
                "OPENCODE_BEARER": os.environ.get("OPENCODE_BEARER", ""),
                "BASETEN_API_KEY": os.environ["BASETEN_API_KEY"],
                "GITHUB_TOKEN": os.environ["GITHUB_TOKEN"],
            }
        ):
            orch = SdlcOrchestrator()
            resp = await orch.run_remote(BatchRequest(jobs=jobs))

        results = [r.model_dump() for r in resp.results]
        Path("results.json").write_text(json.dumps(results, indent=2))
        print(f"Results written to results.json")

        print("\nVerifying PRs...")
        repos = {r["repo_url"] for r in results if r.get("repo_url")}
        for repo_url in repos:
            job_ids = [r["job_id"] for r in results if r.get("repo_url") == repo_url and r.get("create_pr")]
            if not job_ids:
                continue
            report = await verify_prs(repo_url, job_ids, branch_prefix="sdlc-batch", state="open")
            print(json.dumps(report, indent=2))

    finally:
        print("Destroying sandboxes...")
        await spawner.destroy_all()


if __name__ == "__main__":
    asyncio.run(main())
