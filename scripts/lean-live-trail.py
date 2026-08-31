#!/usr/bin/env python3
"""Lean Live reasoning-trail streamer — shows the per-step trail as Lean
elaborates, streaming each step the moment it is printed.

This runs `lean-trace.sh PxCloudAgent.Trace` directly (not through the bridge)
so the trace lines appear in real time as elaboration progresses, and keeps
tailing a fresh capture every `--interval` seconds. The trace options live in
the module itself (trace.Meta.Tactic.simp.rewrite etc.).

Usage: lean-live-trail.py [--interval N] [--once] [module]
  --interval N  re-run the capture every N seconds (default 0 = run once then idle)
  --once        run a single capture and exit
  module        module to trace (default PxCloudAgent.Trace)
"""
from __future__ import annotations

import os
import subprocess
import sys
import time

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = os.path.join(REPO_ROOT, "scripts", "lean-trace.sh")
BUNDLE = os.getenv("PX_GROK_BUNDLE", os.path.join(REPO_ROOT, ".grok-bundle"))


def capture(module: str) -> int:
    env = dict(os.environ)
    env["PX_GROK_BUNDLE"] = BUNDLE
    if not env.get("LEAN_WORKSPACE"):
        env["LEAN_WORKSPACE"] = os.path.join(REPO_ROOT, "config", "verification", "lean")
    env["PATH"] = os.path.join(BUNDLE, "bin") + os.pathsep + env.get("PATH", "")
    proc = subprocess.Popen(
        ["bash", SCRIPT, module],
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        env=env,
        text=True,
        bufsize=1,
    )
    # Stream lines through as they arrive (parents hide buffering via bufsize=1;
    # lean prints the trail as it elaborates).
    assert proc.stdout is not None
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
    return proc.wait()


def main() -> int:
    interval = 0.0
    once = False
    module = "PxCloudAgent.Trace"
    i = 0
    argv = sys.argv[1:]
    while i < len(argv):
        if argv[i] == "--interval":
            interval = float(argv[i + 1]); i += 2; continue
        if argv[i] == "--once":
            once = True; i += 1; continue
        if argv[i].startswith("-"):
            i += 1; continue
        module = argv[i]; i += 1

    if once:
        return capture(module)

    sys.stdout.write(f"Lean reasoning trail — streaming captures of {module} "
                     f"every {interval or 3}s. Ctrl-C to stop.\n")
    sys.stdout.flush()
    try:
        while True:
            code = capture(module)
            sys.stdout.write(f"\n--- capture exit {code} "
                             f"({time.strftime('%H:%M:%S')}) ---\n")
            sys.stdout.flush()
            time.sleep(interval or 3)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    sys.exit(main())
