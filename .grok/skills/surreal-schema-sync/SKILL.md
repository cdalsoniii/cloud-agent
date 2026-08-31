# Surreal schema sync (Grok)

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
| Ontology edit gate | `cloud-agent/.px/config.json` (`ontologyEditing`) |

Cross-product LinkML stays in **px-validate** — not duplicated here.

## Prerequisites

```bash
export PX_GROK_BUNDLE="$PWD/.grok-bundle"   # from cloud-agent root
export PATH="$PX_GROK_BUNDLE/bin:$PATH"
./scripts/surreal-stack.sh start
./scripts/surreal-stack.sh health
```

Gateway root: `cloud-agent/.px/pointers.yaml` → `surreal_graphql_gateway.root`.

## Ontology gate

Before applying schema to SurrealDB, verify ontology editing is enabled:

```bash
cat .px/config.json   # ontologyEditing must be true
```

To enable (only when user intends schema edits):

```bash
# Write { "ontologyEditing": true, "updatedAt": "<iso>" } to .px/config.json
```

Do **not** run `surreal:sync` or destructive DDL when `ontologyEditing` is false.

## Workflow (shell commands)

### One-shot (preferred)

From **cloud-agent**:

```bash
./scripts/surreal-stack.sh health
npm run federation:push:restart   # materialise → sync → seed → Apollo/WG → smoke
```

From **surreal-graphql-gateway**:

```bash
npm run federation:push           # or federation:push:restart
```

### Manual steps

1. **Health** — `./scripts/surreal-stack.sh health`
2. **Drift status** — `cd surreal-graphql-gateway && npm run schema:check`
3. **Apply SurrealKit** (ontology ON) — `cd surreal-graphql-gateway && npm run surreal:sync`  
   (materialises `.px/database` → `database/` for local SurrealKit CLI)
4. **Full propagation** — `cd surreal-graphql-gateway && npm run schema:sync`
5. **Verify** — `npm run schema:check` → `inSync: true`
6. **Smoke** — `npm run smoke` (expects `persons` + `sandbox_logs` / federated `sandboxLogs`)

### Adding tables (e.g. sandbox_log)

1. Edit **only** `surreal-graphql-gateway/.px/database/schema/<table>.surql` (+ seed under `seed/`)
2. Never put `DEFINE CONFIG GRAPHQL` in schema files — keep it in `setup.surql`
3. Run `npm run federation:push:restart`
4. Commit **gateway** `.px/database/**` and `.px/graphql/**` (not only cloud-agent)

Cloud-agent `schema.surql` (`main`/`main`) is separate from gateway GraphQL (`test`/`test`).

## MCP

With `.grok/config.toml` and `PX_GROK_BUNDLE` set, Grok loads native `surrealmcp`:

```bash
grok inspect
grok mcp doctor surrealdb
```

## CI

PRs touching `.px/graphql/**` should pass `npm run schema:check` in surreal-graphql-gateway.
