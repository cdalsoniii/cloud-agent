"""Daytona OpenCode model smoke before SDLC batch waves."""

from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, Optional

import httpx

from sdlc_batch.providers.daytona import DaytonaProvider


def _model_payload(model: str) -> Dict[str, str]:
    if "/" in model:
        provider_id, model_id = model.split("/", 1)
        return {"providerID": provider_id, "modelID": model_id}
    return {"providerID": "baseten-proxy", "modelID": model}


def _extract_text(resp: Dict[str, Any]) -> str:
    parts = resp.get("parts") or []
    chunks: list[str] = []
    for p in parts:
        if isinstance(p, dict) and p.get("type") == "text":
            chunks.append(str(p.get("text") or ""))
        elif isinstance(p, dict) and "text" in p:
            chunks.append(str(p["text"]))
    if chunks:
        return "\n".join(chunks)
    # Some OpenCode versions nest under messages / content
    return json.dumps(resp)[:4000]


def _has_json_files_sample(text: str) -> bool:
    if '"files"' in text or "'files'" in text:
        return True
    m = re.search(r"```json\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    if not m:
        # bare object
        m = re.search(r"(\{\s*\"files\"\s*:\s*\[)", text)
        return bool(m)
    try:
        obj = json.loads(m.group(1))
        return isinstance(obj, dict) and "files" in obj
    except Exception:
        return '"files"' in m.group(1)


async def run_model_smoke(
    *,
    model: str = "baseten-proxy/qwen-coder",
    timeout: float = 180.0,
) -> None:
    """Spawn one Daytona sandbox and assert OpenCode returns a JSON files sample.

    Aborts the process (SystemExit) on failure so batch waves never run blind.
    Skip with SDLC_SKIP_MODEL_SMOKE=1.
    """
    if os.environ.get("SDLC_SKIP_MODEL_SMOKE", "").strip() in ("1", "true", "yes"):
        print("SDLC_SKIP_MODEL_SMOKE=1 — skipping model smoke")
        return

    provider = DaytonaProvider()
    inst = await provider.create_sandbox()
    print(f"[model-smoke] sandbox {inst.id} -> {inst.base_url}")
    client = httpx.AsyncClient(timeout=timeout)
    try:
        if not inst.is_healthy:
            raise RuntimeError("sandbox unhealthy after create")

        r = await client.post(f"{inst.base_url}/session")
        r.raise_for_status()
        session = r.json()["id"]
        print(f"[model-smoke] session {session}")

        prompt = (
            "Reply with ONLY a markdown json fence containing this exact shape "
            '(no other prose):\n'
            '```json\n'
            '{"files":[{"path":"smoke.txt","content":"ok"}],"commands":[]}\n'
            "```"
        )
        payload = {
            "parts": [{"type": "text", "text": prompt}],
            "model": _model_payload(model),
            "mode": "build",
        }
        r = await client.post(
            f"{inst.base_url}/session/{session}/message", json=payload
        )
        r.raise_for_status()
        body = r.json()
        text = _extract_text(body)
        print(f"[model-smoke] response chars={len(text)} preview={text[:400]!r}")
        if not text.strip():
            raise RuntimeError("empty model response")
        if not _has_json_files_sample(text):
            raise RuntimeError(
                "model response missing JSON files sample — "
                "check BASETEN_PROXY_BASE_URL / baseten-proxy.js / ngrok"
            )
        print("[model-smoke] OK — non-empty response with files JSON")
    except Exception as e:
        raise SystemExit(f"Model smoke FAILED: {type(e).__name__}: {e}") from e
    finally:
        try:
            await provider.destroy_sandbox(inst)
        except Exception as e:
            print(f"[model-smoke] destroy warning: {e}")
        await client.aclose()
