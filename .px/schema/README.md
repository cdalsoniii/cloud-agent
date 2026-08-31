# Schema stubs policy

cloud-agent does **not** own a fork of the LinkML ontology.

- Canonical schema lives in **px-validate** (`ontology/` / `formal/` — see `.px/pointers.yaml`).
- This folder may hold **local stubs** that only document cloud-agent-specific Surreal tables or validation shapes when they are already implemented in-repo (e.g. `schema.surql`).

## Hybrid policy (product GraphQL)

- **LinkML / cross-product ontology** → px-validate only (`propose_new_class`, `preview_schema_change`).
- **Product Surreal DDL + federation SDL** → `surreal-graphql-gateway/.px/graphql/` (see `surreal_graphql_gateway` in `.px/pointers.yaml`).

OpenCode tools: `schema_status`, `schema_apply`, `schema_sync` via `.opencode/plugins/surreal-schema.ts`.

## Existing in-repo schema

| File | Role |
|------|------|
| `../../schema.surql` | Surreal schema for cloud-agent sessions / handoff |
| `../../src/validation/schemas.ts` | Zod / validation engine schemas |

## Adding schema

1. Prefer proposing via px-validate (`propose_new_class` / LinkML) when the concept is cross-product ontology.
2. For cloud-agent-only runtime tables, edit `schema.surql` and note the change in `.gsd/DECISIONS.md`.
3. Never invent LinkML classes solely under `.px/schema/` without grounding.
