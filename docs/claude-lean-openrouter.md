# Claude Code + OpenRouter + Lean Live

Mirror of the Grok Lean pane setup for **Claude Code** sessions in `cloud-agent`.

## Quickstart (recommended)

```bash
cd experiments/01-platform/cloud-agent
export PX_GROK_BUNDLE="$PWD/.grok-bundle" PATH="$PX_GROK_BUNDLE/bin:$PATH"

# Split: Claude (OpenRouter) left, Lean Live TUI right
./scripts/claude-lean-split.sh
# or: npm run claude:lean
```

First time: run `/logout` in Claude if you previously used native Anthropic OAuth, then relaunch.

Verify routing inside Claude:

```
/status
```

Expect:

- Auth token: `ANTHROPIC_AUTH_TOKEN`
- Anthropic base URL: `https://openrouter.ai/api`

## OpenRouter env (from `.env`)

| Variable | Value |
|----------|--------|
| `OPENROUTER_API_KEY` | Your `sk-or-…` key (in `.env`) |
| `ANTHROPIC_BASE_URL` | `https://openrouter.ai/api` |
| `ANTHROPIC_AUTH_TOKEN` | Same as `OPENROUTER_API_KEY` |
| `ANTHROPIC_API_KEY` | `""` (must be empty) |

Wrapper (loads `.env` automatically):

```bash
./scripts/claude-openrouter.sh
```

## Project hooks (`.claude/settings.json`)

When you run Claude from this repo:

- **SessionStart** → `lean-stack.sh` + `lean-live-bridge.sh`
- **PostToolUse** (Write/Edit on `*.lean`) → bridge rebuild

## Model tiers (OpenRouter)

Aligned with `config/openrouter-routing.json`:

| Use | OpenRouter model id |
|-----|---------------------|
| Default / frontier | `anthropic/claude-sonnet-5` |
| Escalation | `anthropic/claude-opus-4.8` |
| Coding | `deepseek/deepseek-v4-pro` |
| Bulk | `deepseek/deepseek-v4-flash-0731` |

Set in Claude with `/model` or project `.claude/settings.json` → `"model"`.

## OpenCode (native right pane)

OpenCode supports `session_prompt_right` — Lean status appears **inside** the TUI (no tmux required).

1. Merge `config/opencode.openrouter-snippet.json` into `opencode.json` (or set `OPENROUTER_API_KEY` in env).
2. TUI plugins: `tui.json` includes `px-lean-live-tui.tsx`.
3. Launch:

```bash
./scripts/opencode-lean-split.sh   # tmux + full-height Lean TUI
# or plain: opencode  (compact Lean badge in prompt right slot)
```

## Three viewers (same as Grok)

| Path | Command |
|------|---------|
| **A — Terminal split** | `./scripts/claude-lean-split.sh` |
| **B — Browser** | mcp-verifier `/lean-live` |
| **C — OpenCode in-TUI** | `opencode` with `px-lean-live-tui.tsx` |

## ZDR

Enable account-level ZDR at [OpenRouter Privacy Settings](https://openrouter.ai/settings/privacy). See `docs/openrouter-routing.md`.

## Snippets

- `config/claude-openrouter-snippet.json` — merge into settings
- `.grok/config.openrouter-snippet.toml` — Grok CLI models (parallel setup)
