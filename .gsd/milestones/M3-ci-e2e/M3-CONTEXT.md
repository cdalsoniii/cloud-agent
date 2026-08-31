# M3 CONTEXT — CI + E2E happy path

## Goal

Rollup: formal-verification CI + formal E2E/smoke pass with evidence.

## Exit criteria (PRD)

- formal-verification CI green
- formal E2E passes

## cloud-agent interpretation

- Workflow file ready; evidence from local `verify:all` + `smoke:formal`
- Product live API E2E (HTTP against running Next server) remains optional/blocked without `DAFNY2JS_PATH` + server
