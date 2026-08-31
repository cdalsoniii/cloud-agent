#!/usr/bin/env python3
"""
In-sandbox SHACL HTTP server (port 7004 by default).

Serves LinkML-generated shapes uploaded under SHACL_SHAPES_DIR
(default /opt/verifier/px/generated) and validates JSON instances via pySHACL.

Endpoints:
  GET  /health
  GET  /shapes?pack=verifier-fleet
  POST /validate  { data, pack?, className?, shapesPath? }
  POST /jsonschema { data, pack? }  — optional JSON Schema gate
  POST /reload    re-scan shapes dir; optional rebuild from LinkML
  POST /rebuild   LinkML YAML → gen-shacl (when gen-shacl/linkml available)
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, urlparse

NS = "https://midspiral.dev/ontology/verifier-fleet/"
NS_SKYDIO = "https://example.org/skydio/"

_DEFAULT_ROOT = os.path.expanduser(os.environ.get("REMOTE_VERIFIER_ROOT", "~/verifier"))
SHAPES_DIR = Path(os.environ.get("SHACL_SHAPES_DIR", f"{_DEFAULT_ROOT}/px/generated"))
PX_ROOT = Path(os.environ.get("PX_REMOTE_ROOT", f"{_DEFAULT_ROOT}/px"))
LINKML_DIR = Path(os.environ.get("SHACL_LINKML_DIR", str(PX_ROOT / "linkml")))
PORT = int(os.environ.get("SHACL_PORT", "7004"))
PACK_TO_FILE = {
    "verifier-fleet": "verifier-fleet.shacl.ttl",
    "skydio": "skydio.shacl.ttl",
}
PACK_TO_SCHEMA = {
    "verifier-fleet": "verifier-fleet.schema.json",
    "skydio": "skydio.schema.json",
}
PACK_TO_META = {
    "verifier-fleet": ("verifiers", "verifier-metamodel.linkml.yaml", "VerifierFleet"),
    "skydio": ("skydio", "skydio-ops.linkml.yaml", "IncidentPostmortemReport"),
}


def camel_to_snake(name: str) -> str:
    out = []
    for i, c in enumerate(name):
        if c.isupper() and i > 0:
            out.append("_")
        out.append(c.lower())
    return "".join(out)


def norm_key(k: str) -> str:
    if "_" in k:
        return k
    return camel_to_snake(k)


def lit_ttl(v: Any) -> str:
    if isinstance(v, bool):
        return f'"{str(v).lower()}"^^<http://www.w3.org/2001/XMLSchema#boolean>'
    if isinstance(v, int) and not isinstance(v, bool):
        return f'"{v}"^^<http://www.w3.org/2001/XMLSchema#integer>'
    if isinstance(v, float):
        return f'"{v}"^^<http://www.w3.org/2001/XMLSchema#float>'
    s = str(v).replace("\\", "\\\\").replace('"', '\\"').replace("\n", "\\n")
    return f'"{s}"'


def json_to_ttl_generic(
    data: Dict[str, Any],
    class_name: str,
    ns: str,
    prefix: str = "sdo",
) -> str:
    lines: List[str] = [
        f"@prefix {prefix}: <{ns}> .",
        "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
        "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
        "",
    ]
    root = f"{prefix}:inst_{uuid.uuid4().hex[:10]}"
    lines.append(f"{root} a {prefix}:{class_name} .")
    d = {norm_key(k): v for k, v in data.items()}
    for key, val in d.items():
        if val is None:
            continue
        if isinstance(val, list):
            for item in val:
                if isinstance(item, (str, int, float, bool)):
                    lines.append(f"{root} {prefix}:{key} {lit_ttl(item)} .")
                elif isinstance(item, dict):
                    lines.append(f"{root} {prefix}:{key} {lit_ttl(json.dumps(item))} .")
        elif isinstance(val, dict):
            lines.append(f"{root} {prefix}:{key} {lit_ttl(json.dumps(val))} .")
        else:
            if key.endswith("_id") or key in ("report_id", "incident_id", "fleet_id"):
                lines.append(f"{root} {prefix}:{key} {lit_ttl(str(val))} .")
            else:
                lines.append(f"{root} {prefix}:{key} {lit_ttl(val)} .")
    return "\n".join(lines) + "\n"


def json_to_ttl(
    data: Dict[str, Any],
    class_name: str = "VerifierFleet",
    pack: str = "verifier-fleet",
) -> str:
    if pack == "skydio" or class_name not in ("VerifierFleet",):
        return json_to_ttl_generic(data, class_name=class_name, ns=NS_SKYDIO, prefix="sdo")

    lines: List[str] = [
        f"@prefix verifier: <{NS}> .",
        "@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .",
        "@prefix xsd: <http://www.w3.org/2001/XMLSchema#> .",
        "",
    ]

    def node_id(prefix: str) -> str:
        return f"verifier:{prefix}_{uuid.uuid4().hex[:10]}"

    root = node_id("fleet")
    lines.append(f"{root} a verifier:{class_name} .")
    d = {norm_key(k): v for k, v in data.items()}

    for key in ("fleet_id", "revision", "environment", "compliance_tier"):
        if key in d and d[key] is not None:
            lines.append(f"{root} verifier:{key} {lit_ttl(str(d[key]))} .")

    verifiers = d.get("verifiers") or []
    if not isinstance(verifiers, list):
        verifiers = []

    for i, v in enumerate(verifiers):
        if not isinstance(v, dict):
            continue
        vv = {norm_key(k): val for k, val in v.items()}
        vid = vv.get("verifier_id") or f"v{i}"
        safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in str(vid))
        vnode = f"verifier:inst_{safe}"
        lines.append(f"{root} verifier:verifiers {vnode} .")
        lines.append(f"{vnode} a verifier:Verifier .")
        for key in (
            "verifier_id",
            "backend",
            "kind",
            "name",
            "description",
            "order",
            "match_mode",
            "blocking",
            "enabled",
            "timeout_ms",
            "input_schema",
            "output_schema",
        ):
            if key in vv and vv[key] is not None:
                val = vv[key]
                if key in ("input_schema", "output_schema") and not isinstance(val, str):
                    val = json.dumps(val)
                if key in ("verifier_id", "backend", "kind", "name", "description", "match_mode"):
                    val = str(val)
                lines.append(f"{vnode} verifier:{key} {lit_ttl(val)} .")
        tags = vv.get("tags") or []
        if isinstance(tags, list):
            for t in tags:
                lines.append(f"{vnode} verifier:tags {lit_ttl(t)} .")
        handler = vv.get("handler")
        if isinstance(handler, dict):
            hh = {norm_key(k): val for k, val in handler.items()}
            hnode = f"verifier:handler_{safe}"
            lines.append(f"{vnode} verifier:handler {hnode} .")
            lines.append(f"{hnode} a verifier:VerifierHandler .")
            for key in (
                "service",
                "transport",
                "endpoint",
                "opencode_tool",
                "sandbox_id",
                "async_ok",
            ):
                if key in hh and hh[key] is not None:
                    lines.append(f"{hnode} verifier:{key} {lit_ttl(hh[key])} .")

    return "\n".join(lines) + "\n"


def list_shapes(shapes_dir: Path) -> List[Dict[str, str]]:
    if not shapes_dir.is_dir():
        return []
    out: List[Dict[str, str]] = []
    for p in sorted(shapes_dir.glob("*.shacl.ttl")):
        out.append({"name": p.name, "path": str(p), "bytes": str(p.stat().st_size)})
    for p in sorted(shapes_dir.glob("*.ttl")):
        if p.name.endswith(".shacl.ttl"):
            continue
        out.append({"name": p.name, "path": str(p), "bytes": str(p.stat().st_size)})
    return out


def find_gen_shacl() -> Optional[str]:
    for name in ("gen-shacl",):
        p = shutil.which(name)
        if p:
            return p
    for cand in (
        "/opt/anaconda3/bin/gen-shacl",
        "/usr/local/bin/gen-shacl",
        str(Path.home() / "anaconda3/bin/gen-shacl"),
        str(Path.home() / "miniconda3/bin/gen-shacl"),
    ):
        if Path(cand).is_file() and os.access(cand, os.X_OK):
            return cand
    # python -m linkml.generators.shaclgen
    try:
        r = subprocess.run(
            [sys.executable, "-c", "import linkml.generators.shaclgen"],
            capture_output=True,
            timeout=10,
        )
        if r.returncode == 0:
            return "python-module"
    except Exception:
        pass
    return None


def normalize_linkml_yaml(src: Path, dst: Path) -> None:
    """Mirror generate-linkml-artifacts.sh normalize so gen-shacl accepts the schema."""
    text = src.read_text(encoding="utf-8")
    if "xsd:" not in text:
        text = text.replace(
            "  schema: http://schema.org/\n",
            "  schema: http://schema.org/\n  xsd: http://www.w3.org/2001/XMLSchema#\n",
        )
    if "types:" not in text:
        types = """
