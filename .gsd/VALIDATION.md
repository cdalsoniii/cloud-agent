# VALIDATION gates

| Gate | Command | Evidence |
|------|---------|----------|
| PRD unit tests | `npm run test:prd` | `.gsd/evidence/*-test-prd.txt` |
| Tool presence | `npm run verify:tools` | `.gsd/evidence/*-verify-tools.txt` |
| Formal suites | `npm run verify:all` | `.gsd/evidence/*-verify-all.txt` |
| Happy-path smoke | `npm run smoke:formal` | `.gsd/evidence/*-smoke-formal.md` |

## Pass criteria

- `test:prd` — exit 0
- `verify:all` — 0 FAIL (SKIP allowed if tool missing, must be listed in STATE blockers)
- `smoke:formal` — cloud-agent checks PASS; assistant-ui path probes documented PASS/FAIL/SKIP

## Fail → fix loop

1. Capture stderr to `.gsd/evidence/`
2. Fix in cloud-agent if local; else mark blocker in `STATE.md` + `gaps/tracking.md`
3. Re-run gate before flipping issue to done
