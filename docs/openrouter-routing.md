# OpenRouter ZDR Routing

Privacy-first LLM routing for cloud-agent via [OpenRouter](https://openrouter.ai), with Zero Data Retention (ZDR) defaults and tiered model fallback chains.

## Tiers

| Tier | Role | Primary | Fallback chain |
|------|------|---------|----------------|
| `triage` | Classification / cheap routing | `openai/gpt-oss-20b` | → `meta-llama/llama-3.3-70b-instruct` |
| `bulk` | High-volume agent steps (default) | `deepseek/deepseek-v4-flash-0731` | → `deepseek/deepseek-v4-flash` → `openai/gpt-oss-120b` |
| `coding` | Hard implementation | `deepseek/deepseek-v4-pro` | → `moonshotai/kimi-k2.7-code` → `x-ai/grok-build-0.1` |
| `frontier` | Escalation only | `anthropic/claude-sonnet-5` | → `anthropic/claude-opus-4.8` |

Source of truth: `config/openrouter-routing.json`.

## Provider defaults (every request)

```json
{
  "zdr": true,
  "data_collection": "deny",
  "sort": "price",
  "allow_fallbacks": true
}
```

Set `OPENROUTER_ZDR_DEFAULT=0` to disable ZDR injection (not recommended for production).

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENROUTER_API_KEY` | — | OpenRouter API key |
| `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` | API base URL |
| `OPENROUTER_ZDR_DEFAULT` | `1` | Set `0` to skip ZDR provider block |
| `LLM_FALLBACK_ORDER` | `openrouter,baseten,local` | Provider order for `smartCallChain` |
| `OPENROUTER_DEFAULT_TIER` | `bulk` | Tier when specialty is unknown |
| `OPENROUTER_HTTP_REFERER` | `https://brightforestx.com` | OpenRouter attribution header |
| `OPENROUTER_APP_TITLE` | `cloud-agent` | OpenRouter `X-Title` header |

## Routing flow

1. **`smartCallChain`** (`src/chain-portfolio.ts`) reads `LLM_FALLBACK_ORDER`.
2. If `openrouter` is first and `OPENROUTER_API_KEY` is set → `routeOpenRouterForSpecialty()`.
3. On failure → Baseten `callChain()`, then optional local `fallback_fn`.

Specialty → tier mapping is in `config/openrouter-routing.json` (`specialtyTierMap`).

## Account-level ZDR (required for Grok CLI)

The Grok CLI cannot send `provider.zdr` per request. For Grok sessions using OpenRouter models:

1. Open [OpenRouter Privacy Settings](https://openrouter.ai/settings/privacy).
2. Enable ZDR for each model group you use (Anthropic, OpenAI, Google, xAI, non-frontier).
3. Merge `.grok/config.openrouter-snippet.toml` into `~/.grok/config.toml`.

Grok default model: `openrouter-flash-zdr` (bulk tier). Fork secondary: `openrouter-pro-zdr`.

**Grok does not read `cloud-agent/.env`.** Export the key in your shell, use direnv, or launch via:

```bash
cd experiments/01-platform/cloud-agent
npm run grok          # loads .env, then starts grok
# or: ./scripts/grok-with-openrouter.sh
```

Permanent option (any directory): add to `~/.zshrc`:

```bash
export OPENROUTER_API_KEY="$(grep -E '^OPENROUTER_API_KEY=' /path/to/cloud-agent/.env | tail -1 | cut -d= -f2- | tr -d '\"')"
```

**Claude Code:** see `docs/claude-lean-openrouter.md` — `ANTHROPIC_BASE_URL=https://openrouter.ai/api`, `npm run claude:lean`.

## ZDR endpoint list

Confirm models support ZDR:

```bash
curl -s https://openrouter.ai/api/v1/endpoints/zdr | jq '.data | length'
```

## Verification

```bash
npm run build
node --test dist/llm/openrouter-client.test.js
DRY_RUN=1 npm run test:integration
npm run smoke:openrouter    # live API (~$0.0001)
npm run health              # includes OpenRouter probe
npm run health:openrouter   # OpenRouter only
```

## Cost expectations

Smoke and health probes use `max_tokens: 16` on the bulk tier. Typical cost is well under $0.001 per run.

## Module layout

- `src/llm/openrouter-client.ts` — HTTP client, ZDR injection, logging
- `src/llm/route-request.ts` — tier resolution + `models[]` fallback
- `src/llm/openrouter-config.ts` — loads `config/openrouter-routing.json`
