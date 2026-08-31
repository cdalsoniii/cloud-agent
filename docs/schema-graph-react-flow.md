# Schema graph (DBMS-style React Flow)

Per-property ports, handle-aware edges, and animated range/verifier links — derived from **host LinkML**, not sandbox FS.

## Source of truth

| When | Where |
|------|--------|
| Always | `02-products/assistant-ui/.px/linkml/` + rebuild `generated/ontology-state*.json` |
| Sandbox running | Upload/serve same JSON at formal `:7005` ontology UI |
| Sandbox stopped | Host `.px` only; regenerate with `writeOntologyStateFile` |

## Data shape

Builder: `cloud-agent/src/verification-sandbox/ontology-state.ts`

- `layoutMode`: `schema-ports` (default) or `class-nodes` if `ONTOLOGY_GRAPH_EXPLODE_SLOTS=1`
- Class RF nodes: `type: "schemaClass"`, `data.fields[]` with stable ids `ClassName.slot`
- Range edges: `sourceHandle` + `targetHandle` (target prefers identifier slot)
- `animated: true` for multivalued/required ranges and blocking verifier edges
- Positions: `layoutSchemaGraph` (layered L→R)

## Host UI

| Piece | Path |
|-------|------|
| Node | `packages/web/.../SchemaClassNode.tsx` |
| Graph | `packages/web/.../SchemaOntologyGraph.tsx` (MiniMap, Controls, Background, Panel, search) |
| Page | `/ontology/schema` |
| API | `GET /api/ontology-state` |

## Sandbox UI

`templates/ontology-ui/index.html` renders the same JSON with per-field Left/Right handles.

## Regenerate

```bash
cd cloud-agent
npx tsx -e "import { writeOntologyStateFile } from './src/verification-sandbox/ontology-state.ts'; console.log(writeOntologyStateFile(null, undefined, 'acme-fleet'));"
```

## Tests

```bash
npx tsx --test src/verification-sandbox/example-customers.test.ts
```
