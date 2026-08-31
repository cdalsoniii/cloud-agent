# Class / concept index (grounded only)

Do **not** add classes here without a pointer to px-validate approved ontology or an existing formal artifact.

## Local cloud-agent (from `config/verification/`)

| Concept | Artifact | Notes |
|---------|----------|-------|
| SandboxLifecycle | `config/verification/quint/sandbox-lifecycle.qnt` | create→bootstrap→exec→destroy |
| ValidationGate | `config/verification/dafny/ValidationGate.dfy` | PR create requires validation pass |
| TokenIsolation | `config/verification/dafny/TokenIsolation.dfy` | BrightforestX vs personal tokens |
| MidspiralTools | `config/verification/alloy/MidspiralTools.als` | acyclic tool deps; SDK-only Daytona |
| BusinessRules | `config/verification/alloy/BusinessRules.als` | non-contradictory rule conditions |

## assistant-ui product (pointers)

| Concept | Artifact | Notes |
|---------|----------|-------|
| Replay | `config/verification/lemma/lemmafit/dafny/Replay.dfy` | under assistant-ui |
| VerifiedKernel / createKernel | `packages/verified-kernels/src/kernel.ts` | Do/Undo/Redo Inv |
| dafny2js API | `packages/web/src/app/api/verify/dafny2js` | needs `DAFNY2JS_PATH` |
| dafny-replay API | `packages/web/src/app/api/verify/dafny-replay` | verify/compile/verify-app |

## px-validate (canonical ontology)

See `pointers.yaml` → `px_validate.paths.ontology_classes` and `formal/shared/{events,types}.yaml`.

When Surreal/MCP is healthy:

```text
MCP user-px-validate → get_approved_classes
MCP user-px-validate → ontology_trace { class_name }
```

If MCP fails (missing `approved_class` table or LinkML file), treat disk paths under `formal/` as read-only ground truth and do not invent replacements.

## PRD milestone themes (planning, not new ontology)

Themes from `artifacts/prd/smoke-formal-happy-path/`: `dafny2js`, `dafny-replay`, `formal-stack`, `happy-path`. Tracked in `.gsd/`, not as ontology classes.
