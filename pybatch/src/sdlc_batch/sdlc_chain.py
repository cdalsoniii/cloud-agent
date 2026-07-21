"""Self-contained Baseten Chain for SDLC batching with formal validation + PR creation.

This file is intentionally self-contained so it can be deployed with
`truss chains push sdlc_chain.py` without requiring the local `sdlc_batch` package.
"""

import asyncio
import json
import os
import re
import subprocess
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import httpx
import pydantic
import truss_chains as chains

# Daytona SDK is only needed when OPENCODE_SANDBOX_IDS is provided for direct execution.
try:
    from daytona import DaytonaConfig
    from daytona._async.daytona import AsyncDaytona
except Exception:  # pragma: no cover - optional runtime dependency
    DaytonaConfig = None
    AsyncDaytona = None

# Dual-account token resolver (prefer package; inline fallback for truss deploy).
try:
    from sdlc_batch.tokens import (
        parse_owner_repo as _parse_owner_repo,
        resolve_github_token as _resolve_github_token,
        resolve_github_token_for_repo as _resolve_github_token_for_repo,
    )
except Exception:  # pragma: no cover
    _parse_owner_repo = None
    _resolve_github_token = None
    _resolve_github_token_for_repo = None


# ---------------------------------------------------------------------------
# Validation helpers (inlined for deployment)
# ---------------------------------------------------------------------------

@dataclass
class ValidationResult:
    passed: bool
    engine: str
    rule_id: Optional[str] = None
    message: str = ""
    details: Dict[str, Any] = field(default_factory=dict)
    stdout: str = ""
    stderr: str = ""


class ValidationEngine:
    """Runs validation steps inside the SDLC loop."""

    def __init__(self, repo_dir: str = "repo"):
        self.repo_dir = repo_dir

    def run_local_rules(
        self,
        rule_specs: List[str],
        rule_codes: List[str],
    ) -> List[ValidationResult]:
        if len(rule_specs) != len(rule_codes):
            raise ValueError("rule_specs and rule_codes must have the same length")

        results: List[ValidationResult] = []
        for spec, code in zip(rule_specs, rule_codes):
            spec_lower = spec.lower()
            code_lower = code.lower()
            keywords = [
                w
                for w in spec_lower.split()
                if len(w) > 3 and w not in {"must", "should", "will", "when", "then", "and", "the", "this"}
            ]
            matched = [k for k in keywords if k in code_lower]
            coverage = len(matched) / len(keywords) if keywords else 1.0
            passed = coverage >= 0.5
            results.append(
                ValidationResult(
                    passed=passed,
                    engine="business-rule",
                    rule_id=spec[:50],
                    message=f"keyword coverage {int(coverage * 100)}%",
                    details={"matched": matched, "missing": [k for k in keywords if k not in code_lower]},
                )
            )
        return results


# ---------------------------------------------------------------------------
# GitHub PR publisher (inlined for deployment)
# ---------------------------------------------------------------------------

def _parse_github_repo(repo_url: str) -> Tuple[str, str]:
    if _parse_owner_repo is not None:
        return _parse_owner_repo(repo_url)
    cleaned = repo_url.removesuffix(".git")
    parts = cleaned.rstrip("/").split("/")
    if len(parts) < 2:
        raise ValueError(f"Invalid GitHub repo URL: {repo_url}")
    return parts[-2], parts[-1]


def _resolve_token_for_repo(repo_url: str) -> Tuple[str, str]:
    """Return (token, source) for the repo owner. Never reuse a wrong-owner global token."""
    if _resolve_github_token_for_repo is not None:
        resolved = _resolve_github_token_for_repo(repo_url)
        return resolved.token, resolved.source
    # Minimal fallback when package tokens module is unavailable
    owner, _ = _parse_github_repo(repo_url)
    token = (
        os.environ.get("GIT_TOKEN")
        or os.environ.get("GITHUB_TOKEN")
        or os.environ.get("GH_TOKEN")
        or ""
    )
    return token, f"env-fallback({owner})"


