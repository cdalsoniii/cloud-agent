"""Daytona sandbox provider for SDLC batching."""

from __future__ import annotations

import asyncio
import json
import os
from typing import Any, Optional

from daytona import DaytonaConfig, CreateSandboxFromSnapshotParams
from daytona._async.daytona import AsyncDaytona
from daytona._async.sandbox import AsyncSandbox

from sdlc_batch.providers.base import SandboxInstance, SandboxProvider


class DaytonaProvider(SandboxProvider):
    """Daytona sandbox provider.

    Creates Daytona sandboxes, starts an OpenCode server inside each, exposes it
    via signed Daytona preview URLs, and executes commands via the toolbox API.

    Env required:
      DAYTONA_API_KEY      required
      DAYTONA_API_URL      optional (defaults to https://app.daytona.io/api)
      BASETEN_API_KEY      optional (routes OpenCode LLM calls to Baseten)
    """

    name = "daytona"

    def __init__(
        self,
        snapshot: str = "daytona-large",
        opencode_port: int = 4096,
        preview_ttl_seconds: int = 7200,
        api_key: Optional[str] = None,
        api_url: Optional[str] = None,
        target: Optional[str] = None,
        domain_allow_list: Optional[str] = None,
    ):
        self.snapshot = snapshot
        self.opencode_port = opencode_port
        self.preview_ttl_seconds = preview_ttl_seconds
        self._api_key = api_key or os.environ.get("DAYTONA_API_KEY")
        self._api_url = api_url or os.environ.get("DAYTONA_API_URL")
        self._target = target or os.environ.get("DAYTONA_TARGET")
        self._domain_allow_list = domain_allow_list or os.environ.get("DOMAIN_ALLOW")
        self._sandboxes: dict[str, AsyncSandbox] = {}
        self._client: Optional[AsyncDaytona] = None

    async def _get_client(self) -> AsyncDaytona:
        if self._client is None:
            cfg = DaytonaConfig(
                api_key=self._api_key or "",
                api_url=self._api_url or "https://app.daytona.io/api",
                target=self._target,
            )
            self._client = AsyncDaytona(cfg)
        return self._client

    def _default_envs(self) -> dict[str, str]:
        """Environment variables passed into every Daytona sandbox."""
        base_url = os.environ.get(
            "BASETEN_PROXY_BASE_URL",
            os.environ.get("OPENAI_BASE_URL", "https://inference.baseten.co/v1"),
        )
        envs: dict[str, str] = {
            "OPENAI_BASE_URL": base_url,
            "OPENAI_API_KEY": os.environ.get("OPENAI_API_KEY", "sk-proxy"),
            "OPENCODE_SERVE_PORT": str(self.opencode_port),
            "OPENCODE_SERVE_HOSTNAME": "0.0.0.0",
            "HARNESS_SANDBOX": "1",
            "DAYTONA_SDK_READY": "1",
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

        daytona = await self._get_client()
        create_params = dict(
            language="python",
            snapshot=self.snapshot,
            env=merged_envs,
            auto_stop_interval=0,
            auto_pause=auto_pause,
            public=False,
        )
        if self._domain_allow_list:
            create_params["domain_allow_list"] = self._domain_allow_list
        params = CreateSandboxFromSnapshotParams(**create_params)
        sandbox = await daytona.create(params, timeout=timeout_seconds)
        self._sandboxes[sandbox.id] = sandbox

        # Start OpenCode server in the background.
        await self._start_opencode(sandbox)

        # Use a signed preview URL so the OpenCode server is reachable without
        # additional authentication tokens.
        signed = await sandbox.create_signed_preview_url(self.opencode_port, expires_in_seconds=self.preview_ttl_seconds)
        base_url = signed.url
        if not base_url.startswith("http"):
            base_url = f"https://{base_url}"

        healthy = await self._health_check_sandbox(sandbox)
        return SandboxInstance(
            id=sandbox.id,
            base_url=base_url,
            provider=self.name,
            metadata={
                "snapshot": self.snapshot,
                "opencode_port": self.opencode_port,
                "preview_token": signed.token,
            },
            is_healthy=healthy,
        )

    async def _write_opencode_config(self, sandbox: AsyncSandbox) -> None:
        """Write ~/.config/opencode/opencode.json so the server uses the proxy."""
        base_url = os.environ.get(
            "BASETEN_PROXY_BASE_URL",
            os.environ.get("OPENAI_BASE_URL", "https://inference.baseten.co/v1"),
        )
        api_key = os.environ.get("PROXY_API_KEY", "sk-proxy")
        config = {
            "$schema": "https://opencode.ai/config.json",
            "model": "baseten-proxy/qwen-coder",
            "provider": {
                "baseten-proxy": {
                    "npm": "@ai-sdk/openai-compatible",
                    "options": {
                        "baseURL": base_url,
                        "apiKey": api_key,
                    },
                    "models": {
                        "qwen-coder": {
                            "name": "Qwen-2.5-Coder-32B-Instruct",
                            "tool_call": True,
                        }
                    },
                }
            },
            "enabled_providers": ["baseten-proxy"],
        }
        json_str = json.dumps(config, indent=2)
        b64 = json_str.encode().hex()
        cmd = (
            f"mkdir -p /home/daytona/.config/opencode && "
            f"python3 -c 'import json; data=bytes.fromhex(\"{b64}\").decode(); "
            f"open(\"/home/daytona/.config/opencode/opencode.json\",\"w\").write(data)'"
        )
        await sandbox.process.exec(cmd)

    async def _start_opencode(self, sandbox: AsyncSandbox) -> None:
        """Start `opencode serve` as a background process in the sandbox."""
        await self._write_opencode_config(sandbox)
        cmd = (
            f"nohup opencode serve --hostname 0.0.0.0 --port {self.opencode_port} "
            f"> /tmp/opencode-serve.log 2>&1 &"
        )
        await sandbox.process.exec(cmd)
        # Give the server a moment to bind.
        await asyncio.sleep(2)

    async def _health_check_sandbox(self, sandbox: AsyncSandbox) -> bool:
        for _ in range(60):
            try:
                resp = await sandbox.process.exec(
                    f"curl -sf http://127.0.0.1:{self.opencode_port}/global/health || "
                    f"curl -sf http://127.0.0.1:{self.opencode_port}/health"
                )
                out = resp.result or ""
                if "ok" in out.lower() or resp.exit_code == 0:
                    return True
            except Exception:
                pass
            await asyncio.sleep(0.5)
        return False

    async def destroy_sandbox(self, instance: SandboxInstance) -> None:
        sandbox = self._sandboxes.pop(instance.id, None)
        if sandbox is None:
            return
        daytona = await self._get_client()
        await daytona.delete(sandbox)
        # Do not close() here — MultiProviderSpawner may destroy sandboxes in
        # parallel on a shared client; spawner.destroy_all() calls close() after.

    async def close(self) -> None:
        """Close the AsyncDaytona HTTP session(s). Idempotent."""
        client = self._client
        self._client = None
        if client is None:
            return
        try:
            await client.close()
        except Exception:
            pass

    async def health_check(self, instance: SandboxInstance) -> bool:
        sandbox = self._sandboxes.get(instance.id)
        if sandbox is None:
            return False
        try:
            await sandbox.refresh_data()
            return sandbox.state == "started"
        except Exception:
            return False

    async def exec_command(self, instance: SandboxInstance, command: str) -> dict[str, Any]:
        sandbox = self._sandboxes.get(instance.id)
        if sandbox is None:
            return {"ok": False, "error": "sandbox not found", "exit_code": 1, "stdout": "", "stderr": ""}
        try:
            resp = await sandbox.process.exec(command)
            return {
                "ok": resp.exit_code == 0,
                "exit_code": resp.exit_code,
                "stdout": resp.result,
                "stderr": "",
                "provider": self.name,
            }
        except Exception as e:
            return {"ok": False, "error": repr(e), "exit_code": 1, "stdout": "", "stderr": "", "provider": self.name}

    async def __aexit__(self, exc_type, exc, tb) -> None:
        for sandbox in list(self._sandboxes.values()):
            try:
                daytona = await self._get_client()
                await daytona.delete(sandbox)
            except Exception:
                pass
        self._sandboxes.clear()
        await self.close()
