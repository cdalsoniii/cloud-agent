"""Baseten host-proxy health checks for Daytona OpenCode routing."""

from __future__ import annotations

import os
from typing import Optional
from urllib.parse import urlparse

import httpx


def normalize_proxy_base(url: str) -> str:
    """Ensure OpenAI-compatible base ends with /v1."""
    u = url.strip().rstrip("/")
    if not u:
        return u
    if u.endswith("/v1"):
        return u
    return f"{u}/v1"


def configure_baseten_proxy_env(
    *,
    require_proxy: bool = True,
) -> str:
    """Prefer BASETEN_PROXY_BASE_URL for Daytona; set OPENAI_BASE_URL accordingly.

    Daytona sandbox IPs are blocked by Baseten — route via host baseten-proxy.js + ngrok.
    Returns the OpenAI-compatible base URL used for OpenCode.
    """
    proxy = (os.environ.get("BASETEN_PROXY_BASE_URL") or "").strip()
    if proxy:
        base = normalize_proxy_base(proxy)
        os.environ["BASETEN_PROXY_BASE_URL"] = base
        os.environ["OPENAI_BASE_URL"] = base
        # Host proxy expects sk-proxy; it injects BASETEN_API_KEY upstream.
        # Do not put the real Baseten key here — Daytona embeds PROXY_API_KEY in opencode.json.
        os.environ["PROXY_API_KEY"] = os.environ.get("PROXY_API_KEY") or "sk-proxy"
        if os.environ["PROXY_API_KEY"] == os.environ.get("BASETEN_API_KEY"):
            os.environ["PROXY_API_KEY"] = "sk-proxy"
        return base

    if require_proxy:
        raise SystemExit(
            "BASETEN_PROXY_BASE_URL is required for Daytona SDLC batches. "
            "Start host proxy + ngrok (see pybatch/README.md), then export the https URL "
            "(with /v1). Direct inference.baseten.co from Daytona IPs is blocked."
        )

    baseten_base = os.environ.get(
        "BASETEN_MODEL_APIS_BASE", "https://inference.baseten.co/v1"
    )
    os.environ["BASETEN_MODEL_APIS_BASE"] = baseten_base
    os.environ["OPENAI_BASE_URL"] = baseten_base
    bt_key = os.environ.get("BASETEN_API_KEY", "")
    if bt_key:
        os.environ["PROXY_API_KEY"] = bt_key
        os.environ["OPENAI_API_KEY"] = bt_key
    return baseten_base


async def check_proxy_health(base_url: Optional[str] = None, timeout: float = 15.0) -> None:
    """Fail fast if the host proxy / ngrok tunnel is not reachable."""
    base = normalize_proxy_base(base_url or os.environ.get("BASETEN_PROXY_BASE_URL", ""))
    if not base:
        raise SystemExit("No BASETEN_PROXY_BASE_URL to health-check")

    parsed = urlparse(base)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise SystemExit(f"Invalid BASETEN_PROXY_BASE_URL: {base}")

    # Prefer /health (local, no upstream). Avoid bare GET / — it forwards to Baseten and can hang.
    root = base.rstrip("/").removesuffix("/v1")
    candidates = [
        f"{root}/health",
        f"{root}/v1/health",
    ]
    last_err: Exception | None = None
    async with httpx.AsyncClient(timeout=timeout, follow_redirects=True) as client:
        for url in candidates:
            try:
                r = await client.get(
                    url,
                    headers={
                        "Authorization": f"Bearer {os.environ.get('PROXY_API_KEY', 'sk-proxy')}",
                        "ngrok-skip-browser-warning": "1",
                    },
                )
                if r.status_code < 500:
                    print(f"Proxy health OK: {url} -> HTTP {r.status_code}")
                    return
                last_err = RuntimeError(f"HTTP {r.status_code} from {url}")
            except Exception as e:
                last_err = e
                continue

    raise SystemExit(
        f"BASETEN_PROXY_BASE_URL not reachable ({base}). "
        f"Start `node baseten-proxy.js` and ngrok, update the URL. Last error: {last_err}"
    )
