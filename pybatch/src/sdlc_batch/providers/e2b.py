"""E2B sandbox provider for SDLC batching."""

from __future__ import annotations

import asyncio
import os
from typing import Any, Optional

from e2b import Sandbox as E2BSandbox

from sdlc_batch.providers.base import SandboxInstance, SandboxProvider


class E2BProvider(SandboxProvider):
    """E2B sandbox provider.

    Creates E2B sandboxes, starts an OpenCode server in each, and exposes it
    via E2B's public host helper.

    Env required:
      E2B_API_KEY            required
      BASETEN_API_KEY        optional (routes OpenCode LLM calls to Baseten)
    """

    name = "e2b"

    def __init__(
        self,
        template: str = "opencode",
        opencode_port: int = 4096,
        api_key: Optional[str] = None,
        timeout: int = 3600,
    ):
        self.template = template
        self.opencode_port = opencode_port
        self._api_key = api_key or os.environ.get("E2B_API_KEY")
        self._timeout = timeout
        self._sandboxes: dict[str, E2BSandbox] = {}

    def _default_envs(self) -> dict[str, str]:
        envs: dict[str, str] = {
            "OPENAI_BASE_URL": os.environ.get(
                "OPENAI_BASE_URL", "https://inference.baseten.co/v1"
            ),
            "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", os.environ.get("BASETEN_API_KEY", "")),
            "OPENCODE_SERVE_PORT": str(self.opencode_port),
            "OPENCODE_SERVE_HOSTNAME": "0.0.0.0",
        }
        git_token = os.environ.get("GIT_TOKEN") or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
        if git_token:
            envs["GIT_TOKEN"] = git_token
        if os.environ.get("GIT_REPO_URL"):
            envs["GIT_REPO_URL"] = os.environ["GIT_REPO_URL"]
        return envs

    async def create_sandbox(
        self,
        image: str = "opencode",
        envs: Optional[dict[str, str]] = None,
        timeout_seconds: int = 3600,
        auto_pause: bool = True,
    ) -> SandboxInstance:
        merged_envs = self._default_envs()
        if envs:
            merged_envs.update(envs)

        # E2B SDK is synchronous, run in a thread.
        def _create() -> E2BSandbox:
            return E2BSandbox.create(
                self.template,
                envs=merged_envs,
                timeout=self._timeout,
                auto_pause=auto_pause,
            )

        sandbox = await asyncio.to_thread(_create)
        self._sandboxes[sandbox.id] = sandbox

        # Start OpenCode server in the background.
        def _start():
            sandbox.commands.run(
                f"opencode serve --hostname 0.0.0.0 --port {self.opencode_port}",
                background=True,
            )
            return sandbox.get_host(self.opencode_port)

        base_url = await asyncio.to_thread(_start)
        base_url = f"https://{base_url}"

        healthy = await self._health_check(base_url)
        return SandboxInstance(
            id=sandbox.id,
            base_url=base_url,
            provider=self.name,
            metadata={"template": self.template, "opencode_port": self.opencode_port},
            is_healthy=healthy,
        )

    async def _health_check(self, base_url: str) -> bool:
        import urllib.request

        for _ in range(60):
            try:
                req = urllib.request.Request(
                    f"{base_url}/global/health", method="GET"
                )
                with urllib.request.urlopen(req, timeout=2) as resp:
                    if resp.status < 300:
                        return True
            except Exception:
                pass
            await asyncio.sleep(0.5)
        return False

    async def destroy_sandbox(self, instance: SandboxInstance) -> None:
        sandbox = self._sandboxes.pop(instance.id, None)
        if sandbox is None:
            return
        await asyncio.to_thread(sandbox.close)

    async def health_check(self, instance: SandboxInstance) -> bool:
        # E2B sandboxes report healthy via the SDK while connected.
        sandbox = self._sandboxes.get(instance.id)
        if sandbox is None:
            return False
        return not sandbox.is_closed

    async def exec_command(self, instance: SandboxInstance, command: str) -> dict[str, Any]:
        sandbox = self._sandboxes.get(instance.id)
        if sandbox is None:
            return {"ok": False, "error": "sandbox not found", "exit_code": 1, "stdout": "", "stderr": ""}

        def _run():
            return sandbox.commands.run(command, timeout=1800)

        try:
            result = await asyncio.to_thread(_run)
            return {
                "ok": result.exit_code == 0,
                "exit_code": result.exit_code,
                "stdout": result.stdout,
                "stderr": result.stderr,
                "provider": self.name,
            }
        except Exception as e:
            return {"ok": False, "error": repr(e), "exit_code": 1, "stdout": "", "stderr": "", "provider": self.name}

    async def __aexit__(self, exc_type, exc, tb) -> None:
        for sandbox in list(self._sandboxes.values()):
            try:
                await asyncio.to_thread(sandbox.close)
            except Exception:
                pass
        self._sandboxes.clear()
