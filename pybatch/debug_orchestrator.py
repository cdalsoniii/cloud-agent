"""Debug the SdlcOrchestrator session creation."""

import asyncio
import json
import os
from pathlib import Path
from unittest.mock import MagicMock

import httpx

from sdlc_batch.sdlc_chain import SdlcOrchestrator, SdlcJob, BatchRequest, ValidationConfig
from sdlc_batch.providers.daytona import DaytonaProvider


def load_env(path: str) -> None:
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


async def main():
    root = Path(__file__).resolve().parent.parent
    load_env(str(root / ".env"))
    load_env(str(root.parent / ".env"))

    print("Creating sandbox...")
    provider = DaytonaProvider()
    inst = await provider.create_sandbox()
    print(f"Sandbox: {inst.id} -> {inst.base_url}")

    try:
        class FakeSecrets(dict):
            def get(self, key, default=None):
                return super().get(key, default)

        class FakeContext:
            def __init__(self):
                self.secrets = FakeSecrets({
                    "OPENCODE_BASE_URLS": inst.base_url,
                    "OPENCODE_BEARER": "",
                    "BASETEN_API_KEY": os.environ.get("BASETEN_API_KEY", ""),
                    "GITHUB_TOKEN": os.environ.get("GITHUB_TOKEN", ""),
                })

        orch = SdlcOrchestrator(context=FakeContext())
        job = SdlcJob(
            job_id="debug-1",
            repo_url="https://github.com/cdalsoniii/cloud-agent.git",
            branch="main",
            task="Add a top-level README badge for CI status",
            test_cmd="echo 'no tests'",
            max_iterations=1,
            model="baseten-proxy/qwen-coder",
            create_pr=True,
            pr_branch_prefix="sdlc-debug",
        )
        result = await orch.run_remote(job)
        print(result.model_dump_json(indent=2))
    finally:
        print("Destroying sandbox...")
        await provider.destroy_sandbox(inst)


if __name__ == "__main__":
    asyncio.run(main())
