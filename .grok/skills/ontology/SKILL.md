---
name: ontology
description: >
  Turn ontology pre/post enforcement ON or OFF (SHACL + sandboxed MCP validation).
  Use when the user says /ontology off, /ontology on, /ontology status, or wants to
  disable or enable tool-io schema gates that call the sandbox SHACL server.
when-to-use: /ontology, ontology off, ontology on, ontology status, disable SHACL enforcement, enable pre post hooks
user-invocable: true
argument-hint: "on|off|status"
---

# Ontology enforcement (`/ontology`)

Controls **`ontologyEnforcement`** in `.px/config.json` — whether pre/post tool-io
hooks run SHACL/GraphQL (including sandboxed MCP `px_shacl_validate`).

This is **not** the same as `/ontology-edit` (schema mutation permission).

| Flag | Meaning |
|------|---------|
| `ontologyEnforcement` | Pre/post SHACL + MCP may **block** tool I/O |
| `ontologyEditing` | Allow DDL/LinkML edits + ontology **suggestions** |

## Commands

```bash
# from cloud-agent root
bash scripts/px-ontology-mode.sh off          # /ontology off
bash scripts/px-ontology-mode.sh on           # /ontology on
bash scripts/px-ontology-mode.sh status       # both flags
bash scripts/px-ontology-mode.sh enforce off
bash scripts/px-ontology-mode.sh enforce on
```

Env override: `PX_ONTOLOGY_ENFORCE=0|1`

## Agent instructions

1. Parse user intent: `off` → enforce off; `on` → enforce on; else `status`.
2. Run the matching script from the cloud-agent workspace root.
3. Re-read `.px/config.json` and report both `ontologyEnforcement` and `ontologyEditing`.
4. When enforcement is OFF, do **not** call sandboxed SHACL as a blocking gate;
   still surface a short CoT note that checks were skipped.
5. When enforcement is ON and a tool returns a `cot` field from SHACL, **always
   show that CoT text to the user** before continuing.
6. **Always-on pipeline:** prefer `ontologyEnforcement` ON. `tool_io_guard` defaults
   `enforceSchema: true` (cascade SHACL→Lean→GraphQL + `ontologyHookContext`).
7. **Pack-scoped questions** (Skydio, Oteemo, promotion, engagement, drones): call
   MCP `px_ontology_scope` or `px_pack_resolve` first and include
   `relevantOntologyTag` (e.g. `there_is_one_relevant_ontology`) in the answer metadata.
8. Before gated work (exec/shell/batch), ensure `px_pipeline_ready` is green when possible.
9. Strict profile: `PX_VALIDATION_PROFILE=strict` blocks turning enforcement off without
   `PX_ALLOW_ENFORCE_OFF=1`.

## Related

- `/ontology-edit` — editing gate only
- `/update-ontology` — apply Surreal DDL (requires editing ON)
