---
name: formal-system-prd
description: >-
  Interpret a formal-validation request, analyze assistant-ui (dafny2js,
  dafny-replay, verified-kernels, Midspiral, CI), expand an issue backlog, and
  emit PRD + specs + milestones via Baseten chain specialties. Use when the user
  asks for a formal PRD, happy-path Dafny validation, issue expansion, or
  milestones for the formal stack.
---

# Formal System PRD (Baseten Chain)

Project root: `partners/experiments/01-platform/cloud-agent`

## When to use

- “Formal PRD” / “expand issues” / “milestones for formal stack”
- Happy-path validation for **dafny2js**, **dafny-replay**, verified-kernels
- Comprehensive analysis of assistant-ui formal gaps before an SDLC batch

## Quick start

```bash
cd partners/experiments/01-platform/cloud-agent
npm run prd:plan -- --request "Formally validate and test the full happy path flows that make sure the dafny2js and dafny-replay and the formal validation stack enforce the entire system works completely as expected" --dry-run --write-jobs
```

Live Baseten (needs `BASETEN_API_KEY` + `BASETEN_CHAIN_PORTFOLIO_ID`):

```bash
npm run prd:plan -- --request "..." --write-jobs
```

Artifacts land in `artifacts/prd/<slug>/`. Optional `07-jobs.json` / `pybatch/jobs-from-prd-<slug>.json` feeds `sdlc-batch`.

## Agent workflow

```
- [ ] Interpret user request → success criteria
- [ ] Ingest assistant-ui grounding (.gap-analysis, verify APIs, CI, kernels)
- [ ] Baseten deep-research-brief (or local fallback)
- [ ] Expand issues (seeded themes + gap IDs + chain)
- [ ] Emit PRD, SPECS/, milestones
- [ ] Optionally emit pybatch jobs with deep_research + sync_formal
- [ ] Hand off implementation via sdlc-batch / Mastra MCP
```

## MCP

Tool: `formal-prd-plan` on `cloud-agent-mastra`  
Args: `request`, `target` (default `assistant-ui`), `dryRun`, `writeJobs`

## Related

- CLI: `npm run prd:plan`
- Docs: `docs/formal-prd-planner.md`
- Existing handoff skill: `.agents/skills/cloud-agent/SKILL.md`
