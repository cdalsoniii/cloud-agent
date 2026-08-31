"""Live 10-sandbox / 10-PR batch for Midspiral + Quint formal validation."""

from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path

import truss_chains as chains

from sdlc_batch.github import GitHubPublisher
from sdlc_batch.model_smoke import run_model_smoke
from sdlc_batch.proxy_health import check_proxy_health, configure_baseten_proxy_env
from sdlc_batch.sdlc_chain import BatchRequest, SdlcOrchestrator
from sdlc_batch.spawner import MultiProviderSpawner
from sdlc_batch.tokens import (
    parse_owner_repo,
    preflight_repo_access,
    resolve_github_token,
)
from sdlc_batch.verify_prs import verify_prs


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

    job_filter = os.environ.get("SDLC_JOB_FILTER", "").strip()
    if job_filter:
        allow = {x.strip() for x in job_filter.split(",") if x.strip()}
        jobs = [j for j in jobs if j.get("job_id") in allow]
        if not jobs:
            raise SystemExit(f"SDLC_JOB_FILTER={job_filter!r} matched no jobs")
        print(f"SDLC_JOB_FILTER applied: {[j['job_id'] for j in jobs]}")

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
    # Force OAuth (or owner-resolved) token into ALL git-related env slots so
    # Daytona sandbox create + chain clone/push never inherit a failing .env ghp_.
    for key in ("GITHUB_TOKEN", "GIT_TOKEN", "DAYTONA_GITHUB_TOKEN", "GH_TOKEN"):
        os.environ[key] = primary_token
    print(
        f"Forced git env tokens for {primary_owner}: "
        f"prefix={primary_token[:4]}_… len={len(primary_token)}"
    )

    # Daytona sandboxes must use host baseten-proxy + ngrok (Baseten blocks sandbox IPs).
    require_proxy = os.environ.get("SDLC_REQUIRE_PROXY", "1").strip() not in (
        "0",
        "false",
        "no",
    )
    llm_base = configure_baseten_proxy_env(require_proxy=require_proxy)
    print(f"OpenCode LLM base={llm_base} proxy_required={require_proxy}")
    if os.environ.get("BASETEN_PROXY_BASE_URL"):
        await check_proxy_health()

    # Optional model override for jobs (OpenCode provider/model format).
    model_override = os.environ.get("SDLC_MODEL_OVERRIDE", "").strip()
    if model_override:
        for job in jobs:
            job["model"] = model_override
        print(f"SDLC_MODEL_OVERRIDE applied to all jobs: {model_override}")

    smoke_model = model_override or (jobs[0].get("model") if jobs else "baseten-proxy/qwen-coder")
    print(f"Running Daytona OpenCode model smoke (model={smoke_model})...")
    await run_model_smoke(model=smoke_model)

    # SDLC_WAVE_SIZE: process jobs in waves to stay under Daytona disk/API limits.
    # 0 or unset = single wave with SDLC_SANDBOX_COUNT sandboxes.
    wave_size = int(os.environ.get("SDLC_WAVE_SIZE", "0") or "0")
    default_n = int(os.environ.get("SDLC_SANDBOX_COUNT", "10"))
    results_stem = os.environ.get(
        "SDLC_RESULTS_FILE",
        f"results-{jobs_file.stem}.json",
    )
    results_path = Path(__file__).resolve().parent / Path(results_stem).name
    all_results: list[dict] = []

    job_waves: list[list] = []
    if wave_size > 0:
        for i in range(0, len(jobs), wave_size):
            job_waves.append(jobs[i : i + wave_size])
        print(f"Wave mode: {len(job_waves)} waves of up to {wave_size} jobs")
    else:
        job_waves = [jobs]

    for wave_idx, wave_jobs in enumerate(job_waves, start=1):
        n = min(default_n, len(wave_jobs))
        print(f"\n=== Wave {wave_idx}/{len(job_waves)}: spawning {n} Daytona sandboxes ===")
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

        try:
            print("Running formal Midspiral+Quint batch with chains.run_local...")
            with chains.run_local(
                secrets={
                    "OPENCODE_BASE_URLS": os.environ["OPENCODE_BASE_URLS"],
                    "OPENCODE_SANDBOX_IDS": os.environ["OPENCODE_SANDBOX_IDS"],
                    "OPENCODE_BEARER": os.environ.get("OPENCODE_BEARER", ""),
                    "BASETEN_API_KEY": os.environ["BASETEN_API_KEY"],
                    "GITHUB_TOKEN": primary_token,
                    "GIT_TOKEN": primary_token,
                    "GH_TOKEN": primary_token,
                    "DAYTONA_GITHUB_TOKEN": primary_token,
                    "DAYTONA_API_KEY": os.environ.get("DAYTONA_API_KEY", ""),
                    "DAYTONA_API_URL": os.environ.get(
                        "DAYTONA_API_URL", "https://app.daytona.io/api"
                    ),
                }
            ):
                orch = SdlcOrchestrator()
                resp = await orch.run_remote(BatchRequest(jobs=wave_jobs))

            results = [r.model_dump() for r in resp.results]
            for i, r in enumerate(results):
                if i < len(ids):
                    r["sandbox_id"] = ids[i]
                    r["sandbox_url"] = urls[i] if i < len(urls) else None
                    r["wave"] = wave_idx
            job_repo = {j["job_id"]: j.get("repo_url") for j in wave_jobs}
            for r in results:
                if not r.get("repo_url"):
                    r["repo_url"] = job_repo.get(r.get("job_id"))
            all_results.extend(results)
            for r in results:
                print(
                    f"  job={r.get('job_id')} ok={r.get('ok')} "
                    f"validation_passed={r.get('validation_passed')} "
                    f"sandbox={str(r.get('sandbox_id') or '')[:8]} "
                    f"pr_url={r.get('pr_url')} pr_error={r.get('pr_error')}"
                )
        finally:
            print(f"Destroying wave {wave_idx} sandboxes...")
            await spawner.destroy_all()

    results_path.write_text(json.dumps(all_results, indent=2))
    print(f"\nResults written to {results_path}")

    print("\nVerifying PRs...")
    repos = {r["repo_url"] for r in all_results if r.get("repo_url")}
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

    print("All waves complete.")


if __name__ == "__main__":
    asyncio.run(main())
