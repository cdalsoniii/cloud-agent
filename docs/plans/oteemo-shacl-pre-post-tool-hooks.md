# Plan: Oteemo LinkML → SHACL pre/post tool hooks

## Goal

Use the **Oteemo DevSecOps LinkML pack** as the schema of record, generate **SHACL**, serve it on the formal **SHACL endpoint** (`:7004`), and drive **pre/post tool hooks** (`tool_io_guard` / `px_shacl_validate`) so agent **assumptions** are tested before and after tool calls.

## Pack location (created)

| Artifact | Path |
|----------|------|
| Metamodel | `02-products/assistant-ui/.px/linkml/oteemo/oteemo-devsecops.linkml.yaml` |
| Happy engagement | `…/oteemo/fixtures/engagement.happy.yaml` |
| Sad engagement | `…/oteemo/fixtures/engagement.sad.yaml` |
| Pre-hook happy JSON | `…/oteemo/fixtures/assumption-pre.happy.json` |
| Post-hook sad JSON | `…/oteemo/fixtures/assumption-post.sad.json` |
| README | `…/oteemo/README.md` |
| Generated SHACL | `…/.px/generated/oteemo.shacl.ttl` (via `generate-linkml-artifacts.sh`) |
| Customer id | `oteemo-devsecops` (`example-customers.ts`, pack `oteemo`) |

### Domain model (summary)

```
Engagement (tree_root)
├── Customer
├── PlatformProfile
├── SecurityControl[]   (domain, stage, blocking, status)
├── PipelineGate[]      (ordered controls, requires_all_pass)
├── Finding[]
└── AgentAssumption[]   (phase: pre|post|both, tool_name, claim, expected_conforms)
```

Aligned with public Oteemo Managed DevSecOps language (continuous security in the pipeline), without claiming proprietary Oteemo internals.

---

## Assumptions under test

| ID | Phase | Tool | Expect SHACL |
|----|-------|------|----------------|
| Happy engagement document | both | n/a (document validate) | **conforms** |
| Sad engagement document | both | n/a | **non-conforms** |
| `asm-pre-deploy-1` | **pre** | `deploy_manifest` | **conforms** (blocking secure controls enabled) |
| `asm-post-scan-critical` | **post** | `scan_image` | **non-conforms** or tool_io_guard **blocks** when critical unwaived finding present |

“Assumption” = structured payload validated as an instance against the Oteemo SHACL shapes (root `Engagement` or nested shapes as implemented by gen-shacl).

---

## Architecture

```
Agent tool call (e.g. deploy_manifest)
        │
        ├─► PRE  tool_io_guard(phase=pre,  pack=oteemo, payload=assumption+context)
        │         └─► px_shacl_validate → SHACL :7004 /validate
        │               ok=false  → refuse tool / surface CoT violations
        │               ok=true   → invoke tool
        │
        └─► POST tool_io_guard(phase=post, pack=oteemo, payload=result+findings)
                  └─► px_shacl_validate → SHACL :7004
                        ok=false → mark run failed / block promotion
                        ok=true  → accept result
```

**Local formal-equivalent:** host `mockInvokeShacl` / pySHACL with `oteemo.shacl.ttl`.  
**Daytona formal:** upload `.px` pack → `shacl-server.py` loads all `*.shacl.ttl` including `oteemo.shacl.ttl`.

---

## Implementation steps

### 1. Generate SHACL from LinkML

```bash
cd 02-products/assistant-ui
bash scripts/generate-linkml-artifacts.sh
# expect: .px/generated/oteemo.shacl.ttl
```

### 2. Ontology / customer state

```bash
cd cloud-agent
npx tsx -e "
import { writeOntologyStateFile } from './src/verification-sandbox/ontology-state.ts';
console.log(writeOntologyStateFile(null, undefined, 'oteemo-devsecops'));
"
```

Optional: open schema graph with customer filter when API supports `?customer=oteemo-devsecops`.

### 3. Wire pack name through validation

Ensure `px_shacl_validate` / host pySHACL path accepts `pack: 'oteemo'` and selects `oteemo.shacl.ttl` (same pattern as `verifier-fleet` / `skydio`). If the dispatcher only special-cases two packs, extend:

- `provider.ts` mock shapes path map
- any `className` default → `Engagement` for oteemo

### 4. Pre-hook matrix (happy)

```ts
await handleToolIoGuard({
  tool: 'deploy_manifest',
  phase: 'pre',
  enforceSchema: true,
  pack: 'oteemo',
  payload: /* fixtures/assumption-pre.happy.json or engagement.happy.yaml as JSON */,
});
// expect: conforms === true, violations []
```

