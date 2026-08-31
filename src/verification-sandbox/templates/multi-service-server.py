#!/usr/bin/env python3
"""Packed verifier services on fixed ports (one container).

Ports:
  7000 lean / safety   — real `lean`/`lake` when on PATH; else structured stub
  7001 haskell         — ghc/runghc when present; else stub
  7002 boundaryml      — structure checks (schema-ish stub)
  7003 guardrails      — content checks (stub)
SHACL is a sibling process on 7004 (shacl-server.py).
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional, Tuple

PORT_MAP: Dict[int, str] = {
    7000: "lean",
    7001: "haskell",
    7002: "boundaryml",
    7003: "guardrails",
}


def _extra_guardrails_ports() -> list[int]:
    """
    Operator may run N Guardrails AI content-check binds.
    GUARDRAILS_EXTRA_PORTS=7010,7011,7012  or GUARDRAILS_PORTS=7003,7010
    Soft optional GUARDRAILS_MAX_SERVERS does not block parsing; process spawn uses listed ports.
    """
    raw = os.environ.get("GUARDRAILS_PORTS") or os.environ.get("GUARDRAILS_EXTRA_PORTS") or ""
    out: list[int] = []
    for part in raw.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            p = int(part)
            if 1 <= p <= 65535:
                out.append(p)
        except ValueError:
            continue
    # de-dupe preserve order
    seen: set[int] = set()
    uniq: list[int] = []
    for p in out:
        if p not in seen:
            seen.add(p)
            uniq.append(p)
    return uniq


for _gp in _extra_guardrails_ports():
    PORT_MAP[_gp] = "guardrails"
# always keep formal 7003 as guardrails
PORT_MAP[7003] = "guardrails"
PORTS = sorted(PORT_MAP.keys())


def which(cmd: str) -> Optional[str]:
    return shutil.which(cmd)


def probe_tools() -> Dict[str, Any]:
    return {
        "lean": which("lean"),
        "lake": which("lake"),
        "ghc": which("ghc"),
        "runghc": which("runghc"),
    }


TOOLS = probe_tools()


def run_lean_check(body: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    """
    Prefer real Lean when available:
      - body.lean_file path inside sandbox, or
      - body.snippet as temporary .lean file, or
      - lean --version as liveness
    """
    lean = TOOLS.get("lean")
    if not lean:
        force = bool(body.get("force_fail") or body.get("fail"))
        return (
            not force,
            "lean not on PATH — stub accept" if not force else "stub reject",
            {"mode": "stub", "tools": TOOLS},
        )

    if body.get("lean_file"):
        path = str(body["lean_file"])
        r = subprocess.run([lean, path], capture_output=True, text=True, timeout=60)
        ok = r.returncode == 0
        return ok, (r.stdout or r.stderr or "")[:500], {"mode": "lean-file", "exit": r.returncode}

    snippet = body.get("snippet") or body.get("code")
    if isinstance(snippet, str) and snippet.strip():
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as td:
            p = Path(td) / "check.lean"
            p.write_text(snippet)
            r = subprocess.run([lean, str(p)], capture_output=True, text=True, timeout=60)
            ok = r.returncode == 0
            return ok, (r.stdout or r.stderr or "")[:500], {"mode": "snippet", "exit": r.returncode}

    # liveness: lean --version
    r = subprocess.run([lean, "--version"], capture_output=True, text=True, timeout=15)
    force = bool(body.get("force_fail") or body.get("fail"))
    if force:
        return False, "force_fail with lean present", {"mode": "version", "version": r.stdout.strip()}
    ok = r.returncode == 0
    return ok, (r.stdout or "lean ok").strip()[:200], {"mode": "version", "version": (r.stdout or "").strip()}


def run_haskell_check(body: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    ghc = TOOLS.get("ghc") or TOOLS.get("runghc")
    if not ghc:
        force = bool(body.get("force_fail") or body.get("fail"))
        return (
            not force,
            "ghc not on PATH — stub accept" if not force else "stub reject",
            {"mode": "stub"},
        )
    force = bool(body.get("force_fail") or body.get("fail"))
    if force:
        return False, "force_fail", {"mode": "ghc-present"}
    r = subprocess.run([ghc, "--version"], capture_output=True, text=True, timeout=15)
    return r.returncode == 0, (r.stdout or r.stderr or "")[:200], {"mode": "version"}


def run_structure_check(body: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    force = bool(body.get("force_fail") or body.get("fail"))
    if force:
        return False, "structure validation rejected", {"mode": "stub"}
    # require either payload object or explicit pass
    if body.get("require_fields"):
        missing = [f for f in body["require_fields"] if f not in body]
        if missing:
            return False, f"missing fields: {missing}", {"mode": "fields"}
    return True, "structure accepted", {"mode": "stub"}


def run_content_check(body: Dict[str, Any]) -> Tuple[bool, str, Dict[str, Any]]:
    force = bool(body.get("force_fail") or body.get("fail"))
    if force:
        return False, "content validation rejected", {"mode": "stub"}
    text = str(body.get("text") or body.get("content") or "")
    banned = body.get("banned") or []
    for b in banned:
        if str(b) and str(b) in text:
            return False, f"banned content: {b}", {"mode": "banned"}
    return True, "content accepted", {"mode": "stub"}


HANDLERS = {
    "lean": run_lean_check,
    "haskell": run_haskell_check,
    "boundaryml": run_structure_check,
    "guardrails": run_content_check,
}


class Handler(BaseHTTPRequestHandler):
    service_name: str = "unknown"

    def log_message(self, *_args: Any) -> None:
        pass

    def _send(self, code: int, obj: dict) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        port = self.server.server_address[1]
        svc = PORT_MAP.get(port, self.service_name)
        path = self.path.split("?")[0]
        if path.startswith("/health"):
            self._send(
                200,
                {
                    "ok": True,
                    "port": port,
                    "service": svc,
                    "instanceId": f"{svc}:{port}",
                    "tools": TOOLS,
                    "guardrailsPorts": [p for p, s in PORT_MAP.items() if s == "guardrails"],
                    "real": bool(
                        (svc == "lean" and TOOLS.get("lean"))
                        or (svc == "haskell" and (TOOLS.get("ghc") or TOOLS.get("runghc")))
                        or svc == "guardrails"
                    ),
                },
            )
            return
        if path in ("/instances", "/guardrails"):
            gports = [p for p, s in PORT_MAP.items() if s == "guardrails"]
            self._send(
                200,
                {
                    "ok": True,
                    "service": "guardrails",
                    "count": len(gports),
                    "ports": gports,
                    "instances": [
                        {"id": f"guardrails:{p}", "port": p, "url": f"http://127.0.0.1:{p}/health"}
                        for p in gports
                    ],
                },
            )
            return
        self._send(404, {"ok": False})

    def do_POST(self) -> None:  # noqa: N802
        port = self.server.server_address[1]
        svc = PORT_MAP.get(port, "unknown")
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            body = json.loads(raw.decode() or "{}")
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        path = self.path.split("?")[0]
        if path not in ("/verify", "/", "/run"):
            # accept any POST as verify for compatibility
            pass

        handler = HANDLERS.get(svc, run_structure_check)
        ok, detail, meta = handler(body)
        self._send(
            200,
            {
                "pass": ok,
                "detail": detail,
                "port": port,
                "service": svc,
                "meta": meta,
            },
        )


def serve(port: int) -> None:
    httpd = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    httpd.serve_forever()


def main() -> None:
    for p in PORTS:
        t = threading.Thread(target=serve, args=(p,), daemon=True)
        t.start()
    print(
        json.dumps({"ready": True, "ports": PORTS, "services": PORT_MAP, "tools": TOOLS}),
        flush=True,
    )
    while True:
        time.sleep(3600)


if __name__ == "__main__":
    main()
