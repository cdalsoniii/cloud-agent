# Grok Surreal distribution bundle

Native SurrealDB + SurrealMCP + SurrealKit for [Grok Build](https://github.com/xai-org/grok-build) in `cloud-agent`, without Docker on the Grok path.

## Quickstart

```bash
cd experiments/01-platform/cloud-agent

# 1. Install bundled binaries into .grok-bundle/
./scripts/grok-bundle-install.sh

# 2. Environment (each shell session)
export PX_GROK_BUNDLE="$PWD/.grok-bundle"
export PATH="$PX_GROK_BUNDLE/bin:$PATH"

# 3. Start native SurrealDB
./scripts/surreal-stack.sh start

# 4. Sync schema (from gateway)
cd ../../02-products/surreal-graphql-gateway
npm run surreal:sync
npm run schema:check

# 5. Grok from cloud-agent
cd ../../01-platform/cloud-agent
grok inspect
grok mcp doctor surrealdb
```

## What gets installed

| Path | Purpose |
|------|---------|
| `.grok-bundle/bin/surreal` | SurrealDB server CLI v3.2.3 |
| `.grok-bundle/bin/surrealkit` | Schema migrations v0.5.3 |
| `.grok-bundle/bin/surrealmcp` | MCP server v0.4.0 (built via cargo) |
| `.grok-bundle/data/` | File-backed DB storage |
| `.grok/config.toml` | Project MCP config for Grok |

Versions are pinned in [`grok-dist/manifest.yaml`](../grok-dist/manifest.yaml).

## Grok vs OpenCode

| Agent | SurrealMCP | Schema tools |
|-------|------------|--------------|
| **Grok** | Native binary via `.grok/config.toml` | `.grok/skills/surreal-schema-sync/` + shell |
| **OpenCode** | Docker in `opencode.json` | `.opencode/plugins/surreal-schema.ts` |

Both paths share the same Surreal instance (`127.0.0.1:8000`, ns/db `test`) and gateway schema source of truth.

## Ontology editing gate

Schema apply requires `ontologyEditing: true` in `.px/config.json` (same rule as the OpenCode plugin). Read before running `npm run surreal:sync`.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| Port 8000 in use | `docker compose down` in surreal-graphql-gateway, or `./scripts/surreal-stack.sh status` |
| `surrealmcp` build fails | Install `brew install llvm` (sets `LIBCLANG_PATH`); or Docker stdio wrapper fallback |
| Grok MCP not found | Ensure `PX_GROK_BUNDLE` is set when launching `grok` |
| `grok mcp doctor` fails | Start Surreal first: `./scripts/surreal-stack.sh start` |

## Verify

```bash
./scripts/smoke-grok-surreal.sh
```

Results are recorded in [`docs/grok-surreal-connectivity.md`](grok-surreal-connectivity.md).

## Related

- [grok-dist/README.md](../grok-dist/README.md)
- [`.px/pointers.yaml`](../.px/pointers.yaml) → `grok_bundle`
- [surreal-graphql-gateway](https://github.com/surrealdb/surrealkit) SurrealKit docs
