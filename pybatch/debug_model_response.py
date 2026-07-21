"""Debug the OpenCode /session/{id}/message response from inside a Daytona sandbox."""

import asyncio
import json
import os
from pathlib import Path

from dotenv import load_dotenv
from sdlc_batch.providers.daytona import DaytonaProvider

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def _model_payload(model: str) -> dict:
    if "/" in model:
        provider_id, model_id = model.split("/", 1)
        return {"providerID": provider_id, "modelID": model_id}
    return {"providerID": "zai-org", "modelID": model}


async def main():
    provider = DaytonaProvider()
    inst = await provider.create_sandbox()
    print(f"[daytona] {inst.id} -> {inst.base_url}")

    base = inst.base_url
    async_client = __import__("httpx").AsyncClient(timeout=300)

    try:
        r = await async_client.post(f"{base}/session")
        r.raise_for_status()
        session = r.json()["id"]
        print(f"[session] {session}")

        # Send a simple task
        payload = {
            "parts": [
                {
                    "type": "text",
                    "text": (
                        "Create a file named repo/hello.txt in the current directory with content 'Hello from SDLC'. "
                        "Output only the bash commands in a ```bash ... ``` block."
                    ),
                }
            ],
            "model": _model_payload("baseten-proxy/qwen-coder"),
            "mode": "build",
        }
        r = await async_client.post(f"{base}/session/{session}/message", json=payload)
        print(f"[status] {r.status_code}")
        print(f"[response] {r.text}")
    finally:
        await provider.destroy_sandbox(inst)
        await async_client.aclose()


if __name__ == "__main__":
    asyncio.run(main())
