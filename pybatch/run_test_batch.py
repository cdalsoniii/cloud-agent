"""Run SDLC test job(s) locally with dual-account token resolution."""

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
    """Load a simple KEY=VALUE env file, skipping malformed lines.

    Never bash-source .env (Fly tokens etc. can break shells).
    """
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

    jobs_file = Path(os.environ.get("SDLC_JOBS_FILE", "jobs-1-test.json"))
    if not jobs_file.is_absolute():
        jobs_file = Path.cwd() / jobs_file
    jobs = json.loads(jobs_file.read_text())
    print(f"Loaded jobs from {jobs_file} ({len(jobs)} job(s))")

    # Per-owner preflight — fail fast before spawning sandboxes
    owner_tokens: dict[str, str] = {}
    for job in jobs:
        repo_url = job.get("repo_url") or ""
        if not repo_url:
            continue
        owner, repo = parse_owner_repo(repo_url)
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

    # Seed env with a primary token for chain secrets compatibility, but publish
    # path resolves per-job via resolve_github_token_for_repo (not this global alone).
    primary_owner = next(iter(owner_tokens))
    primary_token = owner_tokens[primary_owner]
    os.environ["GITHUB_TOKEN"] = primary_token
    os.environ["GIT_TOKEN"] = primary_token

    print("Spawning a single Daytona sandbox...")
    spawner = MultiProviderSpawner(providers=["daytona"], instances_per_provider=1)
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
    os.environ["OPENCODE_SANDBOX_IDS"] = ",".join(
        inst.id for inst in instances if health.get(inst.id)
    )

    try:
        print("Running SDLC jobs with chains.run_local...")
        with chains.run_local(
            secrets={
                "OPENCODE_BASE_URLS": os.environ["OPENCODE_BASE_URLS"],
                "OPENCODE_SANDBOX_IDS": os.environ["OPENCODE_SANDBOX_IDS"],
                "OPENCODE_BEARER": os.environ.get("OPENCODE_BEARER", ""),
                "BASETEN_API_KEY": os.environ["BASETEN_API_KEY"],
                "GITHUB_TOKEN": primary_token,
            }
        ):
            orch = SdlcOrchestrator()
            resp = await orch.run_remote(BatchRequest(jobs=jobs))

        results = [r.model_dump() for r in resp.results]
        Path("results-test.json").write_text(json.dumps(results, indent=2))
        print("Results written to results-test.json")
        for r in results:
            print(
                f"  job={r.get('job_id')} ok={r.get('ok')} "
                f"validation_passed={r.get('validation_passed')} "
                f"pr_url={r.get('pr_url')} pr_error={r.get('pr_error')}"
            )

        print("\nVerifying PRs...")
        repos = {r["repo_url"] for r in results if r.get("repo_url")}
        # Attach repo_url onto results from jobs if missing on result model
        job_repo = {j["job_id"]: j.get("repo_url") for j in jobs}
        for r in results:
            if not r.get("repo_url"):
                r["repo_url"] = job_repo.get(r.get("job_id"))
        repos = {r["repo_url"] for r in results if r.get("repo_url")}
        for repo_url in repos:
            owner, _ = parse_owner_repo(repo_url)
            publisher = GitHubPublisher(token=owner_tokens.get(owner) or resolve_github_token(owner).token)
            job_ids = [
                r["job_id"]
                for r in results
                if r.get("repo_url") == repo_url and job_repo.get(r["job_id"])
            ]
            # Prefer jobs that requested create_pr
            create_pr_ids = [
                j["job_id"]
                for j in jobs
                if j.get("repo_url") == repo_url and j.get("create_pr")
            ]
            ids = create_pr_ids or job_ids
            if not ids:
                continue
            prefix = next(
                (j.get("pr_branch_prefix") or "sdlc-test" for j in jobs if j.get("repo_url") == repo_url),
                "sdlc-test",
            )
            report = await verify_prs(
                repo_url, ids, branch_prefix=prefix, state="open", publisher=publisher
            )
            print(json.dumps(report, indent=2))

    finally:
        print("Destroying sandboxes...")
        await spawner.destroy_all()
        print("Sandbox destroy complete.")


if __name__ == "__main__":
    asyncio.run(main())
