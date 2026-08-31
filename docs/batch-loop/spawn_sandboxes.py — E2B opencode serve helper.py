"""
Optional helper: spin up N E2B sandboxes, start `opencode serve` in each,
and print a comma-separated list of public URLs suitable for the
OPENCODE_BASE_URLS secret on the deployed chain.

Run once before/alongside your chain. Sandboxes idle-pause automatically
(auto_pause=True) so cost stays bounded when the loop is quiet.

Env:
  E2B_API_KEY, ANTHROPIC_API_KEY (or whichever LLM key OpenCode should use;
  or point OPENCODE at Baseten via OPENAI_BASE_URL=https://inference.baseten.co/v1
  and OPENAI_API_KEY=$BASETEN_API_KEY inside the sandbox env).
"""

from __future__ import annotations

import os
import sys
import time

import requests
from e2b import Sandbox


def spawn(n: int) -> list[str]:
    urls: list[str] = []
    for i in range(n):
        sbx = Sandbox.create(
            "opencode",
            envs={
                # Route OpenCode's LLM calls to Baseten's OpenAI-compatible API.
                "OPENAI_BASE_URL": "https://inference.baseten.co/v1",
                "OPENAI_API_KEY": os.environ["BASETEN_API_KEY"],
                # Keep the sandbox reachable but not billed while idle.
            },
            auto_pause=True,
            timeout=60 * 60,
        )
        sbx.commands.run(
            "opencode serve --hostname 0.0.0.0 --port 4096",
            background=True,
        )
        host = sbx.get_host(4096)
        base = f"https://{host}"

        # Wait until the server is healthy.
        for _ in range(60):
            try:
                if requests.get(f"{base}/global/health", timeout=2).ok:
                    break
            except requests.RequestException:
                time.sleep(0.5)
        else:
            print(f"[warn] sandbox {i} did not become healthy", file=sys.stderr)

        urls.append(base)
        print(f"[ok] sandbox {i}: {base}", file=sys.stderr)
    return urls


if __name__ == "__main__":
    n = int(sys.argv[1]) if len(sys.argv) > 1 else 4
    urls = spawn(n)
    print(",".join(urls))