class GitHubPublisher:
    """Creates pull requests on GitHub using the REST API."""

    def __init__(self, token: Optional[str] = None, api_url: str = "https://api.github.com"):
        self.token = token or os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
        self.api_url = api_url.rstrip("/")

    @classmethod
    def for_repo(cls, repo_url: str, api_url: str = "https://api.github.com") -> "GitHubPublisher":
        token, _source = _resolve_token_for_repo(repo_url)
        return cls(token=token, api_url=api_url)

    def _ensure_token(self) -> None:
        if not self.token:
            raise RuntimeError("GITHUB_TOKEN or GH_TOKEN environment variable is required")

    def _headers(self) -> Dict[str, str]:
        self._ensure_token()
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def create_pull_request(
        self,
        repo_url: str,
        title: str,
        head: str,
        base: str,
        body: str = "",
    ) -> Dict[str, Any]:
        owner, repo = _parse_github_repo(repo_url)
        url = f"{self.api_url}/repos/{owner}/{repo}/pulls"
        async with httpx.AsyncClient() as client:
            r = await client.post(
                url,
                headers=self._headers(),
                json={"title": title, "head": head, "base": base, "body": body},
            )
            if r.status_code == 422:
                list_url = f"{self.api_url}/repos/{owner}/{repo}/pulls"
                lr = await client.get(
                    list_url,
                    headers=self._headers(),
                    params={"state": "open", "head": f"{owner}:{head}"},
                )
                if lr.status_code == 200:
                    existing = lr.json()
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

    def sanitize_branch(self, prefix: str, job_id: str) -> str:
        safe = re.sub(r"[^a-zA-Z0-9_-]+", "-", job_id).strip("-")
        return f"{prefix}/{safe}"[:100]


# ---------------------------------------------------------------------------
# Shared data types
# ---------------------------------------------------------------------------

class ValidationConfig(pydantic.BaseModel):
    """Validation settings for a single SDLC job."""

    lint_cmd: Optional[str] = None
    validation_cmd: Optional[str] = None
    # Expand into validation_cmd when validation_cmd is unset (see resolve_validation_cmd).
    formal_suite: Optional[str] = None  # quint | dafny | alloy | all
    formal_paths: List[str] = pydantic.Field(default_factory=list)
    run_typescript_validation: bool = False
    typescript_engines: Optional[List[str]] = None
    rule_specs: List[str] = pydantic.Field(default_factory=list)
    rule_codes: List[str] = pydantic.Field(default_factory=list)
    max_validation_iterations: int = 2


class SdlcJob(pydantic.BaseModel):
    """One unit of SDLC work handed to a worker."""

    job_id: str
    repo_url: Optional[str] = None
    branch: str = "main"
    task: str
    max_iterations: int = 4
    test_cmd: str = "pytest -q"
    lint_cmd: Optional[str] = None
    model: str = "zai-org/GLM-5"
    validation: ValidationConfig = pydantic.Field(default_factory=ValidationConfig)
    create_pr: bool = False
    pr_branch_prefix: str = "sdlc-batch"
    pr_title: Optional[str] = None
    pr_body: Optional[str] = None


class ValidationReport(pydantic.BaseModel):
    passed: bool
    engine: str
    rule_id: Optional[str] = None
    message: str = ""
    details: Dict[str, Any] = pydantic.Field(default_factory=dict)


class SdlcResult(pydantic.BaseModel):
    job_id: str
    ok: bool
    iterations: int
    diff: str = ""
    test_output: str = ""
    session_id: Optional[str] = None
    error: Optional[str] = None
    validation: List[ValidationReport] = pydantic.Field(default_factory=list)
    validation_passed: bool = False
    pr_url: Optional[str] = None
    pr_number: Optional[int] = None
    pr_branch: Optional[str] = None
    pr_error: Optional[str] = None


class BatchRequest(pydantic.BaseModel):
    jobs: List[SdlcJob]


class BatchResponse(pydantic.BaseModel):
    results: List[SdlcResult]


# ---------------------------------------------------------------------------
# Worker Chainlet
# ---------------------------------------------------------------------------

