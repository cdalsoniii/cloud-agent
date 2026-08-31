"""
Baseten Chains-based SDLC orchestrator for OpenCode sandbox servers.

Design goals
------------
1. Batch as many requests as possible into the SAME Chainlet replica so we
   amortize cold-starts and share connection pools to the OpenCode server(s).
2. Keep the SDLC loop (plan -> code -> test -> review -> patch) driven from
   one Chainlet so a single tenant's whole cycle stays on one replica when
   possible.
3. Deploy with `truss chains push sdlc_chain.py`.

Wiring
------
- Client (or another Chainlet) POSTs a batch of SDLC "jobs" to the entrypoint.
- The entrypoint (`SdlcOrchestrator`) fans jobs out to `OpenCodeWorker` as
  concurrent asyncio tasks. Because every worker call is `await`ed on the
  same event loop of the same replica, we hit the OpenCode HTTP server(s)
  concurrently through a shared httpx.AsyncClient (connection pooling +
  HTTP/2 keepalive - Baseten's recommended pattern).
- `OpenCodeWorker` is deployed as a separate Chainlet so it can autoscale
  independently of the orchestrator. Its `concurrency_target` should be set
  high (64-256) so many jobs coalesce onto one replica.
- LLM calls that OpenCode itself makes are pointed at Baseten's Model APIs
  via OPENAI_BASE_URL, so the whole thing is a self-contained Baseten stack.

Env / secrets required at deploy time:
  - BASETEN_API_KEY     (auto-injected on Baseten)
  - OPENCODE_BASE_URLS  (comma-separated list of sandboxed opencode
                         `serve` URLs, e.g. https://8xxx-e2b.dev,
                         https://sbx-2.daytona.io)
  - OPENCODE_BEARER     (optional; if `opencode serve --password` set)
"""

from __future__ import annotations

import asyncio
import os
import random
from typing import Any, Optional

import httpx
import pydantic
import truss_chains as chains


# ---------------------------------------------------------------------------
# Shared data types
# ---------------------------------------------------------------------------

class SdlcJob(pydantic.BaseModel):
    """One unit of SDLC work handed to a worker."""
    job_id: str
    repo_url: Optional[str] = None
    branch: str = "main"
    task: str  # the natural-language ask, e.g. "Add /health endpoint"
    max_iterations: int = 4
    test_cmd: str = "pytest -q"
    lint_cmd: Optional[str] = None
    # Which OpenCode model slug to use inside the sandbox (proxied to Baseten)
    model: str = "zai-org/GLM-5"


class SdlcResult(pydantic.BaseModel):
    job_id: str
    ok: bool
    iterations: int
    diff: str = ""
    test_output: str = ""
    session_id: Optional[str] = None
    error: Optional[str] = None


class BatchRequest(pydantic.BaseModel):
    jobs: list[SdlcJob]


class BatchResponse(pydantic.BaseModel):
    results: list[SdlcResult]


# ---------------------------------------------------------------------------
# Worker Chainlet: talks to one OpenCode sandbox server per job
# ---------------------------------------------------------------------------

