# M6 OSDK map — platform cross-link evidence (2026-07-21)

Platform (cloud-agent) verify/smoke for the product M6 milestone
`../../02-products/assistant-ui/.gsd/milestones/M6-osdk-deel-asana-map/`
(OSDK "Global workforce + delivery map": synthetic Deel × Asana; ontology-driven SDK regen; SurrealDB TS; Midspiral tools).

## Platform smoke

- `npm run smoke:formal` → **20 PASS / 0 FAIL / 1 SKIP** (SKIP = `DAFNY2JS_PATH` unset). Report: `.gsd/evidence/20260721T070531Z-smoke-formal.md`.
- Toolchain: dafny 4.11.0, quint available (cli), dotnet 8.0.423.

## Product formal (assistant-ui)

- `quint typecheck ../../02-products/assistant-ui/config/verification/quint/osdk-xref.qnt` → exit 0 (PASS).
- Alloy `OsdkXref.als` present (analyzer not on PATH → SKIP honest).

## Daytona remote execution

- Reused fleet sandbox `5a7a96ff-57cd-4507-9183-7ba07583e0c5` (node v25.9.0) via `daytona sandbox exec`.
- M6 cross-ref logic ran remotely: `PASS blocked<=>blockedTask`, `PASS deterministic sort`, `M6_REMOTE_ALL_PASS` (RC=0).
- Prior probe: `644eaaaf-f1e9-4dd0-9645-53b260b1027e` (repo present). Shared fleet → sandbox availability volatile.

## Pointer

`.px/pointers.yaml` → `osdk_deel_asana_map` links the product ontology, regen command, formal specs, and this evidence glob (`.gsd/evidence/20260721-m6-*`).
