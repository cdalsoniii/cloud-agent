"""Verify that PRs created by the SDLC batch loop exist on GitHub."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

from sdlc_batch.github import GitHubPublisher


async def verify_prs(
    repo_url: str,
    expected_job_ids: list[str],
    branch_prefix: str = "sdlc-batch",
    state: str = "open",
    publisher: Optional[GitHubPublisher] = None,
) -> dict[str, Any]:
    """Check GitHub for expected PR branches and return verification report."""
    publisher = publisher or GitHubPublisher()
    prs = await publisher.list_pull_requests(repo_url, state=state)

    expected_branches = {
        publisher.sanitize_branch(branch_prefix, job_id) for job_id in expected_job_ids
    }
    found_branches = {pr.get("head", {}).get("ref") for pr in prs}

    matched = expected_branches & found_branches
    missing = expected_branches - found_branches
    unexpected = found_branches - expected_branches

    matched_prs = [
        {
            "number": pr.get("number"),
            "title": pr.get("title"),
            "url": pr.get("html_url"),
            "branch": pr.get("head", {}).get("ref"),
        }
        for pr in prs
        if pr.get("head", {}).get("ref") in matched
    ]

    return {
        "repo_url": repo_url,
        "state": state,
        "expected": len(expected_branches),
        "found": len(matched),
        "missing": sorted(missing),
        "unexpected_branches": sorted(unexpected),
        "matched_prs": matched_prs,
        "ok": len(missing) == 0,
    }


async def verify_from_results_file(
    results_path: str,
    repo_url: str,
    branch_prefix: str = "sdlc-batch",
) -> dict[str, Any]:
    """Verify PRs from a driver results JSON file."""
    results = json.loads(Path(results_path).read_text())
    job_ids = [r["job_id"] for r in results if r.get("create_pr") or r.get("pr_url")]
    if not job_ids:
        # Fall back to all job IDs if create_pr not present in result
        job_ids = [r["job_id"] for r in results]
    return await verify_prs(repo_url, job_ids, branch_prefix)
