"""Live 10-sandbox / 10-PR batch for Midspiral + Quint formal validation."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import truss_chains as chains

from sdlc_batch.sdlc_chain import BatchRequest, SdlcOrchestrator
from sdlc_batch.spawner import MultiProviderSpawner
from sdlc_batch.tokens import (
    parse_owner_repo,
    preflight_repo_access,
    resolve_github_token,
)
from sdlc_batch.verify_prs import verify_prs
from sdlc_batch.github import GitHubPublisher


def load_env(path: str) -> None:
    """Load KEY=VALUE env file without bash-sourcing (avoids binary token breakage)."""
    if not Path(path).is_file():
        return
    for line in Path(path).read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and key not in os.environ and not value.startswith("fm2_"):
            os.environ[key] = value


async def main() -> None:
    root = Path(__file__).resolve().parent.parent
    load_env(str(root / ".env"))
    load_env(str(root.parent / ".env"))

    required = ["DAYTONA_API_KEY", "BASETEN_API_KEY"]
    missing = [v for v in required if not os.environ.get(v)]
    if missing:
        raise SystemExit(f"Missing env vars: {missing}")

    jobs_file = Path(
        os.environ.get(
            "SDLC_JOBS_FILE",
            str(Path(__file__).resolve().parent / "jobs-10-formal-midspiral-quint.json"),
        )
    )
    if not jobs_file.is_absolute():
        jobs_file = Path.cwd() / jobs_file
    jobs = json.loads(jobs_file.read_text())
    if not jobs:
        raise SystemExit(f"No jobs in {jobs_file}")
    print(f"Loaded {len(jobs)} jobs from {jobs_file}")

    owner_tokens: dict[str, str] = {}
    for job in jobs:
        repo_url = job.get("repo_url") or ""
        if not repo_url:
            continue
        owner, _repo = parse_owner_repo(repo_url)
        resolved = resolve_github_token(owner)
        owner_tokens[owner] = resolved.token
        print(f"Token for {owner}: source={resolved.source}")
        report = await preflight_repo_access(repo_url, token=resolved.token)
        print(
            f"Preflight OK {report['full_name']} "
            f"(private={report.get('private')}, token_source={report['token_source']})"
        )

    if not owner_tokens:
        raise SystemExit("No repo_url found in jobs; cannot resolve GitHub tokens")

    primary_owner = next(iter(owner_tokens))
    primary_token = owner_tokens[primary_owner]
    os.environ["GITHUB_TOKEN"] = primary_token
    os.environ["GIT_TOKEN"] = primary_token

    n = int(os.environ.get("SDLC_SANDBOX_COUNT", "10"))
    print(f"Spawning {n} Daytona sandboxes (1:1 with jobs)...")
    spawner = MultiProviderSpawner(providers=["daytona"], instances_per_provider=n)
    instances = await spawner.spawn()
    health = await spawner.health_check_all()

    urls: list[str] = []
    ids: list[str] = []
    for inst in instances:
        status = "healthy" if health.get(inst.id) else "unhealthy"
        print(f"[{inst.provider}] {inst.id} -> {inst.base_url} ({status})")
        if health.get(inst.id):
            urls.append(inst.base_url)
            ids.append(inst.id)

    if len(urls) < n:
        print(f"WARNING: only {len(urls)}/{n} sandboxes healthy")
    if not urls:
        await spawner.destroy_all()
        raise SystemExit("No healthy sandboxes; aborting")

    os.environ["OPENCODE_BASE_URLS"] = ",".join(urls)
    os.environ["OPENCODE_SANDBOX_IDS"] = ",".join(ids)

    results_path = Path(__file__).resolve().parent / "results-formal-midspiral-quint.json"
    try:
        print("Running formal Midspiral+Quint batch with chains.run_local...")
        with chains.run_local(
            secrets={
                "OPENCODE_BASE_URLS": os.environ["OPENCODE_BASE_URLS"],
                "OPENCODE_SANDBOX_IDS": os.environ["OPENCODE_SANDBOX_IDS"],
                "OPENCODE_BEARER": os.environ.get("OPENCODE_BEARER", ""),
                "BASETEN_API_KEY": os.environ["BASETEN_API_KEY"],
                "GITHUB_TOKEN": primary_token,
                "DAYTONA_API_KEY": os.environ.get("DAYTONA_API_KEY", ""),
                "DAYTONA_API_URL": os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api"),
            }
        ):
            orch = SdlcOrchestrator()
            resp = await orch.run_remote(BatchRequest(jobs=jobs))

        results = [r.model_dump() for r in resp.results]
        # Attach sandbox mapping (round-robin by job index as orchestrator assigns)
        for i, r in enumerate(results):
            if i < len(ids):
                r["sandbox_id"] = ids[i]
                r["sandbox_url"] = urls[i] if i < len(urls) else None
        job_repo = {j["job_id"]: j.get("repo_url") for j in jobs}
        for r in results:
            if not r.get("repo_url"):
                r["repo_url"] = job_repo.get(r.get("job_id"))

        results_path.write_text(json.dumps(results, indent=2))
        print(f"Results written to {results_path}")
        for r in results:
            print(
                f"  job={r.get('job_id')} ok={r.get('ok')} "
                f"validation_passed={r.get('validation_passed')} "
                f"sandbox={str(r.get('sandbox_id') or '')[:8]} "
                f"pr_url={r.get('pr_url')} pr_error={r.get('pr_error')}"
            )

        print("\nVerifying PRs...")
        repos = {r["repo_url"] for r in results if r.get("repo_url")}
        for repo_url in repos:
            owner, _ = parse_owner_repo(repo_url)
            publisher = GitHubPublisher(
                token=owner_tokens.get(owner) or resolve_github_token(owner).token
            )
            create_pr_ids = [
                j["job_id"]
                for j in jobs
                if j.get("repo_url") == repo_url and j.get("create_pr")
            ]
            if not create_pr_ids:
                continue
            prefix = next(
                (
                    j.get("pr_branch_prefix") or "formal-mq"
                    for j in jobs
                    if j.get("repo_url") == repo_url
                ),
                "formal-mq",
            )
            report = await verify_prs(
                repo_url,
                create_pr_ids,
                branch_prefix=prefix,
                state="open",
                publisher=publisher,
            )
            print(json.dumps(report, indent=2))

    finally:
        print("Destroying sandboxes...")
        await spawner.destroy_all()
        print("Sandbox destroy complete.")


if __name__ == "__main__":
    asyncio.run(main())
