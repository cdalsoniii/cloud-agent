# M0 SUMMARY

**Status:** accepted (cloud-agent scope) — 2026-07-21

## Evidence

- Local Dafny sources: `config/verification/dafny/`
- Tooling docs: `config/verification/README.md`, `.px/pointers.yaml`
- Smoke: `npm run smoke:formal` → `.gsd/evidence/`
- verify: `npm run verify:dafny` / `verify:all`

## Acceptance notes

| Issue | Outcome |
|-------|---------|
| FORMAL-001 | cloud-agent Dafny specs are the local prove target; Replay.dfy lives under assistant-ui lemmafit path |
| FORMAL-002 | No `build:dafny` in cloud-agent; product script + `packages/verified-kernels` verified present via smoke |
| FORMAL-003 | Route exists; runtime happy path requires `DAFNY2JS_PATH` + dotnet — documented as env blocker when unset |
