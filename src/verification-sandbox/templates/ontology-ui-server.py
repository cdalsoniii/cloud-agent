#!/usr/bin/env python3
"""
Ontology UI server (port 7005) — serves React Flow viewer of current .px ontology state.

Endpoints:
  GET  /              → ontology-ui/index.html
  GET  /health
  GET  /api/ontology/state   → ontology-state.json (from SHACL_SHAPES_DIR sibling or PX root)
  GET  /api/ontology/shapes  → list shapes
"""
from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlparse

PORT = int(os.environ.get("ONTOLOGY_UI_PORT", "7005"))
_DEFAULT_ROOT = os.path.expanduser(os.environ.get("REMOTE_VERIFIER_ROOT", "~/verifier"))
PX_ROOT = Path(os.environ.get("PX_REMOTE_ROOT", f"{_DEFAULT_ROOT}/px"))
SHAPES_DIR = Path(os.environ.get("SHACL_SHAPES_DIR", str(PX_ROOT / "generated")))
UI_DIR = Path(os.environ.get("ONTOLOGY_UI_DIR", f"{_DEFAULT_ROOT}/ontology-ui"))
STATE_CANDIDATES = [
    SHAPES_DIR / "ontology-state.json",
    PX_ROOT / "generated" / "ontology-state.json",
    Path(f"{_DEFAULT_ROOT}/px/generated/ontology-state.json"),
]


def load_state() -> Dict[str, Any]:
    for p in STATE_CANDIDATES:
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except Exception as e:
                return {"error": f"parse failed: {e}", "path": str(p)}
    # minimal fallback from shapes dir only
    shapes = []
    if SHAPES_DIR.is_dir():
        for f in sorted(SHAPES_DIR.glob("*.shacl.ttl")):
            shapes.append({"name": f.name, "bytes": f.stat().st_size})
    return {
        "version": 1,
        "generatedAt": None,
        "pack": "unknown",
        "summary": {
            "classes": 0,
            "slots": 0,
            "verifiers": 0,
            "shapes": len(shapes),
            "enums": 0,
        },
        "fleet": {},
        "nodes": [],
        "edges": [],
        "shapes": shapes,
        "reactFlow": {"nodes": [], "edges": []},
        "meta": {
            "sourceRoot": str(PX_ROOT),
            "notes": ["ontology-state.json missing — re-upload LinkML pack"],
        },
    }


class Handler(SimpleHTTPRequestHandler):
    # main() may set Handler.directory for --ui-dir / ONTOLOGY_UI_DIR
    directory = str(UI_DIR)

    def __init__(self, *args, **kwargs):
        super().__init__(
            *args,
            directory=str(getattr(self.__class__, "directory", None) or UI_DIR),
            **kwargs,
        )

    def log_message(self, *_args: Any) -> None:
        pass

    def _json(self, code: int, obj: Any) -> None:
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self) -> None:  # noqa: N802
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"

        if path == "/health":
            st = load_state()
            self._json(
                200,
                {
                    "ok": True,
                    "service": "ontology-ui",
                    "port": self.server.server_address[1],
                    "pack": st.get("pack"),
                    "shapes": len(st.get("shapes") or []),
                    "summary": st.get("summary"),
                },
            )
            return

        if path in ("/api/ontology/state", "/api/state"):
            self._json(200, load_state())
            return

        if path in ("/api/ontology/shapes", "/api/shapes"):
            st = load_state()
            self._json(200, {"ok": True, "shapes": st.get("shapes") or []})
            return

        if path in ("/api/ontology/overlay", "/api/overlay"):
            self._json(200, load_ontology_overlay())
            return

        if path in ("/api/linkml/usage", "/api/usage"):
            self._json(200, load_linkml_usage())
            return

        if path in ("/api/linkml/reasoning", "/api/reasoning"):
            self._json(200, load_last_reasoning())
            return

        if path in ("/api/validation/calls", "/api/validation-calls", "/api/endpoint-io"):
            if path.endswith("endpoint-io"):
                self._json(200, load_endpoint_io())
            else:
                self._json(200, load_validation_calls())
            return

        if path in ("/api/guardrails/health",):
            # optional ?id= or ?port= for per-instance probe
            from urllib.parse import parse_qs

            qs = parse_qs(parsed.query or "")
            sid = (qs.get("id") or [None])[0]
            sport = (qs.get("port") or [None])[0]
            self._json(200, probe_guardrails_health(server_id=sid, port=sport))
            return

        if path in ("/api/guardrails", "/api/guardrails/servers", "/api/guardrails/list"):
            self._json(200, list_guardrails_registry())
            return

        if path in ("/api/guardrails/health-all", "/api/guardrails/status"):
            self._json(200, probe_all_guardrails_health())
            return

        if path in ("/api/midspiral/status", "/api/midspiral"):
            self._json(200, load_midspiral_status())
            return

        if path in ("/api/midspiral/runs",):
            self._json(200, load_midspiral_runs())
            return

        if path in ("/api/usage/credits", "/api/credits", "/api/usage/budget"):
            self._json(200, load_usage_credits())
            return

        # static files (index.html)
        if path == "/":
            self.path = "/index.html"
        return SimpleHTTPRequestHandler.do_GET(self)

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            body = json.loads(raw.decode("utf-8") or "{}") if raw else {}
        except Exception as e:
            self._json(400, {"ok": False, "error": f"invalid json: {e}"})
            return
        if not isinstance(body, dict):
            body = {}
        if path in ("/api/midspiral/run",):
            self._json(200, run_midspiral_via_host(body))
            return
        if path in ("/api/guardrails/register", "/api/guardrails/add"):
            self._json(200, register_guardrails_server(body))
            return
        if path in ("/api/guardrails/remove", "/api/guardrails/delete"):
            self._json(200, remove_guardrails_server(str(body.get("id") or body.get("serverId") or "")))
            return
        self._json(404, {"ok": False, "error": "not found"})


