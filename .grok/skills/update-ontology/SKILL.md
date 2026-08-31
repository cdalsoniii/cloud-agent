---
name: update-ontology
description: Update the shared SurrealDB ontology schema and propagate it to the federation (WunderGraph + Apollo), then re-validate the data with Lean 4 over GraphQL. Use when the user asks to edit/update/add to the ontology, apply schema changes, push schema to WunderGraph/Apollo, sync the ontology, or run /update-ontology.
when-to-use: update the ontology, edit ontology schema, add ontology table, push schema to wundergraph, push schema to apollo, sync ontology to federation, /update-ontology
user-invocable: true
argument-hint: "[--ns test --db test]"
---

# Update the ontology (edit DDL → sync → federation → Lean validate)

## ⚠️ Not a GitHub change

This skill updates the **ontology in SurrealDB** and mirrors it into the local
**gateway federation** (WunderGraph + Apollo). It does **not** open a PR or touch
remote git history. Finish by committing the local gateway + cloud-agent files on
their existing branches if you want the artifacts persisted, but the ontology
itself lives in SurrealDB and the federation artifacts, not in a GitHub diff.

## Source of truth and flow

```
cloud-agent/.px/config.json (ontologyEditing gate)
   └─ blocked unless ON
surreal-graphql-gateway/.px/database/schema/*.surql   ← EDIT HERE (SurrealKit source)
surreal-graphql-gateway/.px/database/seed/*.surql     ← EDIT HERE (seed data)
        │
        ▼
npm run federation:push:restart
   = surreal:sync (SurrealKit: materialise → apply) 
   + schema:sync (introspect → regenerate Apollo SDL + resolvers + WunderGraph ops)
   + compose + restart Apollo subgraph(4001) + WunderGraph(9991) + Router/Gateway(4000)
        │
        ▼
npm run lean:surreal        (from cloud-agent)
   = lean-surreal-validate.sh → GraphQL relationship validation + SurrealGraph.lean */ 
   + lake build (proofs) → .px/lean-surreal/validate.json
```

Gateway root resolves via `cloud-agent/.px/pointers.yaml` →
`surreal_graphql_gateway.root` = `../../02-products/surreal-graphql-gateway`.

## 0. Preflight

- SurrealDB must be up: `./scripts/surreal-stack.sh health` (ns=`test`, db=`test`).
- **Ontology editing must be ON.** Verify before any DDL:
  ```bash
  cat .px/config.json        # ontologyEditing must be true
  ```
  If it is off and the user intends to edit, turn it on first
  (see the `ontology-edit` skill / `bash scripts/toggle-ontology-edit.sh`).
  Do **not** run destructive DDL while `ontologyEditing` is false.

## 1. Edit the DDL (SurrealKit source of truth)

Work in the gateway repo. Each table is one file:

```bash
cd ../../02-products/surreal-graphql-gateway/.px/database
ls schema/            # person.surql, sandbox_log.surql, ontology_*.surql, ...
```

- **Add a field/table:** edit `schema/<table>.surql` (and seed under `seed/`).
- Keep the nullable idiom `TYPE option<X>` and `FLEXIBLE properties` consistent
  with existing files.
- **Never put `DEFINE CONFIG GRAPHQL`** in the schema files — it belongs in
  `setup.surql` only.
- Seed `CREATE`s are **not idempotent** — rerunning the seed duplicates rows.
  To make a seed re-runnable use `ON ...` guards or delete-first before seeding.

## 2. Propagate to federation (WunderGraph + Apollo)

From the **gateway** repo:

```bash
npm run federation:push:restart     # materialise → sync → seed → schema:sync → compose → restart
```

To watch the steps individually instead:

```bash
npm run surreal:sync      # SurrealKit: materialise .px/database → apply to SurrealDB
npm run schema:sync       # introspect → regen Apollo SDL + resolvers + WunderGraph ops
npm run schema:check      # drift check; expects inSync: true
npm run stack:restart     # recompose + restart Apollo subgraph(4001)/WG(9991)/router(4000)
```

The generator (`scripts/schema-sync.ts`) is **generic**: new ontology tables are
registered in the `ONTOLOGY_TABLES` map in that file, and it emits the federated
SDL, Apollo resolver query strings, and `<Type>s.graphql` WunderGraph operations
for every table SurrealDB exposes. The Apollo subgraph (`apollo/subgraph/src/index.ts`)
wires generic list / `<single>ById` resolvers + `__resolveReference` from those
generated query strings, so new tables need **no hand-written gateway code**.

## 3. Verify federation exposure

```bash
# WunderGraph (:9991) — should list ontologyNodes/ontologyEdges/… for all tables
curl -s -X POST http://127.0.0.1:9991/graphql -H 'Content-Type: application/json' \
  -d '{"query":"{ __type(name:\"Query\"){ fields { name } } }"}'

# Apollo Router/Gateway (:4000) — resolve real data through the supergraph
curl -s -X POST http://127.0.0.1:4000/ -H 'Content-Type: application/json' \
  -d '{"query":"{ ontologyNodes { id name node_type } }"}'
curl -s -X POST http://127.0.0.1:4000/ -H 'Content-Type: application/json' \
  -d '{"query":"{ ontologyEdges { id source_id target_id relationship_type } }"}'
```

> Note: the Apollo **Router** runs in Docker where `127.0.0.1:4001` is the container
> itself, so it cannot reach the host subgraph. If the router only returns
> `Connection refused`, use the Node gateway fallback:
> `docker rm -f sgw-apollo-router` then `APOLLO_ROUTER_PORT=4000 npm run apollo:gateway`.

## 4. Lean 4 validation over GraphQL

From **cloud-agent** root:

```bash
npm run lean:surreal              # full pipeline (uses --ns test --db test)
npm run lean:surreal -- --regen      # force re-export/regenerate SurrealGraph.lean
```

This runs `scripts/lean-surreal-validate.sh`, which:
1. Queries SurrealDB **GraphQL** and checks relationship invariants
   (no self-loops, no dangling `source_id`→`target_id` edges) →
   `.px/lean-surreal/report.json`.
2. Exports all rows over GraphQL and regenerates
   `config/verification/lean/PxCloudAgent/SurrealGraph.lean`.
3. `lake build`s the workspace — the generated module states the graph as Lean
   definitions + theorems, so the build **machine-checks** consistency.
4. Reads the lean-live bridge state and writes a combined verdict:
   `.px/lean-surreal/validate.json` with `status: pass|fail`.

Expect `result: pass` (graphqlViolations 0, lakeBuildExit 0, leanBridgeStatus ok).

## 5. Persist artifacts (local, not a PR)

The ontology + federation are applied; commit the local artifacts so they survive:

```bash
# Gateway: the DDL + generated federation
cd ../../02-products/surreal-graphql-gateway
git add .px/database apollo .px/graphql 2>/dev/null || true
# Cloud-agent: the lean export / validation evidence
cd ../../01-platform/cloud-agent
git add .px/lean-surreal config/verification/lean/PxCloudAgent 2>/dev/null || true
```

This is a local commit — **no push / no PR** (explicitly not a GitHub change).

## Safety

- DDL / migration to a live ontology is only allowed while `ontologyEditing` is
  `true` (leave it OFF for read-only work).
- Re-running non-idempotent `CREATE` seeds duplicates proofs/edges — either make
  the seed idempotent or reset the table before seeding.
