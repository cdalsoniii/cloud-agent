# Formal plan: always-on validation pipeline (offline verify before live)

**Status:** Formalized + offline-checked  
**Related:** `docs/plans/oteemo-shacl-pre-post-tool-hooks.md`, Quint `config/verification/quint/validation-pipeline-always.qnt`

## 1. Preconditions

| ID | Precondition |
|----|----------------|
| P1 | LinkML packs exist under product `.px/linkml/{oteemo,skydio,verifiers}` |
| P2 | Generated artifacts: `*.shacl.ttl` at minimum; lean-rules/resolvers for oteemo cascade |
| P3 | `ontologyEnforcement == true` in `.px/config.json` (or `PX_ONTOLOGY_ENFORCE=1`) |
| P4 | Agents use `cloud-agent-mastra` MCP as the choke point for gated tools |
| P5 | Offline suite green before live Daytona claims |

## 2. Postconditions (success)

| ID | Postcondition |
|----|----------------|
| Q1 | Gated MCP tools never execute when pre `tool_io_guard` returns `ok=false` |
| Q2 | `tool_io_guard` without explicit `enforceSchema:false` runs cascade when enforcement on |
| Q3 | Pack-scoped scope calls set `relevantOntologyTag` (one/multiple/none) |
| Q4 | Post `ok=false` marks run blocked (promotion / publish path) |
| Q5 | Mock SHACL never green-lights `pack=oteemo` without pySHACL |

## 3. Invariants

| ID | Invariant | Machine check |
|----|-----------|----------------|
| I1 | Pre fail ⇒ ¬tool_executed | Quint `PreFailImpliesNoExecute` |
| I2 | Gated+enforced execute ⇒ pre_ok ∧ cascade_ran | Quint `ExecuteImpliesPreOk`, `GatedDoneRanCascade` |
| I3 | blocked_post ⇒ tool_executed | Quint `BlockedPostAfterExec` |
| I4 | Enforcement off is explicit in strict profile | Config + code (`PX_ALLOW_ENFORCE_OFF`) |
| I5 | Chat without tools is not cascade-gated | Host plugin UserPromptSubmit + Stop; structured cascade still needs JSON instance |
| I6 | PreToolUse runs real tool_io_guard on input | harness `pre-tool-gate.sh` → `run-guard.ts` → `enforceToolIo` |
| I7 | PostToolUse records; Stop blocks post fail | harness `post-tool-gate.sh` + `stop-scope-gate.sh` |
| I8 | MCP post hard-blocks gated tools | `mcp-server.ts` returns `isError` on validation_post_blocked |

## 4. Ordered steps (offline → live)

```
1. quint typecheck/run validation-pipeline-always.qnt
2. npm run smoke:mcp-tool-surface
3. npm run smoke:oteemo-hook-context
4. npm run test:hook-context
5. (optional) npm run verify:all / smoke:formal
6. ONLY THEN: VERIFIER_LIVE=1 smoke:oteemo-hook-context:live
```

## 5. Issue catalog (severity + mitigation + residual)

| Severity | Issue | Mitigation | Residual risk |
|----------|--------|------------|---------------|
| **Critical** | Agent answers pack-scoped Q without tools | Skill + **host plugin** UserPromptSubmit → `px_ontology_scope` | Without plugin, still soft |
| **Critical** | Second MCP (raw Daytona) bypasses middleware | Single choke-point MCP policy | Process/compliance |
| **High** | `ontologyEnforcement=off` | Default on; strict profile | Env override abuse |
| **High** | Nested SHACL / wrong TTL nesting | Full Engagement + oteemo nested TTL map | New classes need map updates |
| **High** | Mock green-light oteemo | Fail-closed mock code path | Host must have pySHACL for green |
| **Medium** | Pack mis-resolve | Explicit pack wins; text before tool map | Ambiguous prompts |
| **Medium** | 5 min sandbox auto-stop | Host unit path; short live smoke | Flaky live |
| **Medium** | Double-gate verification tools | UNGATED set includes tool_io_guard | Misclassification of new tools |
| **Low** | Guardrails AI names are routing labels only | Document; formal :7003 is real service | No full GA product |
| **Low** | gen-shacl missing | CI image / conda | Local dev only |

## 6. What offline formal models prove

| Artifact | Proves |
|----------|--------|
| `validation-pipeline-always.qnt` | Pre-refuse / post-block FSM for gated tools under enforcement |
| `sandbox-lifecycle.qnt` | No use-after-destroy for sandboxes |
| `ValidationGate.dfy` | PR create only when validation passed |
| Host smokes | Registry complete; defaults; oteemo pre/post context |

## 7. What they do **not** prove

- Live Daytona availability or network  
- That every Cursor/Grok session is wired to this MCP  
- Full SHACL semantics of all LinkML packs (instance-level needs pySHACL)  
- Chat turns without hooks  

## 8. Success criteria before live

- [x] Quint module typechecks and happy/pre_fail/post_block runs execute  
- [x] `smoke:mcp-tool-surface` ok  
- [x] `smoke:oteemo-hook-context` ok  
- [ ] Live only after above green (operator checklist step 5)
