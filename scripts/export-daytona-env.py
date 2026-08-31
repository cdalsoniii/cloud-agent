#!/usr/bin/env python3
"""Emit shell exports for DAYTONA_* keys from .env without sourcing broken lines."""
from __future__ import annotations

import re
import shlex
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[1]
env_path = Path(sys.argv[1]) if len(sys.argv) > 1 else root / ".env"
if not env_path.is_file():
    print(f"# missing {env_path}", file=sys.stderr)
    sys.exit(1)

for line in env_path.read_text(errors="replace").splitlines():
    line = line.strip()
    if not line or line.startswith("#"):
        continue
    m = re.match(r"^(export\s+)?(DAYTONA_[A-Za-z0-9_]+)=(.*)$", line)
    if not m:
        continue
    k, v = m.group(2), m.group(3)
    if (v.startswith('"') and v.endswith('"')) or (v.startswith("'") and v.endswith("'")):
        v = v[1:-1]
    print(f"export {k}={shlex.quote(v)}")
