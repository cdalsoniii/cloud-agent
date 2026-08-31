# PX Grok Surreal bundle

Native SurrealDB toolchain for [Grok Build](https://github.com/xai-org/grok-build) in `cloud-agent` — no Docker required for the Grok MCP path.

## Contents

| Binary | Version | Source |
|--------|---------|--------|
| `surreal` | 3.2.3 | download.surrealdb.com |
| `surrealkit` | 0.5.3 | GitHub releases |
| `surrealmcp` | v0.4.0 | `cargo install` from surrealdb/surrealmcp |

`grok` itself is **not** vendored — install via `curl -fsSL https://x.ai/cli/install.sh | bash`.

## Install

From `cloud-agent`:

```bash
./scripts/grok-bundle-install.sh
```

Set environment (add to your shell or run each session):

```bash
export PX_GROK_BUNDLE="$PWD/.grok-bundle"
export PATH="$PX_GROK_BUNDLE/bin:$PATH"
```

Optional: append to `~/.zshrc` with `./scripts/grok-bundle-install.sh --global`.

## Daily use

```bash
# 1. Start native SurrealDB (file-backed under .grok-bundle/data)
./scripts/surreal-stack.sh start

# 2. Sync schema from surreal-graphql-gateway
cd ../../02-products/surreal-graphql-gateway && npm run surreal:sync

# 3. Launch Grok from cloud-agent
cd ../../01-platform/cloud-agent
export PX_GROK_BUNDLE="$PWD/.grok-bundle" PATH="$PX_GROK_BUNDLE/bin:$PATH"
grok inspect
grok mcp doctor surrealdb
```

## Port conflicts

If Docker Surreal is already on `:8000`, stop it first:

```bash
cd ../../02-products/surreal-graphql-gateway && docker compose down
```

Or check status: `./scripts/surreal-stack.sh status`.

## Prerequisites

- macOS Apple Silicon (`aarch64-apple-darwin`)
- `curl`, `tar`, `shasum`
- Rust toolchain (`cargo`) + `brew install llvm` for building native `surrealmcp` (or Docker for stdio wrapper fallback)

## Verify

```bash
./scripts/smoke-grok-surreal.sh
```

See [docs/grok-surreal-bundle.md](../docs/grok-surreal-bundle.md) for full workflow.