Also:

```ts
await handlePxShaclValidate({
  pack: 'oteemo',
  className: 'Engagement',
  data: /* happy engagement */,
  force: true,
});
```

### 5. Pre-hook matrix (sad)

```ts
await handlePxShaclValidate({
  pack: 'oteemo',
  className: 'Engagement',
  data: /* sad engagement */,
  force: true,
});
// expect: conforms === false, ≥1 violation
```

Agent must **not** call `deploy_manifest` when pre fails.

### 6. Post-hook matrix

After tool `scan_image` returns critical unwaived finding:

```ts
await handleToolIoGuard({
  tool: 'scan_image',
  phase: 'post',
  enforceSchema: true,
  pack: 'oteemo',
  payload: /* pre-context */,
  result: /* fixtures/assumption-post.sad.json tool_result */,
});
// expect: blocking violations or non-conformant structured result
```

### 7. Dual-gate with ontology flags

| Flag | Behavior |
|------|----------|
| `ontologyEnforcement=on` | pre/post SHACL enforced |
| `ontologyEnforcement=off` | hooks skip unless `force: true` |
| `ontologyEditing=on` | CoT may suggest LinkML fixes from violations |

Record CoT via `formatShaclCot` for failed assumptions.

### 8. Formal sandbox smoke

```bash
# formal create uploads .px (includes oteemo shapes after generate)
# then:
curl -s -X POST http://127.0.0.1:7004/validate \
  -H 'Content-Type: application/json' \
  -d '{"pack":"oteemo","className":"Engagement","data":{...happy...}}'
```

Host may use signed preview of 7004 when Daytona is live (`npm run previews:mint` → shacl URL).

---

## Verification plan (acceptance)

| # | Gate | Pass criteria |
|---|------|----------------|
| 1 | Artifacts exist | LinkML + fixtures + `oteemo.shacl.ttl` after generate |
| 2 | Customer registry | `getExampleCustomer('oteemo-devsecops')` non-null |
| 3 | Happy SHACL | `conforms: true` for happy engagement |
| 4 | Sad SHACL | `conforms: false` for sad engagement |
| 5 | Pre tool_io_guard | Happy pre payload passes when enforcement on |
| 6 | Post tool_io_guard | Sad post / critical finding fails or blocks |
| 7 | No sandbox required for unit path | Host pySHACL or mock with pack=oteemo |

---

## Task checklist

- [x] Create Oteemo LinkML metamodel + fixtures + README
- [x] Register `oteemo-devsecops` example customer
- [x] Hook `generate-linkml-artifacts.sh` pack `oteemo`
- [x] Generate `oteemo.shacl.ttl` (`.px/generated/oteemo.shacl.ttl`)
- [x] Extend SHACL pack dispatcher for `oteemo` / class `Engagement` (host mock path)
- [x] Add automated test: happy/sad + pre/post tool_io_guard
- [x] Document runbook in this file after first green smoke

---

## First green smoke (host pySHACL path)

**Entry:** `npm run smoke:oteemo-shacl` → `scripts/smoke-oteemo-shacl-pipeline.ts`

Drives shipped `handlePxSandboxCreate({ forceMock: true })` → `handlePxShaclValidate` / `handleToolIoGuard` with `pack=oteemo`. Nested Engagement JSON→TTL lives in product `scripts/shacl-validate.py` (`json_to_ttl_oteemo`). Host provider uses ESM-safe `spawnSync` + oteemo shapes; mock fallback **never** green-lights `pack=oteemo`.

```bash
# twice for stability; optional capture dir
OTEEMO_PIPELINE_OUT=/path/to/out OTEEMO_PIPELINE_RUN=1 npm run smoke:oteemo-shacl
OTEEMO_PIPELINE_OUT=/path/to/out OTEEMO_PIPELINE_RUN=2 npm run smoke:oteemo-shacl
```

| Check | Expected (first green) |
|-------|------------------------|
| Happy Engagement SHACL | `conforms: true`, `engine: pyshacl` |
| Sad Engagement SHACL | `conforms: false`, ≥1 violation |
| Pre `tool_io_guard` (happy engagement) | `ok: true`, `schema.pre.engine: pyshacl` |
| Post `tool_io_guard` (sad engagement result) | `ok: false`, blocking SHACL violations |
| Mock-only without pySHACL | oteemo pack fails closed (`shacl-mock-oteemo-requires-pyshacl`) |

Artifacts written by the smoke: `oteemo-pipeline-artifacts.txt`, `oteemo-shacl-happy.json`, `oteemo-shacl-sad.json`, `oteemo-tio-pre.json`, `oteemo-tio-post.json`, `oteemo-pipeline-summary-run*.json`.

