import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOpenCodeConfigFromEnv,
  formalProcessSpecs,
  boardAllRequiredOk,
  hostFetchOpenCodeHealth,
  type SandboxProcessBoard,
} from './opencode-serve.js';
import {
  OPENCODE_SERVE_PORT,
  ASSISTANT_UI_WEB_PORT,
  DAYTONA_AUTO_STOP_MAX_MINUTES,
  daytonaAutoStopMinutes,
} from './types.js';
import { PREVIEW_TOKEN_PORTS, labelForPort, primaryPathForPort } from './preview-tokens.js';
import { getSandboxType, SANDBOX_TYPES_VERSION } from './types-registry.js';

describe('opencode-serve pure helpers', () => {
  it('OPENCODE_SERVE_PORT is 4096 by default', () => {
    assert.equal(OPENCODE_SERVE_PORT, 4096);
  });

  it('daytonaAutoStopMinutes is capped at 5 for development', () => {
    assert.equal(DAYTONA_AUTO_STOP_MAX_MINUTES, 5);
    assert.equal(daytonaAutoStopMinutes({} as NodeJS.ProcessEnv), 5);
    assert.equal(daytonaAutoStopMinutes({ DAYTONA_AUTO_STOP_MINUTES: '5' } as NodeJS.ProcessEnv), 5);
    assert.equal(daytonaAutoStopMinutes({ DAYTONA_AUTO_STOP_MINUTES: '3' } as NodeJS.ProcessEnv), 3);
    assert.equal(daytonaAutoStopMinutes({ DAYTONA_AUTO_STOP_MINUTES: '90' } as NodeJS.ProcessEnv), 5);
    assert.equal(daytonaAutoStopMinutes({ DAYTONA_AUTO_STOP_MINUTES: '0' } as NodeJS.ProcessEnv), 5);
  });

  it('preview token ports include 4096 and formal UIs', () => {
    assert.ok(PREVIEW_TOKEN_PORTS.includes(4096 as (typeof PREVIEW_TOKEN_PORTS)[number]));
    assert.ok(PREVIEW_TOKEN_PORTS.includes(3010 as (typeof PREVIEW_TOKEN_PORTS)[number]));
    assert.equal(labelForPort(4096), 'opencode-serve');
    assert.equal(primaryPathForPort(4096), '/global/health');
  });

  it('formal registry owns 4096 and opencode domain', () => {
    const formal = getSandboxType('formal');
    assert.ok(formal.ports.includes(OPENCODE_SERVE_PORT));
    assert.ok(formal.ports.includes(ASSISTANT_UI_WEB_PORT));
    assert.ok(formal.domains.some((d) => d.app === 'opencode' && d.port === 4096));
    assert.ok(formal.mcpTools.includes('px_opencode_preview'));
    assert.ok(formal.mcpTools.includes('px_sandbox_health'));
    assert.match(SANDBOX_TYPES_VERSION, /^2026/);
  });

  it('buildOpenCodeConfigFromEnv prefers openrouter when key set', () => {
    const cfg = buildOpenCodeConfigFromEnv({
      OPENROUTER_API_KEY: 'sk-or-test-key-long-enough',
      OPENCODE_MODEL: 'openrouter/openai/gpt-4o-mini',
    } as NodeJS.ProcessEnv);
    assert.ok(cfg.enabled_providers.includes('openrouter'));
    assert.equal(cfg.model, 'openrouter/openai/gpt-4o-mini');
    assert.ok(cfg.provider.openrouter);
  });

  it('buildOpenCodeConfigFromEnv falls back to baseten-proxy', () => {
    const cfg = buildOpenCodeConfigFromEnv({
      BASETEN_API_KEY: 'bt-test',
      BASETEN_PROXY_BASE_URL: 'https://example.invalid/v1',
    } as NodeJS.ProcessEnv);
    assert.ok(cfg.enabled_providers.includes('baseten-proxy'));
    assert.ok(cfg.provider['baseten-proxy']);
  });

  it('hostFetchOpenCodeHealth uses /global/health and parses healthy body', async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string | URL | Request) => {
      const u = String(url);
      calls.push(u);
      return {
        status: 200,
        text: async () => JSON.stringify({ healthy: true, version: '1.18.13' }),
      } as Response;
    };
    const r = await hostFetchOpenCodeHealth('http://127.0.0.1:4096', fetchImpl as typeof fetch);
    assert.equal(r.ok, true);
    assert.equal(r.status, 200);
    assert.match(r.url, /\/global\/health$/);
    assert.match(r.body, /"healthy"\s*:\s*true/);
    assert.ok(calls[0]?.includes('/global/health'));
  });

  it('formalProcessSpecs and boardAllRequiredOk', () => {
    const specs = formalProcessSpecs({ includeAssistantUi: true, includeOpencode: true });
    assert.ok(specs.some((s) => s.name === 'opencode-serve' && s.port === 4096 && s.required));
    const board: SandboxProcessBoard = {
      sandboxId: 'x',
      probedAt: new Date().toISOString(),
      required: specs.filter((s) => s.required).map((s) => s.name),
      processes: specs.map((s) => ({
        name: s.name,
        port: s.port,
        path: s.path,
        status: 200,
        ok: true,
      })),
      allRequiredOk: false,
    };
    board.allRequiredOk = boardAllRequiredOk(board);
    assert.equal(board.allRequiredOk, true);
    board.processes[0].ok = false;
    assert.equal(boardAllRequiredOk(board), false);
  });
});
