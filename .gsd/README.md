# `.gsd/` — OpenGSD project state (cloud-agent)

Aligned with [Open GSD](https://www.opengsd.net/) / `@opengsd/gsd-core` spirit and local **gsd-2** conventions (`.gsd/STATE.md` first, milestone → slice → task, verify before done).

## Agent loop (every session)

```
1. Read .gsd/STATE.md          → current position + next action
2. Read .px/README.md          → ontology / formal pointers
3. Read active milestone CONTEXT + ROADMAP under .gsd/milestones/
4. Execute one right-sized task (fits one context window)
5. Run verification gates      → npm run smoke:formal / verify:all / test:prd
6. Write evidence              → .gsd/evidence/<date>-*.txt|md
7. Update STATE.md + issue checkboxes + DECISIONS.md if needed
```

## Layout

```
.gsd/
├── README.md
├── config.json
├── PROJECT.md
├── REQUIREMENTS.md
├── ROADMAP.md
├── STATE.md                 # ← always load first
├── DECISIONS.md
├── VALIDATION.md
├── HANDOFF.md
├── gaps/tracking.md
├── evidence/                # verification outputs
└── milestones/
    ├── M0-toolchain-api/
    ├── M1-prove-translate/
    ├── M2-runtime-gates/
    └── M3-ci-e2e/
```

## PRD source of truth

Milestones M0–M3 come from `artifacts/prd/smoke-formal-happy-path/` (especially `06-MILESTONES.md`, `03-ISSUE_BACKLOG.md`).

**Scope note:** Full assistant-ui product rewrite is out of band. In this repo we (1) keep cloud-agent verify suite green, (2) maintain pointers + smoke against `../../02-products/assistant-ui`, (3) track product gaps as blocked/deferred with evidence.

## Continue commands

```bash
cd experiments/01-platform/cloud-agent
# position
sed -n '1,40p' .gsd/STATE.md
npm run gsd:baseten:query

# OpenCode SDK events (Daytona or local serve)
npm run opencode:milestone:dry -- --milestone M1
npm run opencode:milestone:daytona -- --milestone M1
# docs: docs/opencode-sdk-milestone.md

# verify + smoke
npm run test:prd
npm run verify:tools
npm run smoke:formal
npm run verify:all

# optional product probe (paths only; no GitHub Issues)
ASSISTANT_UI_ROOT=../../02-products/assistant-ui npm run smoke:formal
```

## Baseten + GSD

See `.gsd/config.json` → `baseten` and `scripts/gsd-baseten-drive.sh`. Load env via dotenv (never bash-source `.env`).
