# grok-build-lean — Native Lean pane fork (Path C)

Optional fork of [xai-org/grok-build](https://github.com/xai-org/grok-build) that renders a right-side **Lean Live** pane inside the Grok TUI.

## Build

```bash
cd experiments/01-platform/cloud-agent
./scripts/build-grok-lean.sh
```

This clones `grok-build` into `vendor/grok-build-lean/upstream`, applies `patches/`, and runs `cargo install`.

## Configuration

Add to `~/.grok/config.toml`:

```toml
[ui]
lean_pane_enabled = true
lean_live_url = "http://127.0.0.1:9474"
lean_pane_width_percent = 35
```

## Architecture

The pager polls `GET /state` from `lean-live-bridge` (see `scripts/lean-live-bridge.mjs`) and renders:

- `status`, `workspace`, `updatedAt`
- `goals[]` and `diagnostics[]`
- last build tail on errors

Reference implementation: `src/lean_pane.rs` in this directory.

## Upstream contribution

Keep the pane behind `lean_pane_enabled` (default false). Propose the feature to xAI once the event schema stabilizes (`docs/grok-lean-bundle.md`).
