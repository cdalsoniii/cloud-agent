#!/usr/bin/env python3
"""Daytona sandbox quota reaper (SDK-only).

Lists sandboxes via the Daytona SDK and deletes idle / archived / aged ones
so large batches can spawn 1:1 without hitting disk quotas.

Usage:
  python reap_daytona.py                 # dry-run summary
  python reap_daytona.py --apply         # delete matching sandboxes
  python reap_daytona.py --apply --max-age-hours 2
  python reap_daytona.py --require-free-gib 40   # exit 2 if after reap still low
"""

from __future__ import annotations

import argparse
import asyncio
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Load .env without bash
ROOT = Path(__file__).resolve().parent.parent
for env_path in (ROOT / ".env", ROOT.parent / ".env"):
    if not env_path.is_file():
        continue
    for line in env_path.read_text(encoding="utf-8", errors="ignore").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and value and key not in os.environ and not value.startswith("fm2_"):
            os.environ[key] = value

from daytona import DaytonaConfig  # noqa: E402
from daytona._async.daytona import AsyncDaytona  # noqa: E402


TERMINAL_LIKE = {"stopped", "archived", "error", "destroyed", "destroying"}


def _parse_created(sb) -> datetime | None:
    raw = getattr(sb, "created_at", None) or getattr(sb, "createdAt", None)
    if raw is None:
        return None
    if isinstance(raw, datetime):
        return raw if raw.tzinfo else raw.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except Exception:
        return None


def _state(sb) -> str:
    st = getattr(sb, "state", None) or getattr(sb, "status", "") or ""
    return str(st).lower()


async def main() -> int:
    parser = argparse.ArgumentParser(description="Reap idle/aged Daytona sandboxes")
    parser.add_argument("--apply", action="store_true", help="Actually delete (default: dry-run)")
    parser.add_argument("--max-age-hours", type=float, default=6.0, help="Delete sandboxes older than this")
    parser.add_argument(
        "--states",
        default="stopped,archived,error,destroying",
        help="Comma-separated states always eligible for delete",
    )
    parser.add_argument(
        "--include-started-if-aged",
        action="store_true",
        help="Also delete started sandboxes older than max-age-hours",
    )
    parser.add_argument(
        "--require-free-gib",
        type=float,
        default=0.0,
        help="If >0, exit 2 when remaining sandbox count suggests quota risk (heuristic)",
    )
    parser.add_argument(
        "--max-remaining",
        type=int,
        default=20,
        help="With --require-free-gib, fail if more than this many sandboxes remain",
    )
    args = parser.parse_args()

    api_key = os.environ.get("DAYTONA_API_KEY")
    if not api_key:
        print("DAYTONA_API_KEY missing", file=sys.stderr)
        return 1

    cfg = DaytonaConfig(
        api_key=api_key,
        api_url=os.environ.get("DAYTONA_API_URL", "https://app.daytona.io/api"),
        target=os.environ.get("DAYTONA_TARGET"),
    )
    client = AsyncDaytona(cfg)
    always_states = {s.strip().lower() for s in args.states.split(",") if s.strip()}
    now = datetime.now(timezone.utc)
    max_age = args.max_age_hours * 3600

    try:
        # AsyncDaytona.list() is an AsyncIterator[AsyncSandbox]
        items: list = []
        async for sb in client.list():
            items.append(sb)

        to_delete = []
        kept = []
        for sb in items:
            sid = getattr(sb, "id", None) or str(sb)
            state = _state(sb)
            created = _parse_created(sb)
            age_s = (now - created).total_seconds() if created else None
            aged = age_s is not None and age_s >= max_age
            eligible = state in always_states or state in TERMINAL_LIKE
            if args.include_started_if_aged and aged and state in {"started", "running"}:
                eligible = True
            if aged and state not in {"started", "running"}:
                eligible = True
            row = {
                "id": sid,
                "state": state,
                "age_hours": round(age_s / 3600, 2) if age_s is not None else None,
            }
            if eligible:
                to_delete.append((sb, row))
            else:
                kept.append(row)

        print(f"found={len(items)} delete_candidates={len(to_delete)} keep={len(kept)} apply={args.apply}")
        for _, row in to_delete:
            print(f"  DELETE {row['id'][:8]}… state={row['state']} age_h={row['age_hours']}")
        for row in kept[:10]:
            print(f"  KEEP   {row['id'][:8]}… state={row['state']} age_h={row['age_hours']}")
        if len(kept) > 10:
            print(f"  … {len(kept) - 10} more kept")

        deleted = 0
        if args.apply:
            for sb, row in to_delete:
                try:
                    await client.delete(sb)
                    deleted += 1
                    print(f"  deleted {row['id'][:8]}…")
                except Exception as e:
                    print(f"  failed {row['id'][:8]}…: {e}", file=sys.stderr)
            print(f"deleted={deleted}/{len(to_delete)}")

        remaining = len(items) - (deleted if args.apply else 0)
        if args.apply:
            try:
                remaining = 0
                async for _ in client.list():
                    remaining += 1
            except Exception:
                remaining = len(kept)

        print(f"remaining≈{remaining}")
        if args.require_free_gib > 0 and remaining > args.max_remaining:
            print(
                f"QUOTA_RISK: remaining={remaining} > max_remaining={args.max_remaining}",
                file=sys.stderr,
            )
            return 2
        return 0
    finally:
        try:
            await client.close()
        except Exception:
            pass


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
