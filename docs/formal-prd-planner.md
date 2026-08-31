# Formal System PRD Planner

Turn a natural-language formal-validation request into a durable planning pack: analysis, issue backlog, PRD, specs, and milestones — grounded on assistant-ui (dafny2js, dafny-replay, verified-kernels, Midspiral, CI).

## Quick start

```bash
cd partners/experiments/01-platform/cloud-agent

npm run prd:plan -- \
  --request "Formally validate and test the full happy path flows that make sure dafny2js, dafny-replay, and the formal validation stack enforce the entire system works as expected" \
  --dry-run \
  --write-jobs
```

Artifacts: `artifacts/prd/<slug>/`. Optional jobs: `pybatch/jobs-from-prd-<slug>.json` for `sdlc-batch`.

## Options

| Flag | Description |
|------|-------------|
| `--request`, `-r` | Required natural-language request |
| `--target`, `-t` | Default `assistant-ui` |
| `--dry-run` | No live Baseten; local fallbacks only |
| `--write-jobs` | Emit `07-jobs.json` + pybatch jobs file |
| `--slug` | Override artifact directory name |
| `--assistant-ui-dir` | Override product root |

## Environment

| Variable | Purpose |
|----------|---------|
| `BASETEN_API_KEY` | Live chain calls (omit / use `--dry-run` offline) |
| `BASETEN_CHAIN_PORTFOLIO_ID` | Portfolio model id (default in `chain-portfolio.ts`) |
| `ASSISTANT_UI_DIR` | Absolute path to assistant-ui if not sibling checkout |

Specialty headers used: `deep-research-brief`, `prd-from-analysis`, `spec-from-research`, `roadmap`. Missing specialties fall back via `smartCallChain` local builders so dry-run and offline still produce usable docs.

## MCP

Tool **`formal-prd-plan`** on `cloud-agent-mastra`:

```json
{
  "request": "formally validate dafny2js and dafny-replay happy path",
  "target": "assistant-ui",
  "dryRun": true,
  "writeJobs": true
}
```

## Skill

`.agents/skills/formal-system-prd/SKILL.md` (mirrored under `.cursor/skills/`).

## Pipeline

1. Interpret request (local)
2. Ingest assistant-ui context (gap docs, verify APIs, kernels, CI)
3. Deep research brief (Baseten or local)
4. Expand issues (forced themes + gap IDs + chain)
5. PRD + SPECS + milestones
6. Optional pybatch jobs (`deep_research`, `sync_formal`, `formal_suite`)

## Tests

```bash
npm run test:prd
npm run prd:plan -- --request "..." --dry-run --slug smoke-formal-happy-path
```

## Out of scope (v1)

- Auto-creating GitHub Issues
- Implementing the happy path (use `sdlc-batch` with emitted jobs)
