# Surreal schema sync (OpenCode)

Use when editing product Surreal DDL in **surreal-graphql-gateway** `.px/database/` (SurrealKit) or federation artifacts in `.px/graphql/`.

## Source of truth

| Repo | Path |
|------|------|
| SurrealKit schema + seed | `.px/database/schema/`, `.px/database/seed/` |
| SurrealKit config | `.px/database/surrealkit.toml` |
| Legacy shim (generated) | `.px/graphql/surreal/seed.surql` |
| Apollo federation SDL | `.px/graphql/apollo/subgraph.graphql` |
| WunderGraph ops | `.px/graphql/wundergraph/operations/` |
| Generated | `.px/graphql/generated/drift-report.json` |
| Ontology edit gate | `cloud-agent/.px/config.json` (`ontologyEditing`) — shown in OpenCode TUI breadcrumb |

Cross-product LinkML stays in **px-validate** — not duplicated here.

## Tools (this plugin)

1. **`schema_status`** — read drift report; returns `canApply`, `canSync`, `driftSummary`
2. **`schema_apply`** — `npm run surreal:sync` (SurrealKit sync; requires ontology editing ON)
3. **`schema_sync`** — `npm run schema:sync` (full propagation; asks permission)
4. **`ontology_status`** / **`ontology_set_editing`** — read or toggle ontology editing mode

## Typical workflow

1. Enable ontology editing in OpenCode sidebar footer (or `ontology_set_editing`)
2. Edit `.px/database/schema/*.surql` or `.px/database/seed/*.surql`
3. Ensure Surreal is up: `cd surreal-graphql-gateway && npm run surreal:up`
4. Run **`schema_sync`** (or `npm run schema:sync` in gateway)
5. Run **`schema_status`** — `inSync` should be `true`
6. Smoke: `npm run smoke` in gateway
6. Optional Cosmo: `COSMO_PUBLISH=1 npm run schema:sync`

## Pointers

Gateway root is resolved from `cloud-agent/.px/pointers.yaml` → `surreal_graphql_gateway.root`.

## CI

PRs touching `.px/graphql/**` should pass `npm run schema:check` in surreal-graphql-gateway.
