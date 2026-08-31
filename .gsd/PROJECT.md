# PROJECT — Formal happy-path (cloud-agent lens)

## Vision

Prove an end-to-end **formal happy path** for dafny2js, dafny-replay, and stack enforcement — with cloud-agent as the orchestration / verification host and assistant-ui as the product formal surface.

## Constraints

- Never fabricate ontology classes; use `.px/` pointers + px-validate.
- Prefer cloud-agent verify suite + smoke evidence over rewriting assistant-ui.
- Do not auto-spam GitHub Issues from the PRD pack.
- Document blockers honestly when Dafny/dotnet/Alloy jars missing.

## Success (repo-scoped)

1. `.px/` ontology home + `.gsd/` durable state exist and are agent-loadable.
2. cloud-agent `verify:*` / `smoke:formal` / `test:prd` are green or skip-documented.
3. M0–M3 issue graph tracked with evidence paths; product-only gaps deferred with rationale.
