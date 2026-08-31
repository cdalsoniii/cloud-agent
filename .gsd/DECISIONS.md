# DECISIONS (append-only)

## 2026-07-21 — Use `.gsd/` not `.planning/`

OpenGSD docs prefer `.planning/`; this repo uses **`.gsd/`** to match local gsd-2 / gsd-pi patterns (`STATE.md`, milestone folders). Content spirit is the same: durable markdown/JSON, verify before done.

## 2026-07-21 — `.px/` is pointer-index, not ontology fork

Canonical classes stay in px-validate `formal/`. cloud-agent `.px/` indexes local verification + assistant-ui pointers.

## 2026-07-21 — Product gaps stay in assistant-ui

DF/M/QW gap closure that requires Next.js/TUI/advisor changes is tracked as **blocked/deferred** here with evidence that smoke checked for presence; implementation remains in `02-products/assistant-ui`.

## 2026-07-21 — No GitHub Issue spam

PRD pack issues are tracked in `.gsd` only; do not auto-open GitHub Issues.

## 2026-07-21 — OpenCode SDK events via hybrid client

Use `@opencode-ai/sdk` `event.subscribe()` for progress, but **raw HTTP** for `/auth` + `/session/{id}/message` when sandbox OpenCode is older than the SDK (observed 1.1.35 vs 1.18.x). Prefer Daytona preview token + toolbox fallback for SSE.

## 2026-07-21 — GSD uses Baseten via env wrapper, not native provider

`gsd` (gsd-pi) has no first-class `baseten` provider. `scripts/gsd-baseten-drive.sh` exports OpenAI-compatible env from `BASETEN_*` for tools; GSD headless may still use `~/.gsd/agent/settings.json` orchestrator model. OpenCode sandbox agents use `baseten/<modelId>` (e.g. `baseten/openai/gpt-oss-120b`).

## 2026-07-21 — FORMAL-006 build gate accepted

assistant-ui `/api/opencode/prompt` already runs claimcheck pre/post. Marked done for cloud-agent tracking; chat hard-gate remains optional product polish.

## 2026-07-21 — Prefer Baseten Model APIs over ngrok proxy

`BASETEN_PROXY_BASE_URL` (ngrok) timed out; `https://inference.baseten.co/v1` returned 200 for models + chat.

## 2026-07-21 — SurrealDB is the compose docker container via IPv6 localhost

Port 8000 has two listeners: the compose container `cloud-agent-surrealdb` (Docker, reached by
Node `localhost`→IPv6 `[::]:8000`, the intended target) and an unrelated host `surreal` on
IPv4 `127.0.0.1`. Repo tooling (`event-logger` via `SURREALDB_URL=http://localhost:8000`) writes
to the container; external clients must use `http://[::1]:8000` (or `docker exec`) to see the same
data. Querying `127.0.0.1:8000` looks empty — environment artifact, not a pipeline bug. Left
`event-logger.ts` headers unchanged (both surreal-ns/db + NS/DB) since writes land correctly.

## 2026-07-21 — Cost tracking prices from Baseten /models (never invented)

assistant-ui TUI `costs.ts`/`cost-tracker.ts` fetch authoritative per-token pricing from Baseten
`/models`; sandbox $/min is env-gated (`AUI_COST_DAYTONA_USD_PER_MIN`, unset → unpriced line).
LLM cost lines persist to SurrealDB `chain_execution`. Source mirrored to
`.gsd/evidence/tui-cost-tracking/` because parallel agents reset the assistant-ui tree.
