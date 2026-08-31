---
name: px-validation-always
description: >
  Always-on LinkML pre/post I/O validation for pack-scoped work (Skydio/Oteemo).
  Harness plugin + MCP middleware + optional remote sandboxes — no manual cascade.
when-to-use: skydio, oteemo, validation pipeline, ontology scope, pre post hooks, tool_io_guard
user-invocable: true
---

# Always-on pre/post validation

## Three surfaces (sufficient)

1. **MCP** `cloud-agent-mastra` — CallTool middleware runs `tool_io_guard` pre **and** post; both hard-block gated tools.
2. **Remote sandboxes** — `px_sandbox_create` for live SHACL; host pySHACL used if none.
3. **This plugin** — host hooks:
   - `UserPromptSubmit` → scope / `relevantOntologyTag`
   - `PreToolUse` → deny on pre `tool_io_guard` fail
   - `PostToolUse` → record post guard → `.px/session/last-io-guard.json`
   - `Stop` → block if post failed or pack-scoped scope missing

## Agent checklist

- Prefer gated work through **cloud-agent-mastra** MCP tools.
- For structured ontology claims, pass JSON `payload`/`data` (Engagement, postmortem, …).
- Do not answer pack-scoped prompts without acknowledging `relevantOntologyTag`.

## Env

| Var | Default | Meaning |
|-----|---------|---------|
| `PX_VALIDATION_PROFILE` | `strict` | deny if enforcement off |
| `PX_HOOK_HARD_DENY` | `1` | deny gated tools without scope |
| `PX_HOOK_FAIL_OPEN` | `0` | if `1`, allow when run-guard crashes |
| `PX_ALLOW_ENFORCE_OFF` | unset | allow enforcement off under strict |

## Prove

```bash
npm run smoke:io-enforcement
npm run smoke:mcp-tool-surface
```
