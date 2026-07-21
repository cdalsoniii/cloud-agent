"""Formal validation integration for the SDLC batch loop."""

from __future__ import annotations

import json
import os
import shlex
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional, Sequence


@dataclass
class ValidationResult:
    passed: bool
    engine: str
    rule_id: Optional[str] = None
    message: str = ""
    details: dict[str, Any] = field(default_factory=dict)
    stdout: str = ""
    stderr: str = ""


DEFAULT_FORMAL_PATHS: dict[str, list[str]] = {
    "quint": ["config/verification/quint"],
    "dafny": ["config/verification/dafny"],
    "alloy": ["config/verification/alloy"],
    "all": ["config/verification"],
}


def resolve_validation_cmd(
    validation_cmd: Optional[str] = None,
    formal_suite: Optional[str] = None,
    formal_paths: Optional[Sequence[str]] = None,
) -> Optional[str]:
    """Resolve the sandbox validation command.

    Preference order:
      1. Explicit ``validation_cmd`` (source of truth)
      2. Expand ``formal_suite`` / ``formal_paths`` into a verify-local or tool invocation
    """
    if validation_cmd and validation_cmd.strip():
        return validation_cmd.strip()

    suite = (formal_suite or "").strip().lower()
    paths = [p for p in (formal_paths or []) if p and str(p).strip()]
    if not suite and not paths:
        return None

    if not suite:
        suite = "all"
    if suite not in DEFAULT_FORMAL_PATHS and suite not in {"quint", "dafny", "alloy", "all"}:
        suite = "all"

    if not paths:
        paths = list(DEFAULT_FORMAL_PATHS.get(suite, DEFAULT_FORMAL_PATHS["all"]))

    # Prefer repo verify-local.sh when present; fall back to direct tool cmds for sandboxes
    # that only have npx (Quint) without the full script tree.
    quoted_paths = " ".join(shlex.quote(p) for p in paths)
    if suite == "quint" or (suite == "all" and all("quint" in p for p in paths)):
        # Typecheck each .qnt under formal_paths (glob via shell).
        parts = []
        for p in paths:
            if p.endswith(".qnt"):
                parts.append(
                    f"(command -v quint >/dev/null && quint typecheck {shlex.quote(p)} "
                    f"|| npx --yes @informalsystems/quint@0.32.0 typecheck {shlex.quote(p)})"
                )
            else:
                parts.append(
                    f"for q in {shlex.quote(p)}/*.qnt; do "
                    f"[ -f \"$q\" ] || continue; "
                    f"(command -v quint >/dev/null && quint typecheck \"$q\" "
                    f"|| npx --yes @informalsystems/quint@0.32.0 typecheck \"$q\"); "
                    f"done"
                )
        return " && ".join(parts) if parts else None

    if suite == "dafny":
        parts = []
        for p in paths:
            if p.endswith(".dfy"):
                parts.append(f"dafny verify --allow-warnings {shlex.quote(p)}")
            else:
                parts.append(
                    f"for f in {shlex.quote(p)}/*.dfy; do "
                    f"[ -f \"$f\" ] || continue; dafny verify --allow-warnings \"$f\"; done"
                )
        return " && ".join(parts) if parts else None

    # Generic: call verify-local when script exists, else echo guidance
    return (
        f"if [ -x scripts/verify-local.sh ]; then "
        f"./scripts/verify-local.sh --suite {shlex.quote(suite)}; "
        f"elif [ -f scripts/verify-local.sh ]; then "
        f"bash scripts/verify-local.sh --suite {shlex.quote(suite)}; "
        f"else echo 'formal_suite set but scripts/verify-local.sh missing; "
        f"paths={quoted_paths}' >&2; exit 1; fi"
    )


