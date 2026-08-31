---
name: ontology-edit
description: >
  Toggle or set ontology editing ON/OFF for the shared SurrealDB / LinkML ontology gate.
  Use when the user runs /ontology-edit, /ontology-edit on|off|status, or wants to
  allow schema mutations and SHACL-driven ontology change suggestions.
when-to-use: ontology editing, turn on ontology editing, turn off ontology editing, /ontology-edit
user-invocable: true
argument-hint: "on|off|status"
---

# Ontology editing (`/ontology-edit`)

Controls **`ontologyEditing`** in `.px/config.json` (same flag as OpenCode Shift+O).

| Mode | Allowed |
|------|---------|
| OFF | Read-only ontology; SHACL failures → **data** repair only |
| ON | Schema/DDL/LinkML edits; SHACL failures → **ontology suggestions** (apply only after user confirms) |

Editing is **independent** of `/ontology on|off` (enforcement).

## Commands

```bash
bash scripts/px-ontology-mode.sh edit toggle   # /ontology-edit
bash scripts/px-ontology-mode.sh edit on
bash scripts/px-ontology-mode.sh edit off
bash scripts/px-ontology-mode.sh edit status
# legacy:
bash scripts/toggle-ontology-edit.sh
```

Env override: `PX_ONTOLOGY_EDIT=0|1`

## Where the flag is enforced

| Consumer | Behavior when OFF |
|----------|-------------------|
| OpenCode `schema_apply` / Shift+O | blocks schema edits |
| `/update-ontology` skill | refuse DDL until ON |
| tool_io / SHACL suggest path | no schema-change suggestions |

## Agent instructions

1. Parse args: empty → toggle; `on` / `off` / `status`.
2. Run `px-ontology-mode.sh edit …` from cloud-agent root.
3. Confirm by reading `.px/config.json`.
4. When **editing is ON** and SHACL fails:
   - Surface tool `cot` to the user
   - Include `ontologySuggestions` from tool_io / `px_ontology_suggest`
   - **Do not** apply DDL without explicit user confirmation
5. When editing is OFF and user asks to change the schema: tell them to run
   `/ontology-edit on` first.

## Safety

Schema/migration changes to a live SurrealDB ontology are only allowed while
`ontologyEditing` is `true`. Leave it OFF for read-only work.
