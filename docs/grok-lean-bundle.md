# Grok Lean distribution bundle

Native Lean 4 + `lake serve` + live bridge for [Grok Build](https://github.com/xai-org/grok-build) in `cloud-agent`.

## Quickstart

```bash
cd experiments/01-platform/cloud-agent

# 1. Install bundle (Surreal + Lean)
./scripts/grok-bundle-install.sh

# 2. Environment
export PX_GROK_BUNDLE="$PWD/.grok-bundle"
export PATH="$PX_GROK_BUNDLE/bin:$PATH"

# 3. Start lake serve + live bridge
./scripts/lean-stack.sh start
./scripts/lean-live-bridge.sh start

# 4. Terminal split (Grok left, Lean live right) — NOT plain `grok`
./scripts/grok-lean-split.sh
# or: npm run grok:lean
# or: ./bin/grok-lean

# 5. Or open browser panel
open "http://localhost:3000/lean-live"   # after mcp-verifier dev server
```

## What gets installed

| Path | Purpose |
|------|---------|
| `.grok-bundle/bin/lean` | Lean 4 (via elan) |
| `.grok-bundle/bin/lake` | Lake build tool |
| `.grok-bundle/.elan/` | elan toolchains |
| `.px/lean-live/` | Runtime: `events.ndjson`, `state.json`, pids |
| `config/verification/lean/` | Default Lake workspace (smoke) |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `PX_GROK_BUNDLE` | `.grok-bundle` | Bundle root |
| `LEAN_WORKSPACE` | `px-validate/formal` if Lake project exists, else `config/verification/lean` | Lake project root |
| `LEAN_LIVE_PORT` | `9474` | HTTP/SSE bridge |
| `PX_VALIDATE_ROOT` | see `.px/pointers.yaml` | Formal stack root |

## Scripts

| Script | Role |
|--------|------|
| `scripts/lean-stack.sh` | `lake serve` lifecycle |
| `scripts/lean-live-bridge.sh` | NDJSON + SSE event bus |
| `scripts/grok-lean-split.sh` | Zellij split: Grok + lean-live TUI |
| `scripts/smoke-grok-lean.sh` | End-to-end verification |

## Grok plugin

Project plugin: `.grok/plugins/lean-live/` (hooks, skill, MCP).

```bash
grok plugin install .grok/plugins/lean-live --trust
```

Add to `~/.grok/config.toml`:

```toml
[plugins]
enabled = ["lean-live"]
```

## Three viewer paths

1. **Terminal split** — `grok-lean-split.sh` (daily driver)
2. **Browser** — `apps/mcp-verifier/app/lean-live`
3. **Native Grok fork** — `vendor/grok-build-lean/` + `scripts/build-grok-lean.sh`