def _usage_candidates() -> list[Path]:
    cands = [
        Path(os.environ.get("LINKML_USAGE_LOG", "")),
        PX_ROOT / "session" / "linkml-usage.jsonl",
        Path(f"{_DEFAULT_ROOT}/px/session/linkml-usage.jsonl"),
        Path(os.path.expanduser("~/verifier/px/session/linkml-usage.jsonl")),
    ]
    # Host project session when server runs on host
    host = os.environ.get("GROK_PROJECT_DIR") or os.environ.get("CLOUD_AGENT_ROOT")
    if host:
        cands.insert(0, Path(host) / ".px" / "session" / "linkml-usage.jsonl")
    return [p for p in cands if str(p)]


def load_linkml_usage(limit: int = 40) -> Dict[str, Any]:
    for p in _usage_candidates():
        if p.is_file():
            entries: list[Any] = []
            try:
                for line in p.read_text(encoding="utf-8").splitlines():
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entries.append(json.loads(line))
                    except Exception:
                        pass
                return {
                    "ok": True,
                    "path": str(p),
                    "count": len(entries),
                    "entries": entries[-limit:],
                }
            except Exception as e:
                return {"ok": False, "error": str(e), "path": str(p)}
    return {
        "ok": True,
        "path": None,
        "count": 0,
        "entries": [],
        "note": "no linkml-usage.jsonl found — run tool_io_guard / px_validate_cascade",
    }


def load_last_reasoning() -> Dict[str, Any]:
    cands = []
    host = os.environ.get("GROK_PROJECT_DIR") or os.environ.get("CLOUD_AGENT_ROOT")
    if host:
        cands.append(Path(host) / ".px" / "session" / "last-linkml-reasoning.json")
    cands.extend(
        [
            PX_ROOT / "session" / "last-linkml-reasoning.json",
            Path(f"{_DEFAULT_ROOT}/px/session/last-linkml-reasoning.json"),
        ]
    )
    for p in cands:
        if p.is_file():
            try:
                return {"ok": True, "path": str(p), "entry": json.loads(p.read_text(encoding="utf-8"))}
            except Exception as e:
                return {"ok": False, "error": str(e), "path": str(p)}
    return {"ok": True, "entry": None, "note": "no last-linkml-reasoning.json yet"}


def _session_jsonl_candidates(name: str) -> list[Path]:
    cands: list[Path] = []
    host = os.environ.get("GROK_PROJECT_DIR") or os.environ.get("CLOUD_AGENT_ROOT")
    if host:
        cands.append(Path(host) / ".px" / "session" / name)
    cands.extend(
        [
            PX_ROOT / "session" / name,
            Path(f"{_DEFAULT_ROOT}/px/session/{name}"),
        ]
    )
    return cands


def _read_jsonl(path: Path, limit: int = 40) -> list[Any]:
    entries: list[Any] = []
    if not path.is_file():
        return entries
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                entries.append(json.loads(line))
            except Exception:
                pass
    except Exception:
        return []
    return entries[-limit:]


