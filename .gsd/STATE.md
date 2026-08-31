# GSD State — cloud-agent formal happy path

**Updated:** 2026-07-21 (happy-path e2e Daytona PRs #3–#22)  
**Active Milestone:** Happy-path e2e merge (M0–M4 PRs open)  
**Phase:** PR review → merge → deepen assertions  
**PRD pack:** `artifacts/prd/expand-web-formal-stack/`  
**PR (host expand):** https://github.com/BrightforestX/assistant-ui/pull/1  
**PR (sandbox SDLC M0 formal):** https://github.com/BrightforestX/assistant-ui/pull/2  
**PRs (happy-path e2e):** https://github.com/BrightforestX/assistant-ui/pulls?q=is%3Apr+e2e%2Fhappy-path (#3–#22)


## Milestone fleet (2026-07-21)

| Item | Result |
|------|--------|
| Jobs | `pybatch/jobs-milestone-fleet-complete.json` |
| PRs | #23–#41 (19/19 ok) |
| Evidence | `.gsd/evidence/20260721T151200Z-milestone-fleet-complete.md` |

## Position

| Milestone | Status |
|-----------|--------|
| M0 Toolchain & API baseline | ✅ accepted (cloud-agent) |
| M1 Prove → translate → kernels | 🔄 partial → **cloud-agent slice advanced** (FORMAL-004/005 done; FORMAL-006 build-gate accepted; DF-* still product) |
| M2 Runtime gates & gap closure | 🔄 partial (FORMAL-007/008/009 cloud-agent done; M/QW open) |
| M3 CI + E2E happy path | ✅ sandbox PRs #3–#22 (exact-file suite); merge + deepen pending |

## Delta this session

| Item | Before | After |
|------|--------|-------|
| OpenCode SDK events runner | missing | `scripts/opencode-sdk-milestone.ts` + npm scripts + `docs/opencode-sdk-milestone.md` |
| GSD ↔ Baseten drive | undocumented | `scripts/gsd-baseten-drive.sh` + `.gsd/config.json` `baseten` block |
| FORMAL-006 claimcheck | open / blocked | **build path accepted** (evidence); chat hard-gate still soft-suggest |
| Daytona + OpenCode | not exercised for milestones | Sandbox create/serve/auth/session OK; SSE via preview empty; prompt hung on model |
| Baseten Model APIs | unknown | Direct `https://inference.baseten.co/v1` chat OK; ngrok `BASETEN_PROXY_BASE_URL` timed out |
| Local gates | prior green | Re-confirmed: `test:prd` 9/9; `smoke:formal` 20 PASS / 1 SKIP |

## Web formal expansion (2026-07-21)

| Item | Result |
|------|--------|
| Runner | `npm run formal:expand-web` → Daytona sandbox `644eaaaf-…` |
| Specs | Quint `verify-api-happy-path.qnt`, Dafny `VerifyApi.dfy` |
| Runtime | `/api/traces` → Quint monitor bridge; chat claimcheck hard gate |
| Tests | `packages/web/src/__tests__/formal/verify-api-happy-path.test.ts` |
| PR | https://github.com/BrightforestX/assistant-ui/pull/1 → `feat/mastra-integration` |
| Jobs | `pybatch/jobs-from-prd-expand-web-formal-stack.json` (branch `feat/mastra-integration`) |

## SDLC BrightforestX fix (2026-07-21)

| Item | Result |
|------|--------|
| Proxy path | Keep `BASETEN_PROXY_BASE_URL` + host `baseten-proxy.js` `/health` + ngrok (Daytona IPs blocked) |
| Model smoke | Green — JSON `files` sample via `baseten-proxy/qwen-coder` |
| Jobs base | `formal/expand-web-stack-20260721` |
| Auth | gh-oauth `gho_` forced into GIT/GITHUB tokens |
| Sandbox PR | **https://github.com/BrightforestX/assistant-ui/pull/2** (`ok=true`) |
| Evidence | `.gsd/evidence/20260721T060250Z-expand-web-formal-stack-sandbox-pr.md` |

## Happy-path e2e suite (2026-07-21)

| Item | Result |
|------|--------|
| Plan | `assistant-ui_happy_path_e2e_5d232d9c` |
| Jobs | `pybatch/jobs-assistant-ui-happy-path-e2e.json` |
| Path | Daytona + baseten-proxy/ngrok + `baseten-proxy/qwen-coder` |
| PRs | **#3–#22** all `ok=true` (20 exact-file PRs) |
| Evidence | `.gsd/evidence/20260721T063200Z-happy-path-e2e-sandbox-prs.md` |
| Chain fix | `_extract_json` tolerates `\'` escapes |

## Next action

1. Review/merge [PR #1](https://github.com/BrightforestX/assistant-ui/pull/1) + [PR #2](https://github.com/BrightforestX/assistant-ui/pull/2).
2. Run M1/M2 with same proxy path: `SDLC_JOB_FILTER=expand-web-formal-stack-m1,...`.
3. Set `DAFNY2JS_PATH` for live dafny2js API smoke; install dafny on Daytona snapshot for hard verify.

## Blockers

- `DAFNY2JS_PATH` unset — no dafny2js `.csproj` discovered under assistant-ui; live POST `/api/verify/dafny2js` still SKIP in smoke
- Daytona preview SSE: `event.subscribe()` connects but delivered **0** events through proxy (empty `.jsonl`); prompts via preview HTTP can hang >120s waiting on model
- SDK 1.18.x body shaping ≠ OpenCode serve **1.1.35** — runner uses **raw HTTP** for auth/prompt; SDK for `event.subscribe()`
- Product DF/M/QW gaps remain in `../../02-products/assistant-ui` (see `.gsd/gaps/tracking.md`)
- px-validate MCP `get_approved_classes` still unavailable — use `.px/pointers.yaml` disk grounding

## Recent evidence (2026-07-21)

| Artifact | Result |
|----------|--------|
| `.gsd/evidence/20260721T052420Z-test-prd.txt` | 9/9 pass |
| `.gsd/evidence/20260721T052355Z-smoke-formal.md` | 20 PASS, 0 FAIL, 1 SKIP (`DAFNY2JS_PATH`) |
| `.gsd/evidence/20260721T052500Z-baseten-inference-direct.txt` | Baseten Model APIs models+chat HTTP 200 |
| `.gsd/evidence/20260721T052400Z-formal-006-claimcheck.md` | Build claimcheck gate documented |
| `.gsd/evidence/20260721T052311Z-opencode-sdk-m1-dry-run.md` | Dry-run plan |
| `.gsd/evidence/20260721T052312Z-gsd-baseten-query.txt` | `gsd headless query` with Baseten env |
| `.gsd/evidence/20260721T052600Z-opencode-daytona-m1.txt` | First Daytona run (401 before preview token) |
| `.gsd/evidence/20260721T053400Z-opencode-daytona-raw-prompt.txt` | Auth+session OK; prompt timeout; SSE empty |
| `.gsd/evidence/20260721T053600Z-daytona-toolbox-and-cleanup.txt` | In-sandbox health 1.1.35; sandbox destroyed |
| `.gsd/evidence/20260721T054500Z-moonlit-fiddle-outcomes.md` | Moonlit-fiddle a11y plan: Daytona `644eaaaf-…`, axe `[]`, desktop 9/9 + mobile 11/11 |
| `.gsd/evidence/20260721T060250Z-expand-web-formal-stack-sandbox-pr.md` | Sandbox SDLC M0 → PR #2 |
| `.gsd/evidence/20260721T060224Z-expand-web-formal-stack-m0-pr.log` | Batch log `ok=true` + pr_url |

## Moonlit-fiddle (2026-07-21)

Executed `~/.claude/plans/create-a-plan-to-moonlit-fiddle.md` against Assistant UI via remote Daytona + local patches in `../../02-products/assistant-ui`. Final `partners/audit` axe dump empty; Playwright desktop/mobile green. Sandbox kept: `644eaaaf-f1e9-4dd0-9645-53b260b1027e`. Runner: `scripts/moonlit-fiddle-daytona.ts`.

## E2E validation & proof session (2026-07-21 ~06:55 UTC)

Ran the cross-repo validation/proof task (formal + sandbox + cost + Surreal + critical path).

| Goal | Result | Evidence |
|------|--------|----------|
| A formal (local) | verify:all 5/0/1 · smoke:formal 20/0/1 · test:prd 9/9 | `.gsd/evidence/20260721-cloud-agent-formal-matrix.md` |
| A formal (remote) | quint PASS on Daytona `644eaaaf-…` (dafny/alloy SKIP — snapshot Node-only) | `.gsd/evidence/20260721T064027Z-cloud-agent-sandbox-formal.txt`; `scripts/remote-formal-daytona.sh` |
| B cost tracking | assistant-ui TUI `costs.ts` — live Baseten `/models` pricing + sandbox $/min; persists to `chain_execution` | `.gsd/evidence/tui-cost-tracking/` (safe mirror), `20260721-tui-cost-*` |
| C sandbox→Surreal | real Daytona stdout → `sandbox_log` → read back (repo tool + raw); `slog-1784616910476-…` | `scripts/prove-sandbox-logs-surreal.sh`, `.gsd/evidence/20260721T065509Z-prove-sandbox-logs-surreal.txt`, `20260721-surreal-sandbox-logs-proof.md` |
| D critical path | `.gsd/CRITICAL_PATH_FEATURE.md` (+ pointer `assistant-ui/docs/critical-path-feature.md`) | this repo |

New scripts: `scripts/remote-formal-daytona.sh`, `scripts/prove-sandbox-logs-surreal.sh`.

**Findings/blockers this session:**
- SurrealDB IPv4/IPv6 split on :8000 — Node `localhost`→IPv6 docker container `cloud-agent-surrealdb`
  (intended target); a separate host `surreal` on `127.0.0.1` is unrelated. Query the container via
  `http://[::1]:8000`. Not a data-loss bug; documented in the proof md.
- Remote dafny/alloy/tla SKIP (default `daytona-large` snapshot is Node-only). Use a
  dafny+dotnet+java snapshot for full remote formal.
- assistant-ui is under active parallel-agent churn (untracked files got wiped mid-session);
  TUI cost-tracking source is mirrored to `cloud-agent/.gsd/evidence/tui-cost-tracking/` for durability.

## Load order for agents

1. `.gsd/STATE.md` (this file)
2. `.px/README.md`
3. Active milestone `M*-CONTEXT.md` + `M*-ROADMAP.md`
4. Execute → verify → update this file

## Runner commands

```bash
npm run opencode:milestone:dry -- --milestone M1
npm run opencode:milestone:daytona -- --milestone M1
npm run gsd:baseten:query
npm run smoke:formal && npm run test:prd && npm run verify:all
```

## expand-web-formal-stack real batch (2026-07-21 05:50 UTC)

- Ran REAL pybatch→Daytona→Chains (WAVE_SIZE=1, 3 jobs). Log: `.gsd/evidence/20260721T054900Z-expand-web-formal-stack-batch.log`
- Results: `pybatch/results-jobs-from-prd-expand-web-formal-stack.json`
- OAuth (`gho_`) forced into GIT/GITHUB/GH/DAYTONA_GITHUB tokens; clone OK; no ghp_ auth fail.
- All 3 jobs `ok=false` (empty model diffs; `feat/mastra-integration` missing verify-local/dafny paths). No new PRs. Existing: https://github.com/BrightforestX/assistant-ui/pull/1
- Runner/jobs model tweaks left **uncommitted**.


## OpenCode SDK runner (2026-08-02T00:30:54.222Z)

- OpenCode SDK dry-run for `M1` recorded at `.gsd/evidence/20260802T003054Z-opencode-sdk-m1-dry-run.md`


## OpenCode SDK runner (2026-08-02T00:31:11.165Z)

- OpenCode SDK dry-run for `M1` recorded at `.gsd/evidence/20260802T003111Z-opencode-sdk-m1-dry-run.md`


## OpenCode SDK runner (2026-08-02T00:31:16.512Z)

- Daytona OpenCode bootstrap failed. Evidence: `.gsd/evidence/20260802T003116Z-opencode-sdk-daytona-fail.md`