---

## Risks

| Risk | Mitigation |
|------|------------|
| gen-shacl missing on machine | Document conda/linkml install; CI image with gen-shacl |
| Nested objects vs flat SHACL | Prefer validating full `Engagement` document; tune shapes if gen-shacl is shallow |
| Agent bypasses hooks | Require `ontologyEnforcement` in agent MCP path; refuse tools without dual-gate when on |
| 5 min sandbox auto-stop | Generate + unit-test on host; use sandbox only for live :7004 proof |

---

## Success criteria

1. Oteemo LinkML pack is first-class under `.px/linkml/oteemo`.
2. SHACL derived from that pack is the **shape set** used by `:7004` for `pack=oteemo`.
3. Pre-hook tests agent **deploy** assumptions; post-hook tests **scan/findings** assumptions.
4. Happy/sad fixtures prove both green and red paths without relying on chat history URLs.

---

## Cascade extension: SHACL → Lean 4 → GraphQL

After SHACL, pre/post hooks run two more LinkML-derived layers:

| Order | Layer | Artifact | Host entry |
|-------|--------|----------|------------|
| 1 | SHACL | `oteemo.shacl.ttl` | pySHACL (existing) |
| 2 | Lean 4 | `PxCloudAgent/Generated/Oteemo.lean` + `oteemo.lean-rules.json` | `invokeLeanValidate` / lake build |
| 3 | GraphQL | `oteemo.graphql` + `oteemo.resolvers.json` | `invokeGraphqlValidate` |

**Generators**

- `assistant-ui/scripts/linkml-to-lean.py`
- `assistant-ui/scripts/linkml-to-resolvers.py` (resolvers from LinkML `graphql.*` annotations)
- Wired from `generate-linkml-artifacts.sh` for pack `oteemo`

**Hooks**

- `tool_io_guard` with `enforceSchema: true` defaults to `layers: ['shacl','lean','graphql']`
- `px_validate_cascade` for explicit full-stack validate
- Implementation: `src/verification-sandbox/validation-cascade.ts`

**Smoke**

```bash
npm run smoke:oteemo-cascade
# evidence: .gsd/evidence/oteemo-validation-cascade/summary.json
```

First green cascade (happy): SHACL `pyshacl` + Lean `lean-rules-v1+sources` + GraphQL `linkml-resolvers-v1` all ok; lake build green; sad short-circuits fail.

---

## Structured `ontologyHookContext` (pre/post)

Every `tool_io_guard` with `enforceSchema` returns **`ontologyHookContext`**:

| Field | Meaning |
|-------|---------|
| `ontologies` | LinkML packs (id, pack, metamodel, rootClass, shaclFile, relevant) |
| `guardrails` | `formal.guardrails.content` (:7003), cascade layers, `GuardrailsAI.*` routing names, pack domains/stages |
| `shapes` | SHACL/Lean target classes engaged by payload |
| `relationships` | LinkML/resolver edges (`Engagement.customer→Customer`, …) with `presentInPayload` |
| `endpoint` | When sandbox active: provider, sandboxId, shaclPort 7004, guardrailsPort 7003 |

```bash
# host
npm run smoke:oteemo-hook-context
npm run test:hook-context
npm run smoke:mcp-tool-surface   # full MCP registry + always-on defaults + scope tags

# live Daytona (requires DAYTONA_API_KEY)
set -a && source .env && set +a
npm run smoke:oteemo-hook-context:live
# evidence: .gsd/evidence/oteemo-hook-context/live-*.json
# always-on: .gsd/evidence/px-pipeline-always/mcp-surface.json
```

### Always-on pipeline (operator)

| Mechanism | Effect |
|-----------|--------|
| `enforceSchema` default **true** on `tool_io_guard` | Cascade runs unless explicitly `false` |
| `ontologyEnforcement` default **true** | Blocking gates active (`.px/config.json`) |
| `PX_VALIDATION_PROFILE=strict` | Cannot turn enforcement off without `PX_ALLOW_ENFORCE_OFF=1` |
| MCP `CallTool` middleware | Gated tools (daytona-exec/shell/batch/…) get pre/post `tool_io_guard` |
| `px_ontology_scope` | Cheap always-on tag (`there_is_one_relevant_ontology`) without full SHACL |
| `px_pipeline_ready` | Artifact + enforcement readiness |
| `px_pack_resolve` | skydio/oteemo/verifier-fleet from text |
| Mastra MCP | Registry-driven — all `VERIFICATION_MCP_TOOLS` registered |