def _surreal_sql(sql: str) -> list[Any] | None:
    """Query host SurrealDB (out of sandbox). Returns result rows or None."""
    import base64
    import urllib.error
    import urllib.request

    base = os.environ.get("SURREALDB_URL") or os.environ.get("SURREALDB_HTTP_URL") or ""
    if not base or not base.startswith("http"):
        # host default when serving ontology UI on host
        if os.environ.get("GROK_PROJECT_DIR") or os.environ.get("CLOUD_AGENT_ROOT"):
            base = "http://127.0.0.1:8000"
        else:
            return None
    user = os.environ.get("SURREALDB_USER") or os.environ.get("SURREALDB_USERNAME") or "root"
    passwd = os.environ.get("SURREALDB_PASS") or os.environ.get("SURREALDB_PASSWORD") or "root"
    ns = os.environ.get("SURREALDB_NS") or os.environ.get("SURREALDB_NAMESPACE") or "main"
    db = os.environ.get("SURREALDB_DB") or os.environ.get("SURREALDB_DATABASE") or "main"
    auth = base64.b64encode(f"{user}:{passwd}".encode()).decode()
    req = urllib.request.Request(
        f"{base.rstrip('/')}/sql",
        data=sql.encode("utf-8"),
        method="POST",
        headers={
            "Content-Type": "text/plain",
            "Accept": "application/json",
            "Authorization": f"Basic {auth}",
            "surreal-ns": ns,
            "surreal-db": db,
            "NS": ns,
            "DB": db,
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        if isinstance(data, list) and data:
            first = data[0]
            if isinstance(first, dict) and "result" in first:
                r = first.get("result")
                return r if isinstance(r, list) else []
        return []
    except Exception:
        return None


def load_validation_calls(limit: int = 40) -> Dict[str, Any]:
    """Prefer host Surreal validation_call; fall back to JSONL mirror."""
    rows = _surreal_sql(
        f"SELECT * FROM validation_call ORDER BY at DESC LIMIT {max(1, min(limit, 100))};"
    )
    if rows is not None and len(rows) > 0:
        return {
            "ok": True,
            "source": "surreal",
            "count": len(rows),
            "entries": rows,
            "backend": "host-surreal",
        }
    for p in _session_jsonl_candidates("validation-calls.jsonl"):
        entries = _read_jsonl(p, limit)
        if entries:
            return {
                "ok": True,
                "source": "jsonl",
                "path": str(p),
                "count": len(entries),
                "entries": list(reversed(entries)),
                "backend": "jsonl-mirror",
            }
    return {
        "ok": True,
        "source": "empty",
        "count": 0,
        "entries": [],
        "note": "no validation_call rows — run tool_io_guard / px_validate_cascade with host Surreal",
        "surreal_attempted": rows is not None,
    }


def _default_guardrails_registry() -> list[Dict[str, Any]]:
    """Seed formal :7003 + any GUARDRAILS_EXTRA_PORTS / registered extras — no max of 1."""
    ports = [int(os.environ.get("GUARDRAILS_PORT", "7003"))]
    extra = os.environ.get("GUARDRAILS_PORTS") or os.environ.get("GUARDRAILS_EXTRA_PORTS") or ""
    for part in extra.replace(";", ",").split(","):
        part = part.strip()
        if not part:
            continue
        try:
            p = int(part)
            if p not in ports:
                ports.append(p)
        except ValueError:
            pass
    servers: list[Dict[str, Any]] = []
    for i, port in enumerate(ports):
        sid = "formal.guardrails.content" if i == 0 and port == 7003 else f"guardrails.instance.{port}"
        servers.append(
            {
                "id": sid,
                "name": sid,
                "kind": "formal_sandbox" if i == 0 else "guardrails_ai",
                "port": port,
                "url": f"http://127.0.0.1:{port}/health",
                "status": "unknown",
                "inSandbox": True,
                "note": f"Guardrails bind :{port}",
            }
        )
    # label-style Guardrails AI entries (remote validators)
    for name in ("ValidJson", "DetectPII", "RestrictToTopic", "ToxicLanguage"):
        servers.append(
            {
                "id": f"GuardrailsAI.{name}",
                "name": f"GuardrailsAI.{name}",
                "kind": "guardrails_ai",
                "status": "active",
                "inSandbox": False,
                "note": "Guardrails AI label; register more via POST /api/guardrails/register",
            }
        )
    return servers


def _guardrails_registry_path() -> Path | None:
    host = os.environ.get("GROK_PROJECT_DIR") or os.environ.get("CLOUD_AGENT_ROOT")
    if host:
        return Path(host) / ".px" / "session" / "guardrails-servers.json"
    for p in _session_jsonl_candidates("guardrails-servers.json"):
        return p
    return PX_ROOT / "session" / "guardrails-servers.json"


def load_guardrails_registry() -> list[Dict[str, Any]]:
    path = _guardrails_registry_path()
    if path and path.is_file():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if isinstance(data, dict) and isinstance(data.get("servers"), list):
                return [s for s in data["servers"] if isinstance(s, dict) and s.get("id")]
            if isinstance(data, list):
                return [s for s in data if isinstance(s, dict) and s.get("id")]
        except Exception:
            pass
    return _default_guardrails_registry()


def save_guardrails_registry(servers: list[Dict[str, Any]]) -> str | None:
    path = _guardrails_registry_path()
    if not path:
        return None
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            json.dumps(
                {"version": 1, "servers": servers, "updatedAt": datetime.now(timezone.utc).isoformat()},
                indent=2,
            ),
            encoding="utf-8",
        )
        return str(path)
    except Exception:
        return None


def list_guardrails_registry() -> Dict[str, Any]:
    servers = load_guardrails_registry()
    return {
        "ok": True,
        "count": len(servers),
        "servers": servers,
        "maxServers": os.environ.get("GUARDRAILS_MAX_SERVERS") or None,
        "note": "N Guardrails AI servers supported; no hard-coded maximum of 1",
    }


def register_guardrails_server(body: Dict[str, Any]) -> Dict[str, Any]:
    sid = str(body.get("id") or body.get("name") or "").strip()
    if not sid:
        return {"ok": False, "error": "id required"}
    max_raw = os.environ.get("GUARDRAILS_MAX_SERVERS")
    servers = load_guardrails_registry()
    if max_raw and max_raw not in ("0", "unlimited"):
        try:
            mx = int(max_raw)
            if mx > 0 and len(servers) >= mx and not any(s.get("id") == sid for s in servers):
                return {"ok": False, "error": f"GUARDRAILS_MAX_SERVERS={mx} reached", "count": len(servers)}
        except ValueError:
            pass
    port = body.get("port")
    try:
        port_i = int(port) if port is not None and str(port) != "" else None
    except (TypeError, ValueError):
        port_i = None
    entry = {
        "id": sid,
        "name": str(body.get("name") or sid),
        "kind": str(body.get("kind") or "guardrails_ai"),
        "port": port_i,
        "url": body.get("url")
        or (f"http://127.0.0.1:{port_i}/health" if port_i else None),
        "status": str(body.get("status") or "unknown"),
        "inSandbox": bool(body.get("inSandbox")) if body.get("inSandbox") is not None else bool(port_i),
        "note": body.get("note") or "registered via API",
    }
    replaced = False
    out: list[Dict[str, Any]] = []
    for s in servers:
        if s.get("id") == sid:
            out.append({**s, **entry})
            replaced = True
        else:
            out.append(s)
    if not replaced:
        out.append(entry)
    path = save_guardrails_registry(out)
    return {"ok": True, "server": entry, "count": len(out), "replaced": replaced, "path": path}


def remove_guardrails_server(server_id: str) -> Dict[str, Any]:
    sid = str(server_id or "").strip()
    if not sid:
        return {"ok": False, "error": "id required"}
    servers = load_guardrails_registry()
    next_s = [s for s in servers if s.get("id") != sid]
    if len(next_s) == len(servers):
        return {"ok": False, "error": f"not found: {sid}", "count": len(servers)}
    path = save_guardrails_registry(next_s)
    return {"ok": True, "removed": sid, "count": len(next_s), "servers": next_s, "path": path}


def _probe_one_url(url: str, timeout: float = 2.0) -> tuple[bool, Any, str | None]:
    import urllib.request

    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            body = resp.read().decode("utf-8", errors="replace")
            try:
                data = json.loads(body)
            except Exception:
                data = {"raw": body[:300]}
            return True, data, None
    except Exception as e:
        return False, None, str(e)


def probe_guardrails_health(
    server_id: str | None = None,
    port: str | int | None = None,
) -> Dict[str, Any]:
    """Probe one Guardrails instance by id or port; default formal :7003."""
    servers = load_guardrails_registry()
    target: Dict[str, Any] | None = None
    if server_id:
        target = next((s for s in servers if s.get("id") == server_id), None)
        if not target:
            return {
                "ok": False,
                "status": "unreachable",
                "id": server_id,
                "note": f"unknown server id {server_id}",
            }
    elif port is not None and str(port) != "":
        try:
            pi = int(port)
            target = next((s for s in servers if s.get("port") == pi), None) or {
                "id": f"guardrails.instance.{pi}",
                "port": pi,
                "url": f"http://127.0.0.1:{pi}/health",
            }
        except ValueError:
            target = None

    if target is None:
        # legacy single formal probe
        port_i = int(os.environ.get("GUARDRAILS_PORT", "7003"))
        target = next((s for s in servers if s.get("port") == port_i), None) or {
            "id": "formal.guardrails.content",
            "port": port_i,
            "url": f"http://127.0.0.1:{port_i}/health",
        }

    port_i = target.get("port")
    urls: list[str] = []
    if target.get("url"):
        urls.append(str(target["url"]))
    if port_i:
        urls.append(f"http://127.0.0.1:{port_i}/health")
        urls.append(f"http://127.0.0.1:{port_i}/")
    if not urls:
        # label-only Guardrails AI — no HTTP bind
        return {
            "ok": True,
            "status": "active",
            "id": target.get("id"),
            "service": "guardrails_ai_label",
            "note": "label-only entry (no port); treated as configured",
            "inSandbox": False,
        }

    last_err = None
    for u in urls:
        ok, data, err = _probe_one_url(u)
        if ok:
            return {
                "ok": True,
                "status": "up",
                "id": target.get("id"),
                "port": port_i,
                "service": (data.get("service") if isinstance(data, dict) else None) or "guardrails",
                "url": u,
                "body": data if isinstance(data, dict) else {"raw": str(data)[:200]},
                "hubNote": "Per-instance health; other servers in the set are independent.",
                "inSandbox": bool(target.get("inSandbox", True)),
            }
        last_err = err
    return {
        "ok": False,
        "status": "unreachable",
        "id": target.get("id"),
        "port": port_i,
        "service": "guardrails",
        "note": last_err or "unreachable",
        "hubNote": "This instance failed; other registered Guardrails servers are not cleared.",
        "inSandbox": bool(target.get("inSandbox", True)),
    }


def probe_all_guardrails_health() -> Dict[str, Any]:
    """Probe every registered server; one failure does not wipe the set."""
    servers = load_guardrails_registry()
    results: list[Dict[str, Any]] = []
    updated: list[Dict[str, Any]] = []
    for s in servers:
        h = probe_guardrails_health(server_id=str(s.get("id")))
        results.append(h)
        st = "active" if h.get("ok") else "unreachable"
        # label-only stay active when ok
        if h.get("service") == "guardrails_ai_label":
            st = "active"
        updated.append({**s, "status": st, "lastHealth": h.get("status"), "note": h.get("note") or s.get("note")})
    save_guardrails_registry(updated)
    return {
        "ok": True,
        "count": len(results),
        "results": results,
        "servers": updated,
        "unreachable": [r.get("id") for r in results if not r.get("ok")],
        "reachable": [r.get("id") for r in results if r.get("ok")],
    }


def load_endpoint_io(limit: int = 50) -> Dict[str, Any]:
    rows = _surreal_sql(
        f"SELECT * FROM endpoint_io ORDER BY at DESC LIMIT {max(1, min(limit, 100))};"
    )
    if rows is not None and len(rows) > 0:
        return {"ok": True, "source": "surreal", "count": len(rows), "entries": rows}
    for p in _session_jsonl_candidates("endpoint-io.jsonl"):
        entries = _read_jsonl(p, limit)
        if entries:
            return {
                "ok": True,
                "source": "jsonl",
                "path": str(p),
                "count": len(entries),
                "entries": list(reversed(entries)),
            }
    return {"ok": True, "source": "empty", "count": 0, "entries": []}


def _session_json_file(name: str) -> Path | None:
    for p in _session_jsonl_candidates(name):
        if p.is_file():
            return p
    return None


def load_ontology_overlay() -> Dict[str, Any]:
    """Surreal-backed node/edge color overlay (session file or empty)."""
    p = _session_json_file("ontology-overlay.json")
    if p:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("ok", True)
                data["path"] = str(p)
                return data
        except Exception as e:
            return {"ok": False, "error": str(e), "path": str(p)}
    # Prefer latest surreal snapshot if present
    rows = _surreal_sql("SELECT * FROM ontology_overlay ORDER BY generatedAt DESC LIMIT 1;")
    if rows:
        snap = rows[0] if isinstance(rows[0], dict) else {}
        return {
            "ok": True,
            "source": "surreal",
            "version": 1,
            "generatedAt": snap.get("generatedAt"),
            "nodes": snap.get("nodes") or {},
            "edges": snap.get("edges") or {},
            "summary": snap.get("summary") or {},
            "note": "from Surreal ontology_overlay snapshot",
        }
    return {
        "ok": True,
        "version": 1,
        "source": "empty",
        "generatedAt": None,
        "nodes": {},
        "edges": {},
        "summary": {
            "pass": 0,
            "fail": 0,
            "mixed": 0,
            "stale": 0,
            "unknown": 0,
            "totalNodes": 0,
            "totalEdges": 0,
            "callCount": 0,
        },
        "note": "no ontology-overlay.json — run validation cascade / refreshOntologyOverlay on host",
    }


def load_midspiral_status() -> Dict[str, Any]:
    p = _session_json_file("midspiral-status.json")
    if p:
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
            if isinstance(data, dict):
                data.setdefault("ok", True)
                data["path"] = str(p)
                return data
        except Exception as e:
            return {"ok": False, "error": str(e), "path": str(p)}
    # Static fallback catalog (honest unavailable when session not written)
    tools = [
        {
            "id": "lemmafit",
            "name": "lemmafit",
            "ready": False,
            "note": "refresh host midspiral-bridge",
            "installHint": "npm install -g lemmafit",
        },
        {
            "id": "lemmascript",
            "name": "LemmaScript",
            "ready": False,
            "note": "refresh host midspiral-bridge",
            "installHint": "npm install -g lemmascript",
        },
        {
            "id": "lemmacore",
            "name": "lemmacore",
            "ready": False,
            "note": "Coming soon",
            "installHint": "VS Code extension / Midspiral lemmacore",
        },
        {
            "id": "claimcheck",
            "name": "claimcheck",
            "ready": False,
            "note": "refresh host midspiral-bridge",
            "installHint": "npm install -g claimcheck",
        },
        {
            "id": "dafny-replay",
            "name": "dafny-replay",
            "ready": False,
            "note": "set DAFNY_REPLAY_PATH or install dafny",
        },
        {
            "id": "dafny2js",
            "name": "dafny2js",
            "ready": False,
            "note": "set DAFNY2JS_PATH",
        },
    ]
    return {
        "ok": True,
        "source": "empty",
        "generatedAt": None,
        "tools": tools,
        "readyCount": 0,
        "total": 6,
        "allowExec": os.environ.get("MIDSPIRAL_ALLOW_EXEC") == "1",
        "note": "no midspiral-status.json — run getMidspiralStatus() on host",
    }


def load_midspiral_runs(limit: int = 30) -> Dict[str, Any]:
    for p in _session_jsonl_candidates("midspiral-runs.jsonl"):
        entries = _read_jsonl(p, limit)
        if entries:
            return {
                "ok": True,
                "path": str(p),
                "count": len(entries),
                "entries": list(reversed(entries)),
            }
    return {"ok": True, "count": 0, "entries": [], "note": "no midspiral runs yet"}


def _default_budget_ledger() -> Dict[str, Any]:
    prepaid = float(os.environ.get("ONTOLOGY_PREPAID_USD") or "10")
    rate = float(os.environ.get("ONTOLOGY_SANDBOX_RATE_USD_PER_SEC") or "0.0004")
    mcp_rate = float(os.environ.get("ONTOLOGY_MCP_RATE_USD_PER_CALL") or "0.0015")
    auto_raw = os.environ.get("DAYTONA_AUTO_STOP_MINUTES") or "5"
    try:
        auto_stop = max(1, min(5, int(float(auto_raw))))
    except Exception:
        auto_stop = 5
    return {
        "prepaidUsd": prepaid if prepaid > 0 else 10.0,
        "rateUsdPerSec": rate if rate >= 0 else 0.0004,
        "mcpRateUsdPerCall": mcp_rate if mcp_rate >= 0 else 0.0015,
        "mcpCallCount": 0,
        "startedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "autoStopMinutes": auto_stop,
        "sandboxId": os.environ.get("SANDBOX_ID") or os.environ.get("DAYTONA_SANDBOX_ID"),
        "provider": os.environ.get("VERIFIER_SANDBOX_PROVIDER") or "local",
        "currency": "USD",
        "source": "env" if os.environ.get("ONTOLOGY_PREPAID_USD") else "default",
        "prepaid": True,
    }


def _budget_session_paths() -> list[Path]:
    return _session_jsonl_candidates("ontology-budget.json")


def load_or_seed_budget() -> Dict[str, Any]:
    """Load prepaid ledger; seed session file on first hit."""
    for p in _budget_session_paths():
        if p.is_file():
            try:
                data = json.loads(p.read_text(encoding="utf-8"))
                if isinstance(data, dict) and data.get("startedAt"):
                    data.setdefault("source", "session")
                    data["path"] = str(p)
                    return data
            except Exception:
                pass
    ledger = _default_budget_ledger()
    # Prefer host project session for write
    host = os.environ.get("GROK_PROJECT_DIR") or os.environ.get("CLOUD_AGENT_ROOT")
    write_path = (
        Path(host) / ".px" / "session" / "ontology-budget.json"
        if host
        else (PX_ROOT / "session" / "ontology-budget.json")
    )
    try:
        write_path.parent.mkdir(parents=True, exist_ok=True)
        write_path.write_text(json.dumps(ledger, indent=2), encoding="utf-8")
        ledger["path"] = str(write_path)
        ledger["source"] = "session"
    except Exception as e:
        ledger["writeError"] = str(e)
    return ledger


def compute_budget_snapshot(ledger: Dict[str, Any]) -> Dict[str, Any]:
    prepaid = float(ledger.get("prepaidUsd") or ledger.get("creditsPrepaid") or 10)
    if prepaid <= 0:
        prepaid = 10.0
    rate = float(ledger.get("rateUsdPerSec") or 0.0004)
    if rate < 0:
        rate = 0.0
    mcp_rate = float(ledger.get("mcpRateUsdPerCall") or 0.0015)
    mcp_count = int(ledger.get("mcpCallCount") or 0)
    started = str(ledger.get("startedAt") or "")
    try:
        # support Z suffix
        started_dt = datetime.fromisoformat(started.replace("Z", "+00:00"))
        if started_dt.tzinfo is None:
            started_dt = started_dt.replace(tzinfo=timezone.utc)
        elapsed = max(0.0, (datetime.now(timezone.utc) - started_dt).total_seconds())
    except Exception:
        elapsed = 0.0
    sandbox_burn = elapsed * rate
    mcp_burn = max(0, mcp_count) * mcp_rate
    burn = sandbox_burn + mcp_burn
    remaining = max(0.0, prepaid - burn)
    remaining_pct = max(0.0, min(100.0, (remaining / prepaid) * 100.0))
    exhausted = remaining <= 0
    warn = (not exhausted) and remaining_pct < 20.0
    auto_stop = ledger.get("autoStopMinutes")
    auto_left = None
    try:
        if auto_stop is not None:
            auto_left = max(0.0, float(auto_stop) * 60.0 - elapsed)
    except Exception:
        auto_left = None

    def fmt_dur(sec: float) -> str:
        s = max(0, int(sec))
        h, rem = divmod(s, 3600)
        m, sec2 = divmod(rem, 60)
        return f"{h:02d}:{m:02d}:{sec2:02d}"

    return {
        "ok": True,
        "prepaid": True,
        "creditsRemaining": round(remaining, 6),
        "creditsPrepaid": prepaid,
        "prepaidUsd": prepaid,
        "burnUsd": round(burn, 6),
        "sandboxBurnUsd": round(sandbox_burn, 6),
        "mcpBurnUsd": round(mcp_burn, 6),
        "mcpCallCount": mcp_count,
        "elapsedSec": round(elapsed, 3),
        "rateUsdPerSec": rate,
        "mcpRateUsdPerCall": mcp_rate,
        "remainingPct": round(remaining_pct, 3),
        "exhausted": exhausted,
        "warn": warn,
        "startedAt": started,
        "autoStopMinutes": auto_stop,
        "autoStopRemainingSec": auto_left,
        "sandboxId": ledger.get("sandboxId"),
        "provider": ledger.get("provider"),
        "tier": "sandbox",
        "currency": "USD",
        "fmtRuntime": fmt_dur(elapsed),
        "fmtBurn": f"${burn:.4f}",
        "fmtRemaining": f"${remaining:.2f}",
        "fmtPrepaid": f"${prepaid:.2f}",
        "source": ledger.get("source") or "default",
        "path": ledger.get("path"),
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }


def load_usage_credits() -> Dict[str, Any]:
    """Prepaid credits countdown for ontology bottom status bar (AUI-compatible fields)."""
    ledger = load_or_seed_budget()
    return compute_budget_snapshot(ledger)


def run_midspiral_via_host(body: Dict[str, Any]) -> Dict[str, Any]:
    """
    POST /api/midspiral/run — only when MIDSPIRAL_ALLOW_EXEC=1.
    Spawns host `npx tsx` bridge when CLOUD_AGENT_ROOT / GROK_PROJECT_DIR set.
    """
    if os.environ.get("MIDSPIRAL_ALLOW_EXEC") != "1":
        return {
            "ok": False,
            "status": 501,
            "error": "MIDSPIRAL_ALLOW_EXEC is not set — refresh status from host midspiral-bridge or enable exec",
            "hint": "export MIDSPIRAL_ALLOW_EXEC=1 and restart ontology-ui-server on the host",
        }
    root = os.environ.get("GROK_PROJECT_DIR") or os.environ.get("CLOUD_AGENT_ROOT")
    if not root:
        return {
            "ok": False,
            "status": 501,
            "error": "GROK_PROJECT_DIR / CLOUD_AGENT_ROOT not set — cannot spawn midspiral-bridge",
        }
    tool = str(body.get("tool") or "claimcheck")
    args = body.get("args") if isinstance(body.get("args"), dict) else body
    # Write request for host script
    import subprocess
    import tempfile

    req_path = Path(tempfile.mkstemp(prefix="ms-req-", suffix=".json")[1])
    out_path = Path(tempfile.mkstemp(prefix="ms-out-", suffix=".json")[1])
    try:
        req_path.write_text(
            json.dumps({"tool": tool, "args": args}),
            encoding="utf-8",
        )
        script = f"""
import {{ runMidspiralTool, getMidspiralStatus }} from '{root}/src/verification-sandbox/midspiral-bridge.ts';
import fs from 'fs';
const req = JSON.parse(fs.readFileSync({json.dumps(str(req_path))}, 'utf8'));
const rec = await runMidspiralTool(req.tool, req.args || {{}}, {{ allowExec: true }});
getMidspiralStatus({{ write: true }});
fs.writeFileSync({json.dumps(str(out_path))}, JSON.stringify(rec, null, 2));
"""
        r = subprocess.run(
            ["npx", "tsx", "-e", script],
            cwd=root,
            capture_output=True,
            text=True,
            timeout=180,
            env={**os.environ, "MIDSPIRAL_ALLOW_EXEC": "1"},
        )
        if out_path.is_file() and out_path.stat().st_size > 2:
            try:
                return {"ok": True, "run": json.loads(out_path.read_text(encoding="utf-8")), "stderr": r.stderr[-1000:]}
            except Exception as e:
                return {"ok": False, "error": str(e), "stderr": r.stderr[-2000:], "stdout": r.stdout[-1000:]}
        return {
            "ok": False,
            "error": "midspiral bridge produced no output",
            "code": r.returncode,
            "stderr": (r.stderr or "")[-2000:],
            "stdout": (r.stdout or "")[-1000:],
        }
    except Exception as e:
        return {"ok": False, "error": str(e)}
    finally:
        try:
            req_path.unlink(missing_ok=True)
            out_path.unlink(missing_ok=True)
        except Exception:
            pass


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--ui-dir", default=str(UI_DIR))
    args = ap.parse_args()
    ui = Path(args.ui_dir)
    ui.mkdir(parents=True, exist_ok=True)
    # ensure index exists
    if not (ui / "index.html").is_file():
        (ui / "index.html").write_text(
            "<html><body><h1>Ontology UI missing index.html</h1></body></html>"
        )
    Handler.directory = str(ui)  # type: ignore[attr-defined]
    httpd = ThreadingHTTPServer(("0.0.0.0", args.port), Handler)
    print(
        json.dumps(
            {
                "ready": True,
                "service": "ontology-ui",
                "port": args.port,
                "uiDir": str(ui),
                "stateFiles": [str(p) for p in STATE_CANDIDATES],
            }
        ),
        flush=True,
    )
    httpd.serve_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
