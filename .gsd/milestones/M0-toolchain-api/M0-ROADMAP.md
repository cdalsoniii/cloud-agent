# M0: Toolchain & API baseline

**Vision:** Local + documented toolchain so later milestones are unblocked.

**Success criteria:**
- cloud-agent Dafny specs verify locally (or CI)
- Tool check documented
- dafny2js / verified-kernels / Replay paths inventoried with env deps

## Issues

- [x] **FORMAL-001** Prove Dafny (cloud-agent `ValidationGate.dfy` + `TokenIsolation.dfy`; Replay.dfy pointer)
- [x] **FORMAL-002** Document build:dafny → `packages/verified-kernels` (assistant-ui pointer + smoke inventory)
- [x] **FORMAL-003** Document POST `/api/verify/dafny2js` + `DAFNY2JS_PATH` failure modes

## Exit

- [x] All M0 issues closed or accepted with evidence (see M0-SUMMARY.md)
- [x] M1 unblocked for cloud-agent verify/smoke track
