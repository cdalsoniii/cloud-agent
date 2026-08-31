# Gap tracking (from assistant-ui `.gap-analysis.md`)

Status values: `open` | `deferred` | `blocked` | `closed-cloud-agent-proxy` | `closed`

| ID | Title | Status | Evidence / notes |
|----|-------|--------|------------------|
| DF-1 | Shared verified kernel state architecture | deferred | Product redesign; smoke confirms kernels package exists |
| DF-2 | Full formal CI tool install (assistant-ui) | open | cloud-agent `.github/workflows/formal-verification.yml` installs tools; assistant-ui `verify.yml` still gap |
| DF-3 | Quint sidecar runtime monitor | deferred | Product `packages/monitor` not in cloud-agent |
| DF-4 | Advisor self-correction loop | deferred | `packages/advisor` product work |
| DF-5 | Lean 4 deep-property verification | deferred | Optional stubs only |
| M-1 | Real Dafny compilation in bridge | open | Remove stub transpile in assistant-ui dafny-bridge |
| M-2 | Real Quint CLI in monitor | open | Product |
| M-3 | Shared `packages/kernels` workspace | deferred | Product packaging |
| M-4 | Advisor as Baseten Chain | deferred | Product |
| M-5 | Runtime trace replay tests | open | Product |
| QW-1 | Install assistant-ui library | deferred | Product UI |
| QW-2 | `/api/traces` ingestion route | closed | Exists + Quint monitor bridge in PR #1 |

Updated: 2026-07-21