types:
  string:
    uri: xsd:string
    base: str
  integer:
    uri: xsd:integer
    base: int
  boolean:
    uri: xsd:boolean
    base: Bool
  float:
    uri: xsd:float
    base: float
"""
        text = text.replace("default_range: string\n", "default_range: string\n" + types)
    text = text.replace("range: AnyType", "range: string")
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(text, encoding="utf-8")


def rebuild_from_linkml(
    shapes_dir: Path,
    linkml_dir: Path = LINKML_DIR,
    packs: Optional[List[str]] = None,
) -> Dict[str, Any]:
    """
    Convert uploaded LinkML YAML → SHACL Turtle via gen-shacl when available.
    Falls back to reporting pre-generated shapes if converter missing.
    """
    shapes_dir.mkdir(parents=True, exist_ok=True)
    gen = find_gen_shacl()
    selected = packs or list(PACK_TO_META.keys())
    results: List[Dict[str, Any]] = []
    rebuilt = 0

    for pack in selected:
        meta_info = PACK_TO_META.get(pack)
        if not meta_info:
            results.append({"pack": pack, "ok": False, "error": "unknown pack"})
            continue
        sub, meta_name, _top = meta_info
        meta_path = linkml_dir / sub / meta_name
        if not meta_path.is_file():
            # also accept flat layout
            alt = linkml_dir / meta_name
            if alt.is_file():
                meta_path = alt
            else:
                results.append(
                    {
                        "pack": pack,
                        "ok": False,
                        "error": f"linkml meta missing: {meta_path}",
                        "rebuilt": False,
                    }
                )
                continue

        out_ttl = shapes_dir / PACK_TO_FILE.get(pack, f"{pack}.shacl.ttl")
        if not gen:
            results.append(
                {
                    "pack": pack,
                    "ok": out_ttl.is_file(),
                    "rebuilt": False,
                    "mode": "pre-generated",
                    "shapesPath": str(out_ttl) if out_ttl.is_file() else None,
                    "error": None
                    if out_ttl.is_file()
                    else "gen-shacl unavailable and no pre-generated shapes",
                }
            )
            continue

        try:
            gen_yaml = shapes_dir / f"{pack}.gen.yaml"
            normalize_linkml_yaml(meta_path, gen_yaml)
            if gen == "python-module":
                cmd = [
                    sys.executable,
                    "-c",
                    (
                        "from linkml.generators.shaclgen import ShaclGenerator; "
                        f"print(ShaclGenerator(r'{gen_yaml}').serialize())"
                    ),
                ]
            else:
                cmd = [gen, str(gen_yaml)]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if r.returncode != 0 or not (r.stdout or "").strip():
                # still ok if pre-generated shapes exist
                results.append(
                    {
                        "pack": pack,
                        "ok": out_ttl.is_file(),
                        "rebuilt": False,
                        "mode": "pre-generated-fallback" if out_ttl.is_file() else "error",
                        "error": (r.stderr or r.stdout or "gen-shacl failed")[:800],
                        "shapesPath": str(out_ttl) if out_ttl.is_file() else None,
                    }
                )
                continue
            out_ttl.write_text(r.stdout)
            rebuilt += 1
            results.append(
                {
                    "pack": pack,
                    "ok": True,
                    "rebuilt": True,
                    "mode": "gen-shacl",
                    "shapesPath": str(out_ttl),
                    "bytes": out_ttl.stat().st_size,
                }
            )
        except Exception as e:
            results.append(
                {
                    "pack": pack,
                    "ok": out_ttl.is_file(),
                    "rebuilt": False,
                    "error": str(e),
                    "shapesPath": str(out_ttl) if out_ttl.is_file() else None,
                }
            )

    return {
        "ok": any(x.get("ok") for x in results) or any(
            (shapes_dir / PACK_TO_FILE[p]).is_file() for p in selected if p in PACK_TO_FILE
        ),
        "rebuiltCount": rebuilt,
        "genShacl": gen or None,
        "linkmlDir": str(linkml_dir),
        "shapesDir": str(shapes_dir),
        "packs": results,
        "shapes": list_shapes(shapes_dir),
    }


def validate_json_schema(data: Dict[str, Any], pack: str, shapes_dir: Path) -> Dict[str, Any]:
    fname = PACK_TO_SCHEMA.get(pack, f"{pack}.schema.json")
    schema_path = shapes_dir / fname
    if not schema_path.is_file():
        return {
            "ok": False,
            "engine": "jsonschema",
            "error": f"schema missing: {schema_path}",
            "violations": [
                {
                    "id": "jsonschema-missing",
                    "severity": "blocking",
                    "title": "JSON Schema missing",
                    "reason": str(schema_path),
                }
            ],
        }
    try:
        schema = json.loads(schema_path.read_text(encoding="utf-8"))
    except Exception as e:
        return {
            "ok": False,
            "engine": "jsonschema",
            "error": str(e),
            "violations": [
                {
                    "id": "jsonschema-parse",
                    "severity": "blocking",
                    "title": "Schema parse error",
                    "reason": str(e),
                }
            ],
        }

    try:
        import jsonschema  # type: ignore

        jsonschema.validate(instance=data, schema=schema)
        return {
            "ok": True,
            "engine": "jsonschema",
            "schemaPath": str(schema_path),
            "violations": [],
        }
    except ImportError:
        # minimal required-field check
        required = schema.get("required") or []
        missing = [k for k in required if k not in data]
        if missing:
            return {
                "ok": False,
                "engine": "jsonschema-lite",
                "schemaPath": str(schema_path),
                "violations": [
                    {
                        "id": "jsonschema-required",
                        "severity": "blocking",
                        "title": "Missing required fields",
                        "reason": ", ".join(missing),
                    }
                ],
            }
        return {
            "ok": True,
            "engine": "jsonschema-lite",
            "schemaPath": str(schema_path),
            "violations": [],
            "note": "jsonschema package not installed; required-keys only",
        }
    except Exception as e:
        return {
            "ok": False,
            "engine": "jsonschema",
            "schemaPath": str(schema_path),
            "error": str(e),
            "violations": [
                {
                    "id": "jsonschema-fail",
                    "severity": "blocking",
                    "title": "JSON Schema violation",
                    "reason": str(e)[:800],
                }
            ],
        }


def resolve_shapes(shapes_dir: Path, pack: str, shapes_path: Optional[str] = None) -> Path:
    if shapes_path:
        p = Path(shapes_path)
        if p.is_file():
            return p
        cand = shapes_dir / shapes_path
        if cand.is_file():
            return cand
        raise FileNotFoundError(f"shapes not found: {shapes_path}")
    fname = PACK_TO_FILE.get(pack, f"{pack}.shacl.ttl")
    p = shapes_dir / fname
    if p.is_file():
        return p
    # fallback: any *pack*.shacl.ttl
    for alt in shapes_dir.glob(f"*{pack}*.shacl.ttl"):
        return alt
    for alt in shapes_dir.glob("*.shacl.ttl"):
        return alt
    raise FileNotFoundError(f"no shapes for pack={pack} under {shapes_dir}")


def run_validate(
    shapes_path: Path,
    data: Dict[str, Any],
    pack: str,
    class_name: str,
) -> Dict[str, Any]:
    try:
        from pyshacl import validate as pyshacl_validate
        from rdflib import Graph
    except ImportError as e:
        return {
            "ok": False,
            "conforms": False,
            "engine": "unavailable",
            "error": f"pyshacl/rdflib not installed: {e}",
            "violations": [
                {
                    "id": "shacl-engine-missing",
                    "severity": "blocking",
                    "title": "SHACL engine missing",
                    "reason": str(e),
                }
            ],
            "shapesPath": str(shapes_path),
        }

    if pack == "skydio" and class_name == "VerifierFleet":
        class_name = "IncidentPostmortemReport"

    data_ttl = json_to_ttl(data, class_name=class_name, pack=pack)
    data_g = Graph()
    data_g.parse(data=data_ttl, format="turtle")
    shapes_g = Graph()
    shapes_g.parse(str(shapes_path), format="turtle")

    conforms, _results_graph, results_text = pyshacl_validate(
        data_g,
        shacl_graph=shapes_g,
        inference="rdfs",
        abort_on_first=False,
        meta_shacl=False,
        advanced=True,
        js=False,
        debug=False,
    )

    violations: List[Dict[str, str]] = []
    for line in (results_text or "").splitlines():
        line = line.strip()
        if line.startswith("Constraint Violation") or "Violation" in line:
            violations.append(
                {
                    "id": f"shacl-v{len(violations)}",
                    "severity": "blocking",
                    "title": "SHACL constraint violation",
                    "reason": line[:500],
                }
            )
        elif line and violations and not line.startswith("Conforms"):
            if len(violations[-1].get("reason", "")) < 800:
                violations[-1]["reason"] += " " + line

    if not conforms and not violations:
        violations.append(
            {
                "id": "shacl-nonconformant",
                "severity": "blocking",
                "title": "SHACL non-conformant",
                "reason": (results_text or "data does not conform")[:800],
            }
        )

    return {
        "ok": bool(conforms),
        "conforms": bool(conforms),
        "engine": "pyshacl",
        "violations": violations[:50],
        "resultsText": (results_text or "")[:4000],
        "shapesPath": str(shapes_path),
        "dataTurtlePreview": data_ttl[:2000],
    }


class ShaclHandler(BaseHTTPRequestHandler):
    shapes_dir: Path = SHAPES_DIR

    def log_message(self, *_args: Any) -> None:
        pass

    def _send(self, code: int, obj: Any, content_type: str = "application/json") -> None:
        if isinstance(obj, (dict, list)):
            body = json.dumps(obj).encode()
        elif isinstance(obj, str):
            body = obj.encode()
        else:
            body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> Dict[str, Any]:
        n = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(n) if n else b"{}"
        try:
            data = json.loads(raw.decode() or "{}")
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        qs = parse_qs(parsed.query)

        if path in ("/health", "/"):
            shapes = list_shapes(self.shapes_dir)
            engine = "pyshacl"
            try:
                import pyshacl  # noqa: F401
                import rdflib  # noqa: F401
            except ImportError:
                engine = "unavailable"
            self._send(
                200,
                {
                    "ok": True,
                    "service": "shacl",
                    "port": self.server.server_address[1],
                    "engine": engine,
                    "shapesDir": str(self.shapes_dir),
                    "linkmlDir": str(LINKML_DIR),
                    "genShacl": find_gen_shacl() or None,
                    "shapes": shapes,
                    "endpoints": [
                        "/health",
                        "/shapes",
                        "/validate",
                        "/jsonschema",
                        "/reload",
                        "/rebuild",
                    ],
                },
            )
            return

        if path == "/shapes":
            pack = (qs.get("pack") or ["verifier-fleet"])[0]
            try:
                sp = resolve_shapes(self.shapes_dir, pack)
                if (qs.get("format") or ["meta"])[0] == "ttl":
                    self._send(200, sp.read_text(encoding="utf-8"), "text/turtle")
                    return
                self._send(
                    200,
                    {
                        "ok": True,
                        "pack": pack,
                        "path": str(sp),
                        "bytes": sp.stat().st_size,
                        "shapes": list_shapes(self.shapes_dir),
                    },
                )
            except FileNotFoundError as e:
                self._send(404, {"ok": False, "error": str(e)})
            return

        self._send(404, {"ok": False, "error": "not found"})

    def do_POST(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        path = parsed.path.rstrip("/") or "/"
        body = self._read_json()

        if path == "/reload":
            rebuild = bool(body.get("rebuild") or body.get("regenerate"))
            report: Dict[str, Any] = {
                "ok": True,
                "shapes": list_shapes(self.shapes_dir),
                "shapesDir": str(self.shapes_dir),
            }
            if rebuild:
                report["rebuild"] = rebuild_from_linkml(self.shapes_dir, LINKML_DIR)
                report["shapes"] = list_shapes(self.shapes_dir)
            self._send(200, report)
            return

        if path == "/rebuild":
            packs = body.get("packs")
            if isinstance(packs, str):
                packs = [packs]
            if packs is not None and not isinstance(packs, list):
                packs = None
            report = rebuild_from_linkml(
                self.shapes_dir,
                LINKML_DIR,
                packs=[str(p) for p in packs] if packs else None,
            )
            self._send(200 if report.get("ok") else 422, report)
            return

        if path == "/jsonschema":
            pack = str(body.get("pack") or "verifier-fleet")
            data = body.get("data")
            if data is None and isinstance(body.get("payload"), dict):
                data = body["payload"]
            if not isinstance(data, dict):
                self._send(
                    422,
                    {
                        "ok": False,
                        "engine": "jsonschema",
                        "error": "data must be a JSON object",
                        "violations": [
                            {
                                "id": "jsonschema-invalid-payload",
                                "severity": "blocking",
                                "title": "Invalid payload",
                                "reason": "expected JSON object in field data",
                            }
                        ],
                    },
                )
                return
            report = validate_json_schema(data, pack, self.shapes_dir)
            self._send(200 if report.get("ok") else 422, report)
            return

        if path == "/validate":
            pack = str(body.get("pack") or "verifier-fleet")
            class_name = str(body.get("className") or body.get("class_name") or "VerifierFleet")
            shapes_override = body.get("shapesPath") or body.get("shapes_path")
            data = body.get("data")
            if data is None and isinstance(body.get("payload"), dict):
                data = body["payload"]
            if data is None and isinstance(body.get("instance"), dict):
                data = body["instance"]

            if not isinstance(data, dict):
                self._send(
                    422,
                    {
                        "ok": False,
                        "conforms": False,
                        "engine": "pyshacl",
                        "error": "data must be a JSON object",
                        "violations": [
                            {
                                "id": "shacl-invalid-payload",
                                "severity": "blocking",
                                "title": "Invalid payload",
                                "reason": "SHACL validation expects a JSON object in field 'data'",
                            }
                        ],
                    },
                )
                return

            try:
                shapes_path = resolve_shapes(
                    self.shapes_dir, pack, str(shapes_override) if shapes_override else None
                )
            except FileNotFoundError as e:
                self._send(
                    422,
                    {
                        "ok": False,
                        "conforms": False,
                        "engine": "pyshacl",
                        "error": str(e),
                        "violations": [
                            {
                                "id": "shacl-missing-shapes",
                                "severity": "blocking",
                                "title": "SHACL shapes missing",
                                "reason": str(e),
                            }
                        ],
                    },
                )
                return

            report = run_validate(shapes_path, data, pack=pack, class_name=class_name)
            code = 200 if report.get("conforms") else 422
            self._send(code, report)
            return

        self._send(404, {"ok": False, "error": "not found"})


def serve(port: int, shapes_dir: Path) -> None:
    ShaclHandler.shapes_dir = shapes_dir
    httpd = ThreadingHTTPServer(("0.0.0.0", port), ShaclHandler)
    print(
        json.dumps(
            {
                "ready": True,
                "service": "shacl",
                "port": port,
                "shapesDir": str(shapes_dir),
                "shapes": list_shapes(shapes_dir),
            }
        ),
        flush=True,
    )
    httpd.serve_forever()


def main() -> int:
    ap = argparse.ArgumentParser(description="In-sandbox SHACL HTTP server")
    ap.add_argument("--port", type=int, default=PORT)
    ap.add_argument("--shapes-dir", default=str(SHAPES_DIR))
    args = ap.parse_args()
    shapes_dir = Path(args.shapes_dir)
    shapes_dir.mkdir(parents=True, exist_ok=True)
    serve(args.port, shapes_dir)
    return 0


if __name__ == "__main__":
    sys.exit(main())
