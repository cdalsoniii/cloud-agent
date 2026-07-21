"""Dual-account GitHub token resolution (SDK/API — no shell).

Owners:
  BrightforestX → prefer gh OAuth from ~/.config/gh/hosts.yml, else org PAT env
  cdalsoniii   → prefer personal / same OAuth if it covers both
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

BRIGHTFOREST_OWNERS = frozenset({"brightforestx", "brightforest"})
PERSONAL_OWNERS = frozenset({"cdalsoniii"})

BRIGHTFOREST_ENV_KEYS = (
    "GITHUB_TOKEN_BRIGHTFOREST_ORG_PX_CLOUD_AGENT",
    "GITHUB_TOKEN_BRIGHTFOREST",
    "GH_TOKEN_BRIGHTFOREST",
)
PERSONAL_ENV_KEYS = (
    "GITHUB_TOKEN_PERSONAL",
    "GIT_TOKEN_PERSONAL",
    "GITHUB_TOKEN",
    "GH_TOKEN",
    "GIT_TOKEN",
)


@dataclass(frozen=True)
class ResolvedToken:
    token: str
    source: str
    owner: str


def parse_owner_repo(repo_url: str) -> tuple[str, str]:
    cleaned = repo_url.removesuffix(".git").rstrip("/")
    parts = cleaned.split("/")
    if len(parts) < 2:
        raise ValueError(f"Invalid GitHub repo URL: {repo_url}")
    return parts[-2], parts[-1]


def read_gh_oauth_token(preferred_user: Optional[str] = None) -> str:
    """Read OAuth token from gh hosts.yml without invoking the gh CLI.

    Prefer ``preferred_user`` when present; otherwise the active ``user``.
    """
    hosts_path = Path.home() / ".config" / "gh" / "hosts.yml"
    if not hosts_path.is_file():
        return ""
    try:
        import yaml

        data = yaml.safe_load(hosts_path.read_text(encoding="utf-8")) or {}
        github_host = data.get("github.com") or {}
        users = github_host.get("users") or {}
        active = preferred_user or github_host.get("user") or ""
        if active and active in users:
            tok = (users[active] or {}).get("oauth_token") or ""
            if tok:
                return tok
        # Fall back to any stored user token
        for _user, udata in users.items():
            tok = (udata or {}).get("oauth_token") or ""
            if tok:
                return tok
        return github_host.get("oauth_token") or ""
    except Exception:
        return ""


def _first_env(*keys: str) -> tuple[str, str]:
    for key in keys:
        val = (os.environ.get(key) or "").strip()
        if val:
            return val, key
    return "", ""


def resolve_github_token(owner: str) -> ResolvedToken:
    """Resolve a GitHub token for the given repo owner (org or user).

    BrightforestX: gh OAuth hosts.yml first, then org PAT env vars.
    cdalsoniii / other: personal env tokens, then same OAuth.
    """
    owner_norm = (owner or "").strip()
    if not owner_norm:
        raise ValueError("owner is required")
    owner_l = owner_norm.lower()

    if owner_l in BRIGHTFOREST_OWNERS:
        oauth = read_gh_oauth_token(preferred_user="cdalsoniii")
        if oauth:
            return ResolvedToken(token=oauth, source="gh-oauth-hosts.yml", owner=owner_norm)
        tok, key = _first_env(*BRIGHTFOREST_ENV_KEYS)
        if tok:
            return ResolvedToken(token=tok, source=key, owner=owner_norm)
        # Last resort: generic tokens (may fail push for org)
        tok, key = _first_env(*PERSONAL_ENV_KEYS)
        if tok:
            return ResolvedToken(token=tok, source=f"{key}(fallback)", owner=owner_norm)
        raise RuntimeError(
            f"No GitHub token available for owner {owner_norm}. "
            "Set gh auth (hosts.yml) or GITHUB_TOKEN_BRIGHTFOREST_ORG_PX_CLOUD_AGENT."
        )

    # Personal / default path
    if owner_l in PERSONAL_OWNERS:
        tok, key = _first_env("GITHUB_TOKEN_PERSONAL", "GIT_TOKEN_PERSONAL")
        if tok:
            return ResolvedToken(token=tok, source=key, owner=owner_norm)
        oauth = read_gh_oauth_token(preferred_user="cdalsoniii")
        if oauth:
            return ResolvedToken(token=oauth, source="gh-oauth-hosts.yml", owner=owner_norm)
        tok, key = _first_env("GITHUB_TOKEN", "GH_TOKEN", "GIT_TOKEN")
        if tok:
            return ResolvedToken(token=tok, source=key, owner=owner_norm)
        raise RuntimeError(
            f"No GitHub token available for owner {owner_norm}. "
            "Set GITHUB_TOKEN_PERSONAL or authenticate with gh."
        )

    # Unknown owner: oauth then generic env
    oauth = read_gh_oauth_token()
    if oauth:
        return ResolvedToken(token=oauth, source="gh-oauth-hosts.yml", owner=owner_norm)
    tok, key = _first_env(*PERSONAL_ENV_KEYS, *BRIGHTFOREST_ENV_KEYS)
    if tok:
        return ResolvedToken(token=tok, source=key, owner=owner_norm)
    raise RuntimeError(f"No GitHub token available for owner {owner_norm}")


def resolve_github_token_for_repo(repo_url: str) -> ResolvedToken:
    owner, _repo = parse_owner_repo(repo_url)
    return resolve_github_token(owner)


async def preflight_repo_access(
    repo_url: str,
    token: Optional[str] = None,
    api_url: str = "https://api.github.com",
) -> dict:
    """Fail-fast GitHub REST check that the token can access the target repo.

    Raises RuntimeError on 401/403/404. Returns the repo JSON on success.
    """
    owner, repo = parse_owner_repo(repo_url)
    resolved = resolve_github_token(owner) if not token else ResolvedToken(token=token, source="explicit", owner=owner)
    url = f"{api_url.rstrip('/')}/repos/{owner}/{repo}"
    headers = {
        "Authorization": f"Bearer {resolved.token}",
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        r = await client.get(url, headers=headers)
    if r.status_code in (401, 403):
        raise RuntimeError(
            f"GitHub preflight failed for {owner}/{repo}: HTTP {r.status_code} "
            f"(token source={resolved.source}). Token cannot access this repo."
        )
    if r.status_code == 404:
        raise RuntimeError(
            f"GitHub preflight failed for {owner}/{repo}: HTTP 404 "
            f"(missing repo or no access; token source={resolved.source})."
        )
    if r.status_code >= 400:
        raise RuntimeError(
            f"GitHub preflight failed for {owner}/{repo}: HTTP {r.status_code}: {r.text[:200]}"
        )
    data = r.json()
    return {
        "ok": True,
        "owner": owner,
        "repo": repo,
        "full_name": data.get("full_name"),
        "private": data.get("private"),
        "permissions": data.get("permissions") or {},
        "token_source": resolved.source,
    }
