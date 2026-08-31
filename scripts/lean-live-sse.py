#!/usr/bin/env python3
"""Lean Live SSE watcher — streams /events from lean-live-bridge in real time.

Each line is one event (build_start / build_complete / file_change /
trace_capture / tree_capture / diagnostics) as the bridge emits it.
Display-only; exits with the signal/EOF that closes the stream.

Usage: lean-live-sse.py [--raw] [host] [port]
  --raw  print the raw SSE payload line (data: {...}) instead of the pretty form
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request

HOST = "127.0.0.1"
PORT = 9474


def prettify(event: dict) -> str:
    t = event.get("type", "?")
    ts = event.get("ts", "")
    try:
        ts = time.strftime("%H:%M:%S", time.strptime(ts.split(".")[0], "%Y-%m-%dT%H:%M:%S"))
    except Exception:
        ts = ts[:19]
    base = f"{ts}  {t}"
    if t == "build_start":
        return f"{base}  reason={event.get('reason')}"
    if t == "build_complete":
        return f"{base}  exit={event.get('exitCode')} diags={event.get('diagnosticCount')} goals={event.get('goalCount')}"
    if t == "file_change":
        return f"{base}  file={event.get('file')}"
    if t == "trace_capture":
        return f"{base}  exit={event.get('exitCode')} steps={event.get('stepCount')}"
    if t == "tree_capture":
        return f"{base}  exit={event.get('exitCode')} ok={event.get('ok')} nodes={event.get('nodeCount')}"
    if t == "diagnostics":
        return f"{base}  goalCount={len(event.get('goals') or [])}"
    if t == "bridge_start":
        return f"{base}  workspace={event.get('workspace')} port={event.get('port')}"
    return str(event)


def main() -> int:
    args = [a for a in sys.argv[1:] if not a.startswith("-") or a == "--raw"]
    raw = "--raw" in sys.argv[1:]
    host = args[0] if len(args) > 0 else HOST
    port = args[1] if len(args) > 1 else PORT
    url = f"http://{host}:{port}/events"
    sys.stdout.write(f"Watching {url} — Ctrl-C to stop\n")
    sys.stdout.flush()
    try:
        req = urllib.request.urlopen(url, timeout=None)
    except urllib.error.URLError as e:
        sys.stderr.write(f"error connecting to {url}: {e}\n")
        return 1
    try:
        for raw_line in req:
            line = raw_line.decode("utf-8", "replace").rstrip("\n")
            if not line or line.startswith(":"):
                continue
            if raw:
                sys.stdout.write(line + "\n")
                sys.stdout.flush()
                continue
            if line.startswith("data:"):
                payload = line[5:].strip()
                if raw:
                    sys.stdout.write(payload + "\n")
                    sys.stdout.flush()
                    continue
                try:
                    print(prettify(json.loads(payload)))
                except Exception:
                    print(line)
            sys.stdout.flush()
    except KeyboardInterrupt:
        return 0
    finally:
        try:
            req.close()
        except Exception:
            pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
