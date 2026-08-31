# Encapsulation map: MCP + remote sandboxes + harness plugin

## Short answer

**Pre/post I/O validation is enforceable with three surfaces only:**

| Surface | Role |
|---------|------|
| **MCP** (`cloud-agent-mastra`) | CallTool middleware hard-blocks gated tools on `tool_io_guard` **pre** and **post** failure (`isError: true`) |
| **Remote sandboxes** (Daytona) | Live SHACL `:7004` / guardrails `:7003` when created; **host pySHACL fallback** if no sandbox |
| **Harness plugin** (`px-validation-always`) | `UserPromptSubmit` scope · `PreToolUse` deny · `PostToolUse` record · `Stop` block on post-fail / missing scope |

Implementation code lives in this repo, but **operators and agents only need those three surfaces** — no manual cascade calls for gated paths.

---

## Enforcement path (input + output)

```
User prompt
  └─ plugin UserPromptSubmit → px_ontology_scope (relevantOntologyTag)

Tool call (gated)
  ├─ plugin PreToolUse → enforceToolIo(pre) → deny | allow
  ├─ MCP CallTool middleware → tool_io_guard pre → block if fail
  ├─ tool executes
  ├─ MCP CallTool middleware → tool_io_guard post → block if fail (isError)
  └─ plugin PostToolUse → enforceToolIo(post) → .px/session/last-io-guard.json

Turn end
  └─ plugin Stop → block if post ok=false OR pack-scoped scope missing
```

Same decision kernel:

- `src/verification-sandbox/io-enforcement.ts` → `enforceToolIo`
- `callVerificationMcpTool('tool_io_guard', …)` (MCP tool surface)
- Cascade: SHACL (remote or host) → Lean → GraphQL

---

## What each layer guarantees

### MCP only

- Gated tools (`daytona-exec`, `sdlc-batch`, …) never succeed when pre or post `tool_io_guard` returns `ok=false`.
- Envelope includes `validationPre` / `validationPost` / `packResolve`.
- Host SHACL via `hostInvokeShacl` when no Daytona box; remote when `px_sandbox_create` active.

### Harness plugin only (no agent discipline)

- Pack-scoped prompts get scope inject.
- Gated host tools (shell/exec/MCP dispatch) run **real** pre `tool_io_guard` (not soft allow).
- Post results recorded; Stop blocks once on post failure.
- Defaults: `PX_HOOK_HARD_DENY=1`, `PX_VALIDATION_PROFILE=strict`.

### Sandboxes

- Preferred live SHACL/guardrails path.
- Optional: agent/operator calls `px_sandbox_create` once per session.

---

## Operator enablement

```bash
# 1) MCP
npm run mastra:mcp

# 2) Trust project hooks (once)
# /hooks-trust

# 3) Enforcement on
bash scripts/px-ontology-mode.sh enforce on
export PX_VALIDATION_PROFILE=strict
# optional soft: PX_HOOK_HARD_DENY=0  PX_HOOK_FAIL_OPEN=1

# 4) Optional remote SHACL
# via MCP: px_sandbox_create { provider: "daytona" }  or forceMock: true

# 5) Prove offline
npm run test:io-enforcement
npm run smoke:io-enforcement
npm run smoke:mcp-tool-surface
```

Plugin path: `.grok/plugins/px-validation-always/`  
Project hooks mirror: `.grok/hooks/px-validation-always.json`

---

## Inventory (source of truth)

| Path | Role |
|------|------|
| `src/verification-sandbox/io-enforcement.ts` | shared pre/post decision |
| `src/verification-sandbox/handlers.ts` | tool_io_guard, cascade, scope |
| `src/verification-sandbox/validation-cascade.ts` | SHACL→Lean→GraphQL |
| `src/verification-sandbox/provider.ts` | `hostInvokeShacl` + Daytona |
| `src/mastra/mcp-server.ts` | CallTool pre/post hard block |
| `.grok/plugins/px-validation-always/**` | harness hooks |
| `config/verification/quint/validation-pipeline-always.qnt` | formal FSM |

---

## LinkML reasoning + usage log

Every `tool_io_guard` / `px_validate_cascade` returns **`linkmlReasoning`**:

- `classes` / `classesUsed`
- `relationships` / `relationshipsUsed`
- `resolvers` / `resolversUsed`
- `mutations` / `mutationsReferenced` (from GraphQL `type Mutation`)
- `narrative` (markdown for agents)

Appended to `.px/session/linkml-usage.jsonl`. Query via MCP **`px_linkml_usage`**.

Open verifier UIs (+ assistant-ui in sandbox):

