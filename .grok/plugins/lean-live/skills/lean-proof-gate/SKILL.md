---
name: lean-proof-gate
description: Use when editing or claiming Lean 4 proofs. Run lake build and read lean-live bridge state before asserting verification.
---

# Lean proof gate

## When to use

- Editing `.lean` files in the formal workspace
- Claiming a theorem is proved or a sorry is resolved
- Reviewing agent output that references Lean verification

## Workflow

1. Ensure stack is up: `./scripts/lean-stack.sh status` and `./scripts/lean-live-bridge.sh status`
2. After edits, trigger rebuild: `curl -X POST http://127.0.0.1:${LEAN_LIVE_PORT:-9474}/rebuild`
3. Read state: `curl -s http://127.0.0.1:${LEAN_LIVE_PORT:-9474}/state`
4. Only claim success when `status` is `ok` and diagnostics are empty

## Workspace resolution

- `LEAN_WORKSPACE` env override
- Else `PX_VALIDATE_ROOT/formal` if it contains `lakefile.lean`
- Else `config/verification/lean` stub in cloud-agent

## Never

- Fabricate proof completion without `lake build` exit code 0
- Ignore `sorry` or unsolved goals in bridge `goals` array
