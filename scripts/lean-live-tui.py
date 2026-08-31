#!/usr/bin/env python3
"""Minimal TUI tailing .px/lean-live/state.json for Path A right pane."""
from __future__ import annotations

import json
import os
import sys
import time
from pathlib import Path

try:
    import curses
except ImportError:
    curses = None  # type: ignore


def repo_root() -> Path:
    return Path(__file__).resolve().parent.parent


def state_path() -> Path:
    return repo_root() / ".px" / "lean-live" / "state.json"


def load_state() -> dict:
    path = state_path()
    if not path.exists():
        return {"status": "waiting", "workspace": "(no state yet)"}
    try:
        return json.loads(path.read_text())
    except json.JSONDecodeError:
        return {"status": "parse_error"}


def _goal_lines(node: dict) -> list[str]:
    """Render the before/after goal states of a single tactic node, compactly.

    Hypotypes that carry through unchanged from before to after are shown once
    (in the `after` pane) using a '+' marker; the `before` pane lists only the
    goal types so the reader sees the transition without repeating the context.
    """
    out = []
    bef = node.get("before") or []
    aft = node.get("after") or []

    def goal_types(goals):
        return [g.get("type", "?") for g in goals]

    def hyps_of(goals):
        h = []
        for g in goals:
            for x in g.get("hypotheses") or []:
                h.append(x)
        return h

    if bef:
        out.append(f"  [⊢ {len(bef)} goal{'s' if len(bef) != 1 else ''}]")
        for t in goal_types(bef):
            out.append(f"    {t}")

    if aft:
        out.append(f"  [⊢ {len(aft)} goal{'s' if len(aft) != 1 else ''} →]")
        for t in goal_types(aft):
            out.append(f"    {t}")
        # hypotheses: show only the ones added/changed by this tactic
        before_h = set((h.get("name"), h.get("type")) for h in hyps_of(bef))
        shown = 0
        for h in hyps_of(aft):
            if (h.get("name"), h.get("type")) in before_h:
                continue
            hv = h.get("value")
            rendered = f"      + {h.get('name', '?')} : {h.get('type', '?')}"
            if hv:
                rendered += f" := {hv}"
            out.append(rendered)
            shown += 1
        if shown == 0 and aft:
            out.append("      (context unchanged)")
    return out


def render_goal_tree(nodes: list, *, max_depth: int = 16) -> list[str]:
    """Flatten the per-tactic goal tree into display lines.

    Nodes are visited in source order (the driver already emits them in tree
    preorder); indentation mirrors the depth recorded by the InfoTree so nested
    tactics (e.g. `simp`-expanded subproofs, `calc` steps, `rw` internals) read
    as a tree.  The deep `rw`-internal unfold nodes beyond `max_depth` are
    implementation noise and are collapsed to a single ellipsis line.
    """
    lines = []
    collapsed = False
    for n in nodes:
        depth = n.get("depth", 0)
        if depth > max_depth:
            if not collapsed:
                lines.append("      … (rw internals below)")
                collapsed = True
            continue
        collapsed = False
        indent = "  " * min(depth, 12)
        tac = (n.get("tactic") or "").strip().splitlines()
        head = tac[0] if tac else "<tac>"
        nb = len(n.get("before") or [])
        na = len(n.get("after") or [])
        lines.append(f"  {indent}▸ {head}   [{nb}→{na}] {n.get('id', '')}")
        changed = n.get("mvarBefore") != n.get("mvarAfter")
        if changed or nb != na:
            lines.extend(_goal_lines(n))
    return lines


def render_lines(state: dict) -> list[str]:
    lines = [
        "Lean Live",
        f"status: {state.get('status', '?')}",
        f"workspace: {state.get('workspace', '?')}",
        f"updated: {state.get('updatedAt', '?')}",
        "",
    ]
    goals = state.get("goals") or []
    if goals:
        lines.append("Goals:")
        lines.extend(f"  {g}" for g in goals[:12])
        lines.append("")
    trail = state.get("reasoningTrail")
    if trail:
        steps = trail.get("steps") or []
        at = trail.get("at", "?")
        lines.append(f"Reasoning trail (@ {at}, {len(steps)} steps, exit {trail.get('exitCode')}):")
        for s in steps[:20]:
            lines.extend(f"  {ln}" for ln in str(s).splitlines())
        lines.append("")
    tree = state.get("goalTree")
    if tree:
        nodes = tree.get("nodes") or []
        at = tree.get("at", "?")
        ok = tree.get("ok")
        lines.append(f"Goal tree (@ {at}, {len(nodes)} tactic nodes, ok={ok}):")
        lines.extend(render_goal_tree(nodes))
        lines.append("")
    diags = state.get("diagnostics") or []
    if diags:
        lines.append("Diagnostics:")
        for d in diags[:20]:
            lines.append(
                f"  [{d.get('severity', '?')}] {d.get('file', '?')}:"
                f"{d.get('line', '?')} {d.get('message', '')}"
            )
        lines.append("")
    tail = state.get("lastOutputTail")
    if tail:
        lines.append("Build tail:")
        lines.extend(f"  {ln}" for ln in str(tail).splitlines()[-8:])
    return lines


def run_curses(stdscr) -> None:
    curses.curs_set(0)
    stdscr.nodelay(True)
    while True:
        stdscr.erase()
        height, width = stdscr.getmaxyx()
        for i, line in enumerate(render_lines(load_state())[: height - 1]):
            stdscr.addnstr(i, 0, line, max(0, width - 1))
        stdscr.refresh()
        try:
            ch = stdscr.getch()
            if ch in (ord("q"), ord("Q"), 27):
                break
        except Exception:
            pass
        time.sleep(0.5)


def run_plain() -> None:
    while True:
        os.system("clear" if os.name != "nt" else "cls")
        print("\n".join(render_lines(load_state())))
        print("\n[q] quit")
        time.sleep(1)


def main() -> int:
    if curses and sys.stdout.isatty():
        curses.wrapper(run_curses)
    else:
        run_plain()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