class OpenCodeWorker(chains.ChainletBase):
    """
    Runs the plan -> code -> test -> review loop for ONE SdlcJob against an
    OpenCode HTTP server (`opencode serve`).

    Deploy tuning (set in the Baseten UI on this Chainlet):
      - concurrency_target: 128        # let many jobs share this replica
      - target_utilization: 40-50%     # headroom for bursty asyncio work
      - min_replicas:       1          # avoid cold starts during dev loops
      - max_replicas:       as needed
    """

    remote_config = chains.RemoteConfig(
        docker_image=chains.DockerImage(
            pip_requirements=[
                "httpx[http2]>=0.27",
                "pydantic>=2",
            ],
        ),
        compute=chains.Compute(cpu_count=2, memory="4Gi"),  # CPU only
        assets=chains.Assets(
            secret_keys=["OPENCODE_BASE_URLS", "OPENCODE_BEARER"],
        ),
    )

    def __init__(self, context: chains.DeploymentContext = chains.depends_context()):
        # Pool of sandbox URLs; we round-robin so a single replica can drive
        # multiple sandboxes in parallel.
        raw = context.secrets.get("OPENCODE_BASE_URLS", "")
        self._pool = [u.strip() for u in raw.split(",") if u.strip()]
        if not self._pool:
            raise RuntimeError("OPENCODE_BASE_URLS secret is empty")
        token = context.secrets.get("OPENCODE_BEARER", "")
        headers = {"Authorization": f"Bearer {token}"} if token else {}

        # One shared async client for the life of the replica.
        # This is the key perf lever: HTTP/2 + keepalive + generous pool.
        limits = httpx.Limits(
            max_connections=256,
            max_keepalive_connections=128,
            keepalive_expiry=60,
        )
        timeout = httpx.Timeout(connect=10.0, read=1200.0, write=30.0, pool=10.0)
        self._client = httpx.AsyncClient(
            headers=headers, limits=limits, timeout=timeout, http2=True
        )
        self._rr = 0
        self._rr_lock = asyncio.Lock()

    async def _next_base(self) -> str:
        async with self._rr_lock:
            base = self._pool[self._rr % len(self._pool)]
            self._rr += 1
            return base

    # ---- OpenCode HTTP wrappers -----------------------------------------

    async def _create_session(self, base: str) -> str:
        r = await self._client.post(f"{base}/session")
        r.raise_for_status()
        return r.json()["id"]

    async def _send(
        self, base: str, session: str, text: str, model: str, mode: str = "build"
    ) -> dict[str, Any]:
        payload = {
            "parts": [{"type": "text", "text": text}],
            "model": model,
            "mode": mode,
        }
        r = await self._client.post(
            f"{base}/session/{session}/message", json=payload
        )
        r.raise_for_status()
        return r.json()

    async def _shell(self, base: str, session: str, cmd: str) -> dict[str, Any]:
        # OpenCode exposes a shell tool via messages; asking the agent to run
        # `cmd` keeps everything inside the session's context/tool budget.
        return await self._send(
            base,
            session,
            f"Run this command exactly and return the raw output:\n\n```bash\n{cmd}\n```",
            model="zai-org/GLM-5",
            mode="build",
        )

    # ---- The SDLC loop --------------------------------------------------

    async def run_remote(self, job: SdlcJob) -> SdlcResult:
        base = await self._next_base()
        try:
            session = await self._create_session(base)

            # 1. Setup
            if job.repo_url:
                await self._shell(
                    base,
                    session,
                    f"git clone --depth 1 -b {job.branch} {job.repo_url} repo && cd repo",
                )

            # 2. Plan
            await self._send(
                base,
                session,
                f"You are implementing this task in the `repo` folder:\n\n{job.task}\n\n"
                "First produce a short plan (bullets only). Do not modify files yet.",
                model=job.model,
                mode="plan",
            )

            last_test_out = ""
            last_diff = ""
            for i in range(1, job.max_iterations + 1):
                # 3. Code
                await self._send(
                    base,
                    session,
                    f"Iteration {i}: implement the plan. Make the smallest change needed.",
                    model=job.model,
                    mode="build",
                )

                # 4. Test
                test_resp = await self._shell(
                    base, session, f"cd repo && {job.test_cmd}"
                )
                last_test_out = _extract_text(test_resp)
                passed = "failed" not in last_test_out.lower() and \
                         "error" not in last_test_out.lower()

                # 5. Lint (optional)
                if job.lint_cmd:
                    await self._shell(base, session, f"cd repo && {job.lint_cmd}")

                # 6. Diff
                diff_resp = await self._shell(base, session, "cd repo && git diff")
                last_diff = _extract_text(diff_resp)

                if passed:
                    return SdlcResult(
                        job_id=job.job_id,
                        ok=True,
                        iterations=i,
                        diff=last_diff,
                        test_output=last_test_out,
                        session_id=session,
                    )

                # 7. Review + patch prompt for next iteration
                await self._send(
                    base,
                    session,
                    "Tests failed. Read the failure output above, identify the "
                    "root cause, and prepare a minimal fix for the next iteration.",
                    model=job.model,
                    mode="plan",
                )

            return SdlcResult(
                job_id=job.job_id,
                ok=False,
                iterations=job.max_iterations,
                diff=last_diff,
                test_output=last_test_out,
                session_id=session,
                error="max_iterations reached without green tests",
            )

        except Exception as e:  # noqa: BLE001
            return SdlcResult(
                job_id=job.job_id, ok=False, iterations=0, error=repr(e)
            )


def _extract_text(msg: dict[str, Any]) -> str:
    """Pull the assistant text out of an OpenCode message response."""
    parts = msg.get("parts") or msg.get("message", {}).get("parts") or []
    return "\n".join(p.get("text", "") for p in parts if p.get("type") == "text")


# ---------------------------------------------------------------------------
# Entrypoint Chainlet: batches jobs and fans them out concurrently
# ---------------------------------------------------------------------------

@chains.mark_entrypoint
class SdlcOrchestrator(chains.ChainletBase):
    """
    Client-facing Chainlet. Accepts a batch of SdlcJob and fans them out to
    OpenCodeWorker as concurrent asyncio tasks. Because the worker is a
    remote Chainlet with high `concurrency_target`, Baseten's router will
    pack as many of these concurrent RPCs onto the same worker replica as
    the target allows -- which is exactly the batching behavior you want.

    Deploy tuning on this Chainlet:
      - concurrency_target: 32-64 (this one is cheap CPU orchestration)
    """

    remote_config = chains.RemoteConfig(
        docker_image=chains.DockerImage(pip_requirements=["pydantic>=2"]),
        compute=chains.Compute(cpu_count=1, memory="2Gi"),
    )

    def __init__(
        self,
        worker: OpenCodeWorker = chains.depends(OpenCodeWorker, retries=1),
    ):
        self._worker = worker

    async def run_remote(self, request: BatchRequest) -> BatchResponse:
        tasks = []
        for job in request.jobs:
            tasks.append(asyncio.create_task(self._worker.run_remote(job)))
            # Yield so the task is actually started before we queue the next.
            await asyncio.sleep(0)
        results = await asyncio.gather(*tasks, return_exceptions=False)
        return BatchResponse(results=list(results))


# ---------------------------------------------------------------------------
# Local debug entrypoint: `python sdlc_chain.py`
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    # Point at a locally running `opencode serve` for quick iteration.
    os.environ.setdefault("OPENCODE_BASE_URLS", "http://127.0.0.1:4096")

    async def _main() -> None:
        with chains.run_local(
            secrets={
                "OPENCODE_BASE_URLS": os.environ["OPENCODE_BASE_URLS"],
                "OPENCODE_BEARER": os.environ.get("OPENCODE_BEARER", ""),
            }
        ):
            orch = SdlcOrchestrator()
            resp = await orch.run_remote(
                BatchRequest(
                    jobs=[
                        SdlcJob(
                            job_id="demo-1",
                            task="Add a /health endpoint returning {'ok': true}",
                            test_cmd="pytest -q",
                        ),
                    ]
                )
            )
            for r in resp.results:
                print(r.model_dump_json(indent=2))

    asyncio.run(_main())
