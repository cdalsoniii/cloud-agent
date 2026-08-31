# HANDOFF

## For the next agent

0. **E2E validation & proof (2026-07-21)** — see `.gsd/STATE.md` "E2E validation & proof session".
   - Critical path: `.gsd/CRITICAL_PATH_FEATURE.md`.
   - Formal matrix: `.gsd/evidence/20260721-cloud-agent-formal-matrix.md`.
   - Remote formal on Daytona: `bash scripts/remote-formal-daytona.sh <SBX>`.
   - Sandbox→SurrealDB proof: `bash scripts/prove-sandbox-logs-surreal.sh <SBX>`.
   - assistant-ui CLI costs: `npm run costs:tui -- --live [--sandbox-seconds N --persist]`
     (source mirrored in `.gsd/evidence/tui-cost-tracking/` since assistant-ui gets reset by parallel agents).
   - SurrealDB gotcha: query the compose container via `http://[::1]:8000` (Node `localhost`→IPv6),
     NOT `127.0.0.1:8000` (separate host `surreal` process).
1. Read `.gsd/STATE.md` and `.px/README.md`.
2. OpenCode SDK milestone runner is live: `docs/opencode-sdk-milestone.md`.
3. GSD + Baseten env wrapper: `npm run gsd:baseten:query` / `bash scripts/gsd-baseten-drive.sh next`.
4. Prefer **direct** Baseten Model APIs (`https://inference.baseten.co/v1`) over flaky ngrok `BASETEN_PROXY_BASE_URL`.
5. Product gaps (assistant-ui): chat hard claimcheck, `DAFNY2JS_PATH`, M/QW — only if working in `../../02-products/assistant-ui`.
6. Append decisions to `.gsd/DECISIONS.md`; update `gaps/tracking.md` when closing gaps.
7. Do not open GitHub Issues from the PRD pack.
8. Do not bash-source `.env` (Fly tokens break shells) — use dotenv / `gsd-baseten-drive.sh`.

## Exact next commands

```bash
cd experiments/01-platform/cloud-agent

# GSD position (Baseten env exported)
npm run gsd:baseten:query

# OpenCode SDK dry-run / Daytona (SDK-first)
npm run opencode:milestone:dry -- --milestone M2
OPENCODE_MODEL=baseten/openai/gpt-oss-120b npm run opencode:milestone:daytona -- --milestone M1

# Optional: upgrade OpenCode inside sandbox to match SDK 1.18
OPENCODE_FORCE_UPGRADE=1 npm run opencode:milestone:daytona -- --milestone M1

# Gates
npm run test:prd
npm run smoke:formal
npm run verify:all
```

## Formal PRD pipeline

Already exists — reuse:

- Skill: `.agents/skills/formal-system-prd/SKILL.md`
- CLI: `npm run prd:plan`
- Tests: `npm run test:prd`
- Pack: `artifacts/prd/smoke-formal-happy-path/`

Do **not** recreate Formal System PRD todos if completed.

## Known integration notes

- OpenCode serve in Daytona snapshot may be **1.1.35** while `@opencode-ai/sdk` is **1.18.x** — runner uses raw HTTP for `/auth` + `/session/.../message` and SDK for `event.subscribe()`.
- Daytona private preview requires `x-daytona-preview-token` (auto-fetched).
- Preview proxy may drop SSE events — treat empty event files as proxy limitation, not “no work happened”.
