# Sandbox zones, ontology lifecycle, and domain strategy

Protects proprietary LinkML-superset IP while keeping **sandbox lifecycle**, **ontology development lifecycle**, and **public domains** in sync via `SandboxTypeRegistry`.

## Roles

| Role | Stage | Public apps | Ports |
|------|-------|-------------|-------|
| `editor` (S1) | edit | **none** | — |
| `formal` (S2) | stabilize | ontology UI + **verifier-fleet** | 7004 validate, **7005** diagram, **7006** fleet |
| `agent` (S3) | consume | optional agent app | gated MCP |
| `legacy-packed` | demo | ontology + validate | 7000–7005 |

## Ontology lifecycle ↔ sandbox

```
edit (editor) → schema_release_candidate (Surreal / host pull)
    → stabilize (formal: gen-shacl, GraphQL, Lean; serve 7004/7005)
    → enforce (host dual-gate + ValidationToken)
    → MCP / agent (only with token)
```

## Domain matrix (friendly hosts)

Config:

- `SANDBOX_DOMAIN_BASE` (default `px.example.com`)
- `SANDBOX_ENV` (`local` \| `dev` \| `stage` \| `prod`)
- `PREVIEW_MODE` (`friendly` \| `raw`)
- `PREVIEW_PROXY_URL` (optional edge proxy)

| Host template | App | Public | Backend |
|---------------|-----|--------|---------|
| `ontology.{env}.{base}` | ontology UI | yes (formal) | :7005 |
| `validate.{env}.{base}` | SHACL API | no (BFF preferred) | :7004 |
| editor | — | **no DNS** | — |
| `agent.{env}.{base}` | agent | optional | app |

**Never** publish editor sandbox on a public hostname.

Daytona internal hop remains signed preview:

`https://{port}-{token}.{daytonaProxyDomain}`

Product edge: Custom Preview Proxy or Cloudflare Worker under your domain.

## IP rules

1. S1 egress: Surreal RC or host-mediated pack pull only.
2. S2 holds gen pipeline; agents get validation **verdicts**, not compiler source.
3. 7005 serves **derived** `ontology-state.json` only.
4. MCP egress requires ValidationToken when `ontologyEnforcement` is on.

## Sync rule

Bump `SANDBOX_TYPES_VERSION` in `types-registry.ts` when changing ports, egress, tools, or domains. Update smokes + Quint + this doc in the same PR.

## MCP

- `px_sandbox_types` — registry snapshot + domain matrix
- `px_formal_create` — start formal (S2) diagram + fleet (**Daytona by default** when `DAYTONA_API_KEY` set; `forceLocal:true` for host formal-equivalent)
- `px_formal_ingest` — re-upload pack + restart in-sandbox 7005/7006; health + node count
- `px_ontology_ui_preview` — friendly/raw ontology UI URL
- `px_formal_preview` — ontology / validate / fleet mint (signed Daytona previews when live)
- `px_formal_fleet_preview` — fleet surface (7006) mint

## Schema graph (DBMS-style React Flow)

Derived from host LinkML (`.px`), not sandbox disk:

- **Builder:** `ontology-state.ts` — class nodes carry `data.fields[]`; range associations emit `sourceHandle` / `targetHandle` (`Class.slot`).
- **layoutMode:** `schema-ports` (default) or `class-nodes` if `ONTOLOGY_GRAPH_EXPLODE_SLOTS=1`.
- **Host UI:** assistant-ui `/ontology/schema` + `SchemaOntologyGraph` / `SchemaClassNode` (MiniMap, Controls, animated edges).
- **Sandbox UI:** `templates/ontology-ui` renders the same JSON with per-field handles.
- **SoT when sandbox stopped:** host `.px/linkml` + `.px/generated/ontology-state.json`.

## Daytona lifetime (development)

- **Auto-stop: max 5 minutes** idle (`autoStopInterval`, unit = minutes).
- Constant / helper: `daytonaAutoStopMinutes()` in `types.ts` (clamps `DAYTONA_AUTO_STOP_MINUTES` to 1–5).
- Sandboxes still run during development; they stop after ≤5 min idle instead of forever (`0`).
- `KEEP_FORMAL_SANDBOX=1` only skips immediate destroy at demo exit — auto-stop still applies.

## In-Daytona formal apps

| Port | Process | Surface |
|------|---------|---------|
| 7004 | `shacl-server.py` | validate API |
| 7005 | `ontology-ui-server.py` | LinkML diagram |
| 7006 | `fleet-ui-server.py` | verifier-fleet React Flow (lite) |
| **3010** | **Next `@assistant-ui/web`** | **Full product UI from `02-products/assistant-ui`** |
| **4096** | **`opencode serve`** | **Local agent / OpenCode SDK entry** |

`px_formal_create` (Daytona) by default:

1. Formal SHACL/diagram/fleet (7004–7006)
2. Optional assistant-ui Next (3010) — `FORMAL_START_ASSISTANT_UI=0` to skip
3. **OpenCode serve (4096)** — `FORMAL_START_OPENCODE=0` to skip  
4. Writes `/home/daytona/AGENT_READY.json` + process board

Local agent:

```bash
eval "$(python3 scripts/export-daytona-env.py)"
KEEP_FORMAL_SANDBOX=1 npm run sandbox:opencode
# then always use latest OPENCODE_BASE_URL from open-urls / previews:mint
export OPENCODE_BASE_URL=$(grep OPENCODE_BASE_URL .gsd/evidence/LATEST-open-urls.txt | cut -d= -f2)
```

Demo (live formal + assistant-ui):

```bash
eval "$(python3 scripts/export-daytona-env.py)"
KEEP_FORMAL_SANDBOX=1 npx tsx scripts/demo-formal-assistant-ui.ts
```

Signed preview tokens expire quickly. **Always read the latest** `open-urls.txt` / `.gsd/evidence/LATEST-open-urls.txt` — do not reuse chat history links.

```bash
eval "$(python3 scripts/export-daytona-env.py)"
# one-shot mint + immediate refresh (writes open-urls.txt)
npm run previews:mint
# re-mint only
npm run previews:refresh
# keep rotating every 2 min (30 ticks) without destroying sandbox
npm run previews:watch
```

404 on `/callback` = expired token, not necessarily a dead sandbox.