```bash
export VERIFIER_SANDBOX_PROVIDER=daytona
eval "$(python3 scripts/export-daytona-env.py)"   # DAYTONA_* safely
npm run open:linkml-verifiers
# Opens: ontology :7005 (search/filter React Flow), fleet :7006, SHACL :7004,
#        assistant-ui web :3010 from 02-products/assistant-ui (Daytona formal)
# OPEN_BROWSER=0  SKIP_ASSISTANT_UI=1  FORCE_LOCAL=1
```

Ontology React Flow side panel: **Search**, kind filters (class/enum/shape/fleet), only-with-fields, only-used-in-last-validation, dim-vs-hide, clickable results + fit.

## Validation I/O → host Surreal (SHACL / Lean / GraphQL / Guardrails)

Surreal runs **on the host** (`:8000`), not inside the formal sandbox.

| Piece | Role |
|-------|------|
| Tables | `validation_call`, `endpoint_io`, `ontology_overlay` in `schema.surql` |
| Writers | `tool_io_guard`, `px_validate_cascade` → `validation-io-store.ts` |
| Mirror | `.px/session/validation-calls.jsonl` + `endpoint-io.jsonl` + `ontology-overlay.json` |
| MCP | `px_validation_calls` |
| Overlay | `ontology-overlay.ts` rolls calls → per-node/edge status colors; ontology UI paints borders/strokes |
| UI | Ontology `:7005` Search legend + Node tab metadata + Logs; fleet list separate |

```bash
bash scripts/surreal-stack.sh start
export SURREALDB_URL=http://127.0.0.1:8000
npm run smoke:validation-io-surreal
npm run test:ontology-overlay
```

## Guardrails multi-server (N instances)

| Piece | Role |
|-------|------|
| Pure set | `guardrails-servers.ts` — register / remove / list / per-id health (no max of 1) |
| Soft cap | `GUARDRAILS_MAX_SERVERS` optional; unset = unlimited data model |
| Extra binds | `GUARDRAILS_EXTRA_PORTS=7010,7011` → multi-service-server + formal bootstrap |
| API | `GET /api/guardrails/servers`, `POST /api/guardrails/register`, `POST /api/guardrails/remove`, `GET /api/guardrails/health-all` |
| Session | `.px/session/guardrails-servers.json` |
| UI | Ontology Guardrails tab: add form, probe all, remove one keeps others |

```bash
npm run test:guardrails-servers
export GUARDRAILS_EXTRA_PORTS=7010,7011
```

## Prepaid credits bar (ontology viewer bottom status)

AUI-style bottom breadcrumbs/status strip on **ontology UI only** (`:7005`):

| Piece | Role |
|-------|------|
| Ledger | `.px/session/ontology-budget.json` (prepaid USD, rate $/s, `startedAt`) |
| Math | `ontology-budget.ts` — remaining = prepaid − runtime×rate (never &lt; 0) |
| API | `GET /api/usage/credits` |
| UI | Footer: pack crumbs · ⏱ runtime · burn $ · progress bar + remaining prepaid |
| Env | `ONTOLOGY_PREPAID_USD` (default 10), `ONTOLOGY_SANDBOX_RATE_USD_PER_SEC` (default 0.0004), `DAYTONA_AUTO_STOP_MINUTES` |

Credits **count down** as sandbox runtime accrues (prepaid budget burn). Not wired into fleet-ui or assistant-ui.

## Midspiral stack → ontology viewer only (`:7005`)

| Tool | Bridge |
|------|--------|
| lemmafit | CLI via `midspiral-bridge.ts` |
| LemmaScript | `//@` extract + optional CLI |
| lemmacore | probe (coming soon) |
| claimcheck | CLI |
| dafny-replay | dafny / `VERIFIED_KERNELS_PATH` probe |
| dafny2js | `DAFNY2JS_PATH` probe |

- Session: `.px/session/midspiral-status.json`, `midspiral-runs.jsonl`
- APIs: `GET /api/midspiral/status`, `GET /api/midspiral/runs`, `POST /api/midspiral/run` (needs `MIDSPIRAL_ALLOW_EXEC=1` on host)
- **Not** wired into assistant-ui web or fleet-ui — ontology application only

```bash
npx tsx -e "import { getMidspiralStatus } from './src/verification-sandbox/midspiral-bridge.ts'; console.log(getMidspiralStatus())"
npm run test:midspiral-bridge
```

## Residual risks

| Risk | Mitigation |
|------|------------|
| Second MCP bypasses middleware | Use only `cloud-agent-mastra` for sandbox exec |
| PostToolUse is passive in Grok | Stop gate + MCP post `isError` |
| Chat with no tools | UserPromptSubmit scope + Stop; full cascade needs structured JSON |
| Hook trust disabled | `/hooks-trust` |
| Preview tokens expire | Re-run `open:linkml-verifiers` |
| Sandbox UI cannot reach host Surreal | Host ontology UI / AUI API / MCP; JSONL upload optional |