class ValidationEngine:
    """Runs validation steps inside the SDLC loop.

    Supports:
      1. Custom validation commands executed in the sandbox (source of truth when set).
      2. ``formal_suite`` / ``formal_paths`` expansion into a validation command.
      3. Formal business-rule verification via the local TypeScript validation runner.
      4. Keyword coverage heuristics only as a fallback when no validation_cmd is provided.
    """

    def __init__(
        self,
        repo_dir: str = "repo",
        validation_runner: Optional[str] = None,
    ):
        self.repo_dir = repo_dir
        self.validation_runner = validation_runner or self._default_validation_runner()

    def _default_validation_runner(self) -> str:
        # Prefer the TypeScript validation runner in the cloud-agent project.
        candidate = Path(__file__).resolve().parents[5] / "src" / "validation" / "run-validation.ts"
        if candidate.is_file():
            return f"npx tsx {candidate}"
        return "npx tsx src/validation/run-validation.ts"

    async def run_in_sandbox(
        self,
        exec_command,
        validation_cmd: Optional[str] = None,
        lint_cmd: Optional[str] = None,
    ) -> list[ValidationResult]:
        """Run validation commands inside the sandbox.

        Args:
            exec_command: async callable that runs a shell command in the sandbox.
            validation_cmd: optional validation command to run in the repo folder.
            lint_cmd: optional lint command to run in the repo folder.

        Returns:
            list of ValidationResult objects.
        """
        results: list[ValidationResult] = []

        if lint_cmd:
            resp = await exec_command(f"cd {self.repo_dir} && {lint_cmd}")
            results.append(
                ValidationResult(
                    passed=resp.get("ok", False),
                    engine="lint",
                    message="lint" if resp.get("ok") else resp.get("stderr", "lint failed"),
                    stdout=resp.get("stdout", ""),
                    stderr=resp.get("stderr", ""),
                )
            )

        if validation_cmd:
            resp = await exec_command(f"cd {self.repo_dir} && {validation_cmd}")
            results.append(
                ValidationResult(
                    passed=resp.get("ok", False),
                    engine="custom",
                    message="custom validation" if resp.get("ok") else resp.get("stderr", "validation failed"),
                    stdout=resp.get("stdout", ""),
                    stderr=resp.get("stderr", ""),
                )
            )

        return results

    def run_local_rules(
        self,
        rule_specs: list[str],
        rule_codes: list[str],
    ) -> list[ValidationResult]:
        """Verify formal business rules locally against code snippets.

        This is a lightweight heuristic fallback. For deeper formal verification,
        integrate with the Midspiral MCP tooling or a dedicated solver.
        """
        if len(rule_specs) != len(rule_codes):
            raise ValueError("rule_specs and rule_codes must have the same length")

        results: list[ValidationResult] = []
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

    def run_typescript_validation(
        self,
        engines: Optional[list[str]] = None,
        namespace: str = "main",
        database: str = "main",
    ) -> list[ValidationResult]:
        """Invoke the local TypeScript validation orchestrator.

        Returns parsed validation results if the runner is available.
        """
        engines = engines or ["consistency", "integrity", "performance", "business"]
        cmd = f"{self.validation_runner} --engines {','.join(engines)} --namespace {namespace} --database {database} --format json"
        try:
            result = subprocess.run(
                cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=300,
                cwd=os.environ.get("PROJECT_DIR", "."),
            )
            if result.returncode != 0:
                return [
                    ValidationResult(
                        passed=False,
                        engine="typescript-validation",
                        message="validation runner failed",
                        stderr=result.stderr,
                    )
                ]
            parsed = json.loads(result.stdout)
            summary = parsed.get("report", {}).get("summary", parsed.get("summary", {}))
            return [
                ValidationResult(
                    passed=parsed.get("status") == "passed" and summary.get("errors", 0) == 0,
                    engine="typescript-validation",
                    message=f"total={summary.get('total', 0)} passed={summary.get('passed', 0)} failed={summary.get('failed', 0)}",
                    details=parsed,
                )
            ]
        except Exception as e:
            return [
                ValidationResult(
                    passed=False,
                    engine="typescript-validation",
                    message=f"runner error: {e}",
                )
            ]

    def summarize(self, results: list[ValidationResult]) -> dict[str, Any]:
        passed = all(r.passed for r in results)
        return {
            "passed": passed,
            "total": len(results),
            "failures": [r for r in results if not r.passed],
            "results": [
                {
                    "engine": r.engine,
                    "rule_id": r.rule_id,
                    "passed": r.passed,
                    "message": r.message,
                }
                for r in results
            ],
        }
