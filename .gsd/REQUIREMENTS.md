# REQUIREMENTS — traced to PRD pack

Source: `artifacts/prd/smoke-formal-happy-path/04-PRD.md`

| ID | Requirement | Milestone | Status |
|----|-------------|-----------|--------|
| R1 | Dafny proofs for Replay / verification modules | M0 | cloud-agent Dafny local; Replay via assistant-ui pointer |
| R2 | JS kernels generated (`build:dafny` → verified-kernels) | M0/M1 | product path; smoke inventory |
| R3 | POST /api/verify/dafny2js happy path | M0 | API route exists; env `DAFNY2JS_PATH` often unset |
| R4 | POST /api/verify/dafny-replay verify/compile/verify-app | M1 | API route exists; runtime blocked without tooling |
| R5 | Runtime kernel Inv Do/Undo/Redo | M1 | verified-kernels `createKernel` present |
| R6 | Midspiral claimcheck on chat/build | M1 | product gap; tracked |
| R7 | CI formal-verification.yml green | M2 | cloud-agent workflow present |
| R8 | E2E formal happy path (not Petstore) | M2/M3 | `smoke:formal` in cloud-agent |

## Out of scope (v1)

- Auto-creating GitHub Issues
- Full Lean/Apalache expansion beyond stubs
- Installing `@assistant-ui/react` product rewrite (QW-1) inside cloud-agent
