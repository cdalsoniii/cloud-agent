# Formal / verification event pointers

## cloud-agent

| Event / gate | Where |
|--------------|-------|
| Formal CI | `.github/workflows/formal-verification.yml` |
| Local verify | `scripts/verify-local.sh` → evidence under `.gsd/evidence/` |
| Smoke happy path | `scripts/smoke-formal-happy-path.sh` |
| Pybatch formal_suite | `pybatch/` jobs with `validation.formal_suite` |

## px-validate

Shared event vocabulary: `formal/shared/events.yaml` (via `PX_VALIDATE_ROOT` / pointers).

## assistant-ui

Trace emission / claimcheck / verify APIs under `packages/web/src/app/api/verify/` — see `.px/pointers.yaml`.
