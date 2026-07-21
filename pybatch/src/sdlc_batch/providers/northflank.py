"""Northflank sandbox provider skeleton for SDLC batching."""

from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Optional

from sdlc_batch.providers.base import SandboxInstance, SandboxProvider


class NorthflankProvider(SandboxProvider):
    """Northflank sandbox provider (skeleton / subprocess wrapper).

    Delegates to the existing `scripts/northflank.ts` tooling in the
    gpu-inference-stack. This is a placeholder provider until a native
    Northflank API client is integrated.

    Env required:
      NORTHFLANK_API_TOKEN     required for TypeScript tooling
    """

    name = "northflank"

    def __init__(
        self,
        opencode_port: int = 4096,
        stack_dir: Optional[str] = None,
    ):
        self.opencode_port = opencode_port
        self.stack_dir = stack_dir or os.environ.get(
            "GPU_INFERENCE_STACK_DIR",
            str(Path(__file__).resolve().parents[5] / "gpu-inference-stack"),
        )
        self._instances: dict[str, SandboxInstance] = {}

    def _script_path(self) -> Path:
        return Path(self.stack_dir) / "scripts" / "sandbox" / "northflank.sh"

    def _run(self, *args: str, timeout: int = 300) -> dict[str, Any]:
        script = self._script_path()
        if not script.is_file():
            raise RuntimeError(f"Northflank script not found: {script}")
        if not shutil.which("node"):
            raise RuntimeError("Node.js is required for the Northflank provider")

        cmd = [str(script), *args]
        env = {**os.environ, "SANDBOX_PROVIDER": "northflank"}
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout,
            env=env,
            cwd=self.stack_dir,
        )
        output = result.stdout.strip()
        parsed: dict[str, Any] = {}
        for line in reversed(output.splitlines()):
            line = line.strip()
            if line.startswith("{"):
                try:
                    parsed = json.loads(line)
                    break
                except json.JSONDecodeError:
                    continue
        return {
            "ok": result.returncode == 0 and parsed.get("ok", True),
            "exit_code": result.returncode,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "parsed": parsed,
            "provider": self.name,
        }

    async def create_sandbox(
        self,
        image: str = "opencode",
        envs: Optional[dict[str, str]] = None,
        timeout_seconds: int = 3600,
        auto_pause: bool = True,
    ) -> SandboxInstance:
        # Northflank provider does not support per-sandbox envs through the
        # thin wrapper yet; envs are sourced from the host environment.
        def _create():
            return self._run("create", timeout=timeout_seconds)

        result = await asyncio.to_thread(_create)
        if not result["ok"]:
            raise RuntimeError(f"Northflank create failed: {result}")

        parsed = result["parsed"]
        sid = parsed.get("sandbox_id") or parsed.get("id") or "unknown"
        base_url = parsed.get("base_url") or parsed.get("url") or f"https://{sid}"
        if not base_url.startswith("http"):
            base_url = f"https://{base_url}"

        instance = SandboxInstance(
            id=sid,
            base_url=base_url,
            provider=self.name,
            metadata=result,
        )
        self._instances[sid] = instance
        return instance

    async def destroy_sandbox(self, instance: SandboxInstance) -> None:
        self._instances.pop(instance.id, None)
        await asyncio.to_thread(lambda: self._run("destroy", timeout=300))

    async def health_check(self, instance: SandboxInstance) -> bool:
        try:
            result = await asyncio.to_thread(lambda: self._run("connectivity", timeout=120))
            return result.get("ok", False)
        except Exception:
            return False

    async def exec_command(self, instance: SandboxInstance, command: str) -> dict[str, Any]:
        # The Northflank wrapper does not expose arbitrary shell; use exec with a
        # task containing the shell command.
        def _run():
            return self._run("exec", "--harness", "opencode", "--task", command, timeout=1800)

        return await asyncio.to_thread(_run)

    async def __aexit__(self, exc_type, exc, tb) -> None:
        for instance in list(self._instances.values()):
            try:
                await self.destroy_sandbox(instance)
            except Exception:
                pass
        self._instances.clear()
