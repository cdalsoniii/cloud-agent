"""GitHub PR creation helper for the SDLC batch loop (httpx REST — no shell)."""

from __future__ import annotations

import os
import re
from typing import Any, Optional

import httpx

from sdlc_batch.tokens import (
    parse_owner_repo,
    preflight_repo_access,
    resolve_github_token,
    resolve_github_token_for_repo,
)


def _parse_repo(repo_url: str) -> tuple[str, str]:
    """Extract (owner, repo) from a GitHub URL."""
    return parse_owner_repo(repo_url)


class GitHubPublisher:
    """Creates pull requests on GitHub using the REST API."""

    def __init__(self, token: Optional[str] = None, api_url: str = "https://api.github.com"):
        self.token = token or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
        self.api_url = api_url.rstrip("/")

    @classmethod
    def for_repo(cls, repo_url: str, api_url: str = "https://api.github.com") -> "GitHubPublisher":
        """Build a publisher with a token resolved for the repo's owner."""
        resolved = resolve_github_token_for_repo(repo_url)
        return cls(token=resolved.token, api_url=api_url)

    @classmethod
    def for_owner(cls, owner: str, api_url: str = "https://api.github.com") -> "GitHubPublisher":
        resolved = resolve_github_token(owner)
        return cls(token=resolved.token, api_url=api_url)

    def _ensure_token(self) -> None:
        if not self.token:
            raise RuntimeError("GITHUB_TOKEN or GH_TOKEN environment variable is required")

    def _headers(self) -> dict[str, str]:
        self._ensure_token()
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def check_repo_access(self, repo_url: str) -> dict[str, Any]:
        """Preflight: verify this publisher's token can access the repo."""
        return await preflight_repo_access(repo_url, token=self.token, api_url=self.api_url)

    async def create_pull_request(
        self,
        repo_url: str,
        title: str,
        head: str,
        base: str,
        body: str = "",
    ) -> dict[str, Any]:
        owner, repo = _parse_repo(repo_url)
        url = f"{self.api_url}/repos/{owner}/{repo}/pulls"
        async with httpx.AsyncClient() as client:
            r = await client.post(
                url,
                headers=self._headers(),
                json={"title": title, "head": head, "base": base, "body": body},
            )
            # If PR already exists for this head, treat as success
            if r.status_code == 422:
                existing = await self.list_pull_requests(repo_url, state="open", head=f"{owner}:{head}")
                if existing:
                    pr = existing[0]
                    return {
                        "ok": True,
                        "pr_number": pr.get("number"),
                        "pr_url": pr.get("html_url"),
                        "branch": head,
                        "title": pr.get("title") or title,
                        "existing": True,
                    }
            r.raise_for_status()
            data = r.json()
            return {
                "ok": True,
                "pr_number": data.get("number"),
                "pr_url": data.get("html_url"),
                "branch": head,
                "title": title,
            }

    async def list_pull_requests(
        self,
        repo_url: str,
        state: str = "open",
        head: Optional[str] = None,
    ) -> list[dict[str, Any]]:
        owner, repo = _parse_repo(repo_url)
        params: dict[str, str] = {"state": state}
        if head:
            params["head"] = head
        url = f"{self.api_url}/repos/{owner}/{repo}/pulls"
        async with httpx.AsyncClient() as client:
            r = await client.get(url, headers=self._headers(), params=params)
            r.raise_for_status()
            return r.json()

    def sanitize_branch(self, prefix: str, job_id: str) -> str:
        """Create a git-branch-safe name."""
        safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", job_id).strip("-")
        return f"{prefix}/{safe}"[:100]