class OpenCodeWorker(chains.ChainletBase):
    """Runs the plan -> code -> test -> validation -> publish -> review loop."""

    remote_config = chains.RemoteConfig(
        docker_image=chains.DockerImage(
            pip_requirements=[
                "httpx[http2]>=0.27",
                "pydantic>=2",
                "pyyaml>=6.0",
                "daytona>=0.14.0",
            ],
        ),
        compute=chains.Compute(cpu_count=2, memory="4Gi"),
        assets=chains.Assets(
            secret_keys=[
                "OPENCODE_BASE_URLS",
                "OPENCODE_SANDBOX_IDS",
                "OPENCODE_BEARER",
                "BASETEN_API_KEY",
                "GITHUB_TOKEN",
            ],
        ),
    )

    def __init__(self, context: chains.DeploymentContext = chains.depends_context()):
        raw = context.secrets.get("OPENCODE_BASE_URLS", "")
        self._pool = [u.strip() for u in raw.split(",") if u.strip()]
        if not self._pool:
            raise RuntimeError("OPENCODE_BASE_URLS secret is empty")

        ids_raw = context.secrets.get("OPENCODE_SANDBOX_IDS", "")
        ids = [i.strip() for i in ids_raw.split(",") if i.strip()]
        self._sandbox_map: Dict[str, str] = {}
        if ids:
            if len(ids) != len(self._pool):
                raise RuntimeError(
                    "OPENCODE_SANDBOX_IDS must have the same length as OPENCODE_BASE_URLS"
                )
            self._sandbox_map = {url: sid for url, sid in zip(self._pool, ids)}
            if AsyncDaytona is None:
                raise RuntimeError(
                    "OPENCODE_SANDBOX_IDS is set but the daytona SDK is not available"
                )

        token = context.secrets.get("OPENCODE_BEARER", "")
        headers = {"Authorization": f"Bearer {token}"} if token else {}

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
        self._validator = ValidationEngine()
        self._publisher = GitHubPublisher(token=context.secrets.get("GITHUB_TOKEN", ""))

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

    def _model_payload(self, model: str) -> Dict[str, str]:
        """Convert a model slug like 'zai-org/GLM-5' to the OpenCode v1.1 object format."""
        if "/" in model:
            provider_id, model_id = model.split("/", 1)
            return {"providerID": provider_id, "modelID": model_id}
        # Fallback for bare model IDs.
        return {"providerID": "zai-org", "modelID": model}

    async def _send(
        self, base: str, session: str, text: str, model: str, mode: str = "build"
    ) -> Dict[str, Any]:
        payload = {
            "parts": [{"type": "text", "text": text}],
            "model": self._model_payload(model),
            "mode": mode,
        }
        r = await self._client.post(f"{base}/session/{session}/message", json=payload)
        r.raise_for_status()
        return r.json()

    async def _exec_direct(
        self, cmd: str, sandbox_id: str, env: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """Execute a command directly in a Daytona sandbox via the Daytona SDK."""
        if AsyncDaytona is None:
            return {
                "parts": [
                    {
                        "type": "text",
                        "text": "[daytona exec error] daytona SDK not available",
                    }
                ],
            }
        daytona = None
        try:
            cfg = DaytonaConfig(
                api_key=os.environ.get("DAYTONA_API_KEY", ""),
                api_url=os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api"),
                target=os.environ.get("DAYTONA_TARGET"),
            )
            daytona = AsyncDaytona(cfg)
            sandbox = await daytona.get(sandbox_id)
            # Allow longer for npx/quint installs inside validation_cmd.
            result = await sandbox.process.exec(cmd, timeout=300, env=env)
            return {
                "parts": [
                    {
                        "type": "text",
                        "text": (result.result or "").strip(),
                    }
                ],
            }
        except Exception as e:
            return {
                "parts": [
                    {
                        "type": "text",
                        "text": f"[daytona exec error] {type(e).__name__}: {e}",
                    }
                ],
            }
        finally:
            if daytona is not None:
                try:
                    await daytona.close()
                except Exception:
                    pass

    async def _shell(
        self, base: str, session: str, cmd: str, model: str, env: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """Execute a shell command in the sandbox.

        If OPENCODE_SANDBOX_IDS is configured, use the Daytona SDK directly so we
        get the raw output regardless of the model's tool-calling behaviour. Otherwise
        fall back to asking the OpenCode agent to run the command.
        """
        sandbox_id = self._sandbox_map.get(base)
        if sandbox_id:
            return await self._exec_direct(cmd, sandbox_id, env=env)
        return await self._send(
            base,
            session,
            f"Run this command exactly and return the raw output:\n\n```bash\n{cmd}\n```",
            model=model,
            mode="build",
        )

    # ---- Validation helpers ---------------------------------------------

    def _default_file_for_task(self, task: str) -> Optional[str]:
        """Infer a default file path from the task description for content fallback."""
        m = re.search(
            r"Write the following file to\s+([^\s(]+\.(?:md|sh|py|ts|tsx|js|ya?ml|qnt|json))",
            task,
            re.IGNORECASE,
        )
        if m:
            return m.group(1).strip()
        task_lower = task.lower()
        if "smoke_check.sh" in task_lower or "scripts/smoke_check" in task_lower:
            return "scripts/smoke_check.sh"
        if "contributing.md" in task_lower:
            return "CONTRIBUTING.md"
        if "readme" in task_lower:
            return "README.md"
        return None

    async def _apply_json_changes(
        self, base: str, data: Dict[str, Any]
    ) -> Tuple[str, bool]:
        """Apply file changes described by a JSON object.

        Expected shape:
        {
          "files": [{"path": "relative/path", "content": "..."}],
          "commands": ["bash command", ...]
        }
        Returns (summary, ok).
        """
        sandbox_id = self._sandbox_map.get(base)
        if not sandbox_id:
            return ("[apply] no sandbox_id mapping for base URL", False)

        files = data.get("files") or []
        commands = data.get("commands") or []
        applied: List[str] = []

        for f in files:
            path = f.get("path", "")
            content = f.get("content", "")
            if not path:
                continue
            target = f"repo/{path}" if not path.startswith("repo/") and not path.startswith("/") else path
            parent = target.rsplit("/", 1)[0] if "/" in target else "."
            # Hex-encode to avoid heredoc/newline issues inside Daytona process.exec
            hex_payload = content.encode("utf-8").hex()
            cmd = (
                f"mkdir -p '{parent}' && "
                f"python3 -c \"open('{target}','w',encoding='utf-8').write(bytes.fromhex('{hex_payload}').decode())\""
            )
            if path.endswith(".sh"):
                cmd += f" && chmod +x '{target}'"
            await self._exec_direct(cmd, sandbox_id)
            applied.append(f"wrote {path}")

        for cmd in commands:
            if not cmd.strip():
                continue
            await self._exec_direct(cmd, sandbox_id)
            applied.append(f"ran {cmd[:80]}")

        return ("\n".join(applied), True)

    def _extract_text(self, msg: Dict[str, Any]) -> str:
        parts = msg.get("parts") or msg.get("message", {}).get("parts") or []
        return "\n".join(p.get("text", "") for p in parts if p.get("type") == "text")

    def _extract_bash_commands(self, msg: Dict[str, Any]) -> List[str]:
        """Pull out bash code blocks from a model response for direct execution."""
        text = self._extract_text(msg)
        commands: List[str] = []
        # Match fenced ```bash ... ``` blocks (non-greedy)
        for block in re.findall(r"```bash\s*\n(.*?)\n```", text, re.DOTALL):
            commands.append(block.strip())
        return commands

    def _extract_json(self, msg: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Extract a JSON object from the model response (fenced or raw)."""
        text = self._extract_text(msg).strip()
        # Try fenced ```json ... ``` first
        for block in re.findall(r"```json\s*\n(.*?)\n```", text, re.DOTALL):
            try:
                return json.loads(block.strip())
            except Exception:
                continue
        # Try bare JSON object
        try:
            return json.loads(text)
        except Exception:
            pass
        return None

    def _extract_markdown(self, msg: Dict[str, Any]) -> str:
        """Extract the first markdown code block from a model response, or the whole text."""
        text = self._extract_text(msg).strip()
        for block in re.findall(r"```markdown\s*\n(.*?)\n```", text, re.DOTALL):
            return block.strip()
        return text

    def _extract_task_file_content(self, task: str, msg: Dict[str, Any]) -> str:
        """Prefer exact content embedded in the task; else model markdown/text."""
        # Pattern used by deterministic e2e jobs: content after a blank line following "Write the following"
        m = re.search(
            r"Write the following[^\n]*:\s*\n\n(.+?)(?:\n\n|$)",
            task,
            re.DOTALL | re.IGNORECASE,
        )
        if m:
            body = m.group(1).strip()
            # Unescape common JSON-string newlines if the task was stored with \n literals
            if "\\n" in body and "\n" not in body:
                body = body.encode("utf-8").decode("unicode_escape")
            if body:
                return body
        # Shebang script embedded in task
        m2 = re.search(r"(#!/usr/bin/env bash[\s\S]+)", task)
        if m2:
            return m2.group(1).strip()
        return self._extract_markdown(msg)

    def _run_local_validation(
        self, job: SdlcJob, rule_codes: Optional[List[str]] = None
    ) -> List[ValidationReport]:
        """Run keyword-coverage business-rule validation.

        If no explicit rule_codes are supplied, the rules are run against the
        provided rule_codes list. Missing or mismatched inputs produce a failing
        report so the loop can retry rather than crashing.
        """
        reports: List[ValidationReport] = []
        specs = job.validation.rule_specs
        codes = rule_codes if rule_codes is not None else list(job.validation.rule_codes)
        if not specs:
            return reports
        if not codes:
            return [
                ValidationReport(
                    passed=False,
                    engine="business-rule",
                    rule_id="missing-rule-codes",
                    message="No rule_codes available to validate against",
                )
            ]
        if len(specs) != len(codes):
            return [
                ValidationReport(
                    passed=False,
                    engine="business-rule",
                    rule_id="rule-count-mismatch",
                    message=f"rule_specs ({len(specs)}) and rule_codes ({len(codes)}) must have the same length",
                )
            ]
        results = self._validator.run_local_rules(specs, codes)
        for r in results:
            reports.append(
                ValidationReport(
                    passed=r.passed,
                    engine=r.engine,
                    rule_id=r.rule_id,
                    message=r.message,
                    details=r.details,
                )
            )
        return reports

    # ---- PR publishing ----------------------------------------------------

    async def _publish(self, job: SdlcJob, base: str, session: str) -> Dict[str, Any]:
        """Commit, push (Daytona SDK process.exec + credential env), open PR via REST."""
        branch = self._publisher.sanitize_branch(job.pr_branch_prefix, job.job_id)
        title = job.pr_title or f"[SDLC batch] {job.task[:60]}"
        body = job.pr_body or f"Automated change from SDLC batch job `{job.job_id}`.\n\nTask: {job.task}"
        repo_url = job.repo_url or ""
        if not repo_url:
            return {"ok": False, "error": "repo_url is required for PRs"}

        try:
            token, token_source = _resolve_token_for_repo(repo_url)
        except Exception as e:
            return {"ok": False, "error": f"token resolve failed: {e}"}
        if not token:
            return {"ok": False, "error": "No GitHub token resolved for repo owner"}

        # Per-job publisher — never reuse a global/wrong-owner token for mixed batches
        publisher = GitHubPublisher(token=token)
        sandbox_id = self._sandbox_map.get(base)

        async def _git(cmd: str) -> str:
            if not sandbox_id:
                return "[no sandbox_id]"
            resp = await self._exec_direct(
                cmd if cmd.startswith("cd repo") else f"cd repo && {cmd}",
                sandbox_id,
                env={"GIT_TOKEN": token},
            )
            return self._extract_text(resp)

        # Credential helper receives GIT_TOKEN via Daytona SDK process.exec env (not host bash).
        cred_setup = (
            "cd repo && "
            "git config credential.helper '!f() { echo \"username=$GIT_TOKEN\"; echo \"password=x-oauth-basic\"; }; f' && "
            "git config user.email 'agent@brightforest.ai' && "
            "git config user.name 'SDLC Agent'"
        )
        cred_out = await self._exec_direct(cred_setup, sandbox_id, env={"GIT_TOKEN": token})
        out = f"[cred setup token_source={token_source}]\n" + self._extract_text(cred_out)

        out += "\n" + await _git("git add -A")
        # Prefer create-or-reset branch so re-runs update the same PR head
        out += "\n" + await _git(f"git checkout -B {branch}")
        commit_out = await _git(
            f"git commit --allow-empty -m {json.dumps(title + ' [' + job.job_id + ']')}"
        )
        out += "\n" + commit_out
        # Unshallow if needed, then push via origin with credential helper (not bare URL).
        out += "\n" + await _git(
            "git rev-parse --is-shallow-repository 2>/dev/null | grep -q true && "
            "git fetch --unshallow || true"
        )
        push_owner, push_repo = _parse_github_repo(repo_url)
        out += "\n" + await _git(
            f"git remote set-url origin "
            f"https://x-access-token:${{GIT_TOKEN}}@github.com/{push_owner}/{push_repo}.git"
        )
        push_out = await _git(f"git push -u origin HEAD:{branch}")
        out += "\n" + push_out

        if "fatal" in push_out.lower() or "error:" in push_out.lower() or "rejected" in push_out.lower():
            return {"ok": False, "error": f"git failed:\n{out}", "token_source": token_source}

        try:
            pr = await publisher.create_pull_request(
                repo_url=repo_url,
                title=title,
                head=branch,
                base=job.branch,
                body=body,
            )
            pr["token_source"] = token_source
            return pr
        except Exception as e:
            return {
                "ok": False,
                "error": f"GitHub API: {repr(e)}\n\ngit output:\n{out}",
                "token_source": token_source,
            }

    # ---- The SDLC loop ----------------------------------------------------

    async def run_remote(self, job: SdlcJob) -> SdlcResult:
        base = await self._next_base()
        try:
            session = await self._create_session(base)

            if job.repo_url:
                try:
                    clone_token, _ = _resolve_token_for_repo(job.repo_url)
                except Exception:
                    clone_token = ""
                owner, repo_name = _parse_github_repo(job.repo_url)
                # Authenticated clone for private repos; token via exec env (not shell history).
                # Avoid --depth 1: shallow clones often fail GitHub push with
                # "remote: fatal: did not receive expected object".
                if clone_token and self._sandbox_map.get(base):
                    await self._exec_direct(
                        f"git clone -b {job.branch} "
                        f"https://x-access-token:${{GIT_TOKEN}}@github.com/{owner}/{repo_name}.git repo",
                        self._sandbox_map[base],
                        env={"GIT_TOKEN": clone_token},
                    )
                else:
                    await self._shell(
                        base,
                        session,
                        f"git clone -b {job.branch} {job.repo_url} repo && cd repo",
                        model=job.model,
                    )

            await self._send(
                base,
                session,
                f"You are implementing this task in the `repo` folder:\n\n{job.task}\n\n"
                "First produce a short plan (bullets only). Do not modify files yet.",
                model=job.model,
                mode="plan",
            )

            # Deterministic seed: if the task embeds exact file content, write it before the loop
            seed_file = self._default_file_for_task(job.task)
            if seed_file and self._sandbox_map.get(base):
                seed_content = self._extract_task_file_content(job.task, {"parts": []})
                # Seed shell, markdown, YAML, Quint, and other embedded exact-content tasks.
                seedable = bool(seed_content) and (
                    "#!/usr/bin" in seed_content
                    or seed_content.startswith("#")
                    or seed_content.startswith("id:")
                    or seed_content.startswith("module ")
                    or seed_content.startswith("version:")
                    or seed_file.endswith((".qnt", ".yaml", ".yml", ".sh", ".md"))
                )
                if seedable:
                    await self._apply_json_changes(
                        base, {"files": [{"path": seed_file, "content": seed_content}]}
                    )
                    # Ensure shell scripts are executable when the task requests chmod.
                    if seed_file.endswith(".sh") and "chmod" in job.task.lower():
                        await self._exec_direct(
                            f"chmod +x repo/{seed_file}",
                            self._sandbox_map[base],
                        )

            last_test_out = ""
            last_diff = ""
            validation_reports: List[ValidationReport] = []

            for i in range(1, job.max_iterations + 1):
                # Code: ask for a structured JSON patch so we can apply it directly.
                code_resp = await self._send(
                    base,
                    session,
                    f"Iteration {i}: implement the plan. Make the smallest change needed. "
                    "Respond with a single JSON object (wrapped in ```json ... ```) containing exactly two keys: "
                    '"files" (list of {path, content}) and "commands" (list of bash strings to run). '
                    "Do not explain.",
                    model=job.model,
                    mode="build",
                )
                patch = self._extract_json(code_resp)
                if patch and patch.get("files"):
                    summary, _ = await self._apply_json_changes(base, patch)
                else:
                    # Fallback: write the response as the default repo file if the task implies one.
                    default_file = self._default_file_for_task(job.task)
                    if default_file:
                        content = self._extract_task_file_content(job.task, code_resp)
                        await self._apply_json_changes(
                            base, {"files": [{"path": default_file, "content": content}]}
                        )
                        summary = f"wrote fallback {default_file}"
                    else:
                        # Fallback to extracting bash commands from the response
                        for cmd in self._extract_bash_commands(code_resp):
                            await self._shell(base, session, cmd, model=job.model)
                        summary = "applied bash fallback"

                # Test
                test_resp = await self._shell(
                    base,
                    session,
                    f"cd repo && ({job.test_cmd}); echo __TEST_EXIT__:$?",
                    model=job.model,
                )
                last_test_out = self._extract_text(test_resp)
                m_exit = re.search(r"__TEST_EXIT__:(\d+)", last_test_out)
                test_exit_code = int(m_exit.group(1)) if m_exit else 1
                passed = test_exit_code == 0

                # Lint
                lint_ok = True
                if job.lint_cmd:
                    lint_resp = await self._shell(base, session, f"cd repo && {job.lint_cmd}", model=job.model)
                    lint_text = self._extract_text(lint_resp)
                    lint_ok = "error" not in lint_text.lower() and "failed" not in lint_text.lower()

                # Diff
                diff_resp = await self._shell(base, session, "cd repo && git diff", model=job.model)
                last_diff = self._extract_text(diff_resp)

                # Validation: validation_cmd is source of truth when present;
                # else expand formal_suite / formal_paths when set.
                validation_reports = []
                try:
                    from sdlc_batch.validation import resolve_validation_cmd

                    validation_cmd = resolve_validation_cmd(
                        validation_cmd=job.validation.validation_cmd,
                        formal_suite=job.validation.formal_suite,
                        formal_paths=job.validation.formal_paths,
                    )
                except Exception:
                    validation_cmd = job.validation.validation_cmd
                cmd_ok = True
                if validation_cmd:
                    if self._sandbox_map.get(base):
                        vresp = await self._exec_direct(
                            f"cd repo && {validation_cmd}; echo __EXIT__:$?",
                            self._sandbox_map[base],
                        )
                        vtext = self._extract_text(vresp)
                    else:
                        vresp = await self._shell(
                            base, session, f"cd repo && {validation_cmd}; echo __EXIT__:$?", model=job.model
                        )
                        vtext = self._extract_text(vresp)
                    exit_match = re.search(r"__EXIT__:(\d+)", vtext)
                    exit_code = int(exit_match.group(1)) if exit_match else 1
                    cmd_ok = exit_code == 0
                    validation_reports.append(
                        ValidationReport(
                            passed=cmd_ok,
                            engine="validation_cmd",
                            rule_id="validation_cmd",
                            message=f"exit={exit_code}",
                            details={"stdout": vtext[-1000:], "cmd": validation_cmd},
                        )
                    )

                # Keyword / rule_codes only as secondary signal when no validation_cmd,
                # or when rule_codes are explicitly provided.
                if not validation_cmd or job.validation.rule_codes:
                    rule_codes = list(job.validation.rule_codes)
                    if not rule_codes and job.validation.rule_specs and self._sandbox_map.get(base):
                        # Infer artifacts from validation_cmd / task rather than always README
                        probe_paths = ["README.md", "CONTRIBUTING.md", "scripts/smoke_check.sh"]
                        if validation_cmd:
                            for m in re.finditer(
                                r"([\w./-]+\.(?:md|sh|py|ts|tsx|js|ya?ml|qnt|json))",
                                validation_cmd,
                            ):
                                probe_paths.insert(0, m.group(1))
                        blob_parts: List[str] = []
                        for p in probe_paths[:5]:
                            r = await self._exec_direct(
                                f"cat repo/{p} 2>/dev/null || true",
                                self._sandbox_map[base],
                            )
                            blob_parts.append(self._extract_text(r))
                        content = "\n".join(blob_parts)
                        if content.strip():
                            rule_codes = [content] * len(job.validation.rule_specs)
                    if job.validation.rule_specs and rule_codes:
                        validation_reports.extend(
                            self._run_local_validation(job, rule_codes=rule_codes)
                        )

                # Optional host-side TypeScript validation orchestrator
                # (src/validation/) when the job requests it.
                ts_ok = True
                if job.validation.run_typescript_validation:
                    try:
                        from sdlc_batch.validation import ValidationEngine as TsValidationEngine

                        ts_engine = TsValidationEngine()
                        ts_results = ts_engine.run_typescript_validation(
                            engines=job.validation.typescript_engines,
                        )
                        for tr in ts_results:
                            validation_reports.append(
                                ValidationReport(
                                    passed=tr.passed,
                                    engine=tr.engine,
                                    rule_id=tr.rule_id,
                                    message=tr.message,
                                    details=tr.details,
                                )
                            )
                        ts_ok = all(tr.passed for tr in ts_results) if ts_results else False
                    except Exception as e:
                        ts_ok = False
                        validation_reports.append(
                            ValidationReport(
                                passed=False,
                                engine="typescript-validation",
                                rule_id="typescript-validation",
                                message=f"runner error: {e}",
                            )
                        )

                # Source of truth: validation_cmd when set; else all reports; lint is soft unless alone
                if validation_cmd:
                    validation_ok = cmd_ok and lint_ok and ts_ok
                else:
                    validation_ok = (
                        (all(r.passed for r in validation_reports) if validation_reports else True)
                        and lint_ok
                        and ts_ok
                    )

                if passed and validation_ok:
                    pr_info: Dict[str, Any] = {"pr_url": None, "pr_number": None, "pr_branch": None}
                    if job.create_pr:
                        try:
                            pr_info = await self._publish(job, base, session)
                        except Exception as e:
                            pr_info = {"pr_url": None, "pr_number": None, "pr_branch": None, "error": repr(e)}
                    return SdlcResult(
                        job_id=job.job_id,
                        ok=True,
                        iterations=i,
                        diff=last_diff,
                        test_output=last_test_out,
                        session_id=session,
                        validation=validation_reports,
                        validation_passed=True,
                        pr_url=pr_info.get("pr_url"),
                        pr_number=pr_info.get("pr_number"),
                        pr_branch=pr_info.get("branch"),
                        pr_error=pr_info.get("error"),
                    )

                # Compose feedback for the next iteration
                feedback_parts = []
                if not passed:
                    feedback_parts.append(f"Tests failed (exit {test_exit_code}). Output:\n{last_test_out}")
                if not lint_ok:
                    feedback_parts.append(f"Lint failed. Output:\n{lint_text}")
                for r in validation_reports:
                    if not r.passed:
                        feedback_parts.append(f"Validation failed: {r.rule_id} - {r.message}")
                feedback = "\n\n".join(feedback_parts) or "Changes did not satisfy the requirements."

                await self._send(
                    base,
                    session,
                    f"{feedback}\n\nPrepare a minimal fix and output the updated JSON patch.",
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
                error="max_iterations reached without green tests/validation",
                validation=validation_reports,
                validation_passed=False,
            )

        except Exception as e:
            return SdlcResult(
                job_id=job.job_id,
                ok=False,
                iterations=0,
                error=repr(e),
                validation=validation_reports if "validation_reports" in locals() else [],
                validation_passed=False,
            )


# ---------------------------------------------------------------------------
# Entrypoint Chainlet
# ---------------------------------------------------------------------------

@chains.mark_entrypoint
class SdlcOrchestrator(chains.ChainletBase):
    """Client-facing Chainlet. Accepts a batch of SdlcJob and fans them out."""

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
            await asyncio.sleep(0)
        results = await asyncio.gather(*tasks, return_exceptions=False)
        return BatchResponse(results=list(results))


# ---------------------------------------------------------------------------
# Local debug entrypoint
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    os.environ.setdefault("OPENCODE_BASE_URLS", "http://127.0.0.1:4096")

    async def _main() -> None:
        with chains.run_local(
            secrets={
                "OPENCODE_BASE_URLS": os.environ["OPENCODE_BASE_URLS"],
                "OPENCODE_BEARER": os.environ.get("OPENCODE_BEARER", ""),
                "BASETEN_API_KEY": os.environ.get("BASETEN_API_KEY", ""),
                "GITHUB_TOKEN": os.environ.get("GITHUB_TOKEN", ""),
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
                            validation=ValidationConfig(
                                rule_specs=["endpoint must return json"],
                                rule_codes=["return jsonify({'ok': true})"],
                            ),
                        )
                    ]
                )
            )
            for r in resp.results:
                print(r.model_dump_json(indent=2))

    asyncio.run(_main())
