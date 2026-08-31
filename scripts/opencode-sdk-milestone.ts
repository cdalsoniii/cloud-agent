#!/usr/bin/env tsx
/**
 * OpenCode SDK milestone runner for cloud-agent formal happy path.
 *
 * Uses @opencode-ai/sdk event.subscribe() (docs: https://opencode.ai/docs/sdk/#events)
 * against an OpenCode serve URL — local or Daytona sandbox preview.
 *
 * Modes:
 *   dry-run     Print plan + write evidence stub (no network)
 *   listen      Subscribe to SSE events only (requires healthy OpenCode)
 *   prompt      Create session, subscribe events, send milestone prompt, wait for idle
 *   daytona     Create Daytona sandbox via @daytona/sdk, start opencode serve, then prompt
 *
 * Usage (from cloud-agent root; loads .env via dotenv — never bash-source):
 *   npx tsx scripts/opencode-sdk-milestone.ts --mode dry-run --milestone M1
 *   npx tsx scripts/opencode-sdk-milestone.ts --mode listen --base-url http://127.0.0.1:4096
 *   npx tsx scripts/opencode-sdk-milestone.ts --mode prompt --milestone M1
 *   npx tsx scripts/opencode-sdk-milestone.ts --mode daytona --milestone M1
 *
 * Env:
 *   OPENCODE_BASE_URL / OPENCODE_DAYTONA_BASE_URL  server URL
 *   OPENCODE_SERVE_PORT                            default 4096
 *   OPENCODE_MODEL                                 e.g. baseten/openai/gpt-oss-120b
 *   BASETEN_API_KEY / BASETEN_PROXY_BASE_URL       inference for sandbox
 *   DAYTONA_API_KEY                                required for --mode daytona
 *   MILESTONE_IDLE_MS                              default 180000
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { createOpencodeClient } from '@opencode-ai/sdk';
import {
  getDaytonaClient,
  releaseDaytonaClient,
  readSandboxState,
  writeSandboxState,
  clearSandboxState,
  getActiveSandbox,
  defaultSandboxEnvs,
  execInSandbox,
  STATE_FILE,
} from '../src/mastra/tools/daytona-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

dotenv.config({ path: path.join(ROOT, '.env') });
dotenv.config({ path: path.join(ROOT, '../.env') });
dotenv.config({ path: path.join(ROOT, '../gpu-inference-stack/.env') });

type Mode = 'dry-run' | 'listen' | 'prompt' | 'daytona';
type MilestoneId = 'M0' | 'M1' | 'M2' | 'M3';

type SdkEvent = {
  type?: string;
  properties?: Record<string, unknown> & {
    sessionID?: string;
    id?: string;
    title?: string;
  };
};

const MILESTONE_PROMPTS: Record<MilestoneId, string> = {
  M0: `Read .gsd/STATE.md and .px/README.md in this repo. Confirm M0 toolchain baseline (verify:tools, smoke:formal path inventory). Report blockers only; do not invent metrics.`,
  M1: `Read .gsd/STATE.md and .gsd/milestones/M1-prove-translate/M1-ROADMAP.md. Advance open items: FORMAL-006 claimcheck evidence, DAFNY2JS_PATH discovery notes. Write evidence under .gsd/evidence/. Update STATE honestly.`,
  M2: `Read .gsd/STATE.md and .gsd/milestones/M2-runtime-gates/M2-ROADMAP.md. Confirm cloud-agent gates green; list remaining product M/QW gaps without marking them closed.`,
  M3: `Read .gsd/STATE.md and .gsd/milestones/M3-ci-e2e/M3-ROADMAP.md. Run or note commands for smoke:formal / verify:all. Document live API E2E blockers (DAFNY2JS_PATH, remote CI).`,
};

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function evidencePath(label: string, ext = 'jsonl'): string {
  const dir = path.join(ROOT, '.gsd', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${stamp()}-opencode-sdk-${label}.${ext}`);
}

function log(...args: unknown[]): void {
  console.log(`[opencode-sdk-milestone]`, ...args);
}

function parseArgs(argv: string[]): {
  mode: Mode;
  milestone: MilestoneId;
  baseUrl: string;
  maxEvents: number;
  destroySandbox: boolean;
  updateState: boolean;
} {
  let mode: Mode = 'dry-run';
  let milestone: MilestoneId = 'M1';
  let baseUrl =
    process.env.OPENCODE_DAYTONA_BASE_URL ||
    process.env.OPENCODE_BASE_URL ||
    `http://127.0.0.1:${process.env.OPENCODE_SERVE_PORT || '4096'}`;
  let maxEvents = Number(process.env.OPENCODE_MAX_EVENTS || '200');
  let destroySandbox = false;
  let updateState = true;

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--mode' && argv[i + 1]) mode = argv[++i] as Mode;
    else if (a === '--milestone' && argv[i + 1]) milestone = argv[++i] as MilestoneId;
    else if (a === '--base-url' && argv[i + 1]) baseUrl = argv[++i];
    else if (a === '--max-events' && argv[i + 1]) maxEvents = Number(argv[++i]);
    else if (a === '--destroy-sandbox') destroySandbox = true;
    else if (a === '--no-update-state') updateState = false;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!['dry-run', 'listen', 'prompt', 'daytona'].includes(mode)) {
    throw new Error(`Invalid --mode ${mode}`);
  }
  if (!['M0', 'M1', 'M2', 'M3'].includes(milestone)) {
    throw new Error(`Invalid --milestone ${milestone}`);
  }

  return { mode, milestone, baseUrl: baseUrl.replace(/\/$/, ''), maxEvents, destroySandbox, updateState };
}

function printHelp(): void {
  console.log(`Usage: npx tsx scripts/opencode-sdk-milestone.ts [options]

Options:
  --mode dry-run|listen|prompt|daytona   default dry-run
  --milestone M0|M1|M2|M3                default M1
  --base-url <url>                       OpenCode serve URL
  --max-events <n>                       SSE event cap (listen/prompt)
  --destroy-sandbox                      destroy Daytona sandbox when done
  --no-update-state                      skip .gsd/STATE.md append

See docs/opencode-sdk-milestone.md`);
}

function appendStateNote(note: string): void {
  const stateFile = path.join(ROOT, '.gsd', 'STATE.md');
  if (!fs.existsSync(stateFile)) return;
  const block = `\n\n## OpenCode SDK runner (${new Date().toISOString()})\n\n${note}\n`;
  fs.appendFileSync(stateFile, block);
}

function parseModel(ref: string): { providerID: string; modelID: string } {
  // Prefer explicit "baseten/openai/gpt-oss-120b"
  // Bare "openai/gpt-oss-120b" maps to Baseten Model APIs provider (not OpenAI)
  const trimmed = ref.trim();
  if (trimmed.startsWith('baseten/')) {
    return { providerID: 'baseten', modelID: trimmed.slice('baseten/'.length) };
  }
  if (trimmed.includes('/')) {
    // Known Baseten model ids include openai/*, moonshotai/*, zai-org/*, etc.
    return { providerID: 'baseten', modelID: trimmed };
  }
  return { providerID: 'baseten', modelID: trimmed };
}

function makePreviewFetch(previewToken?: string): typeof fetch {
  const token =
    previewToken ||
    process.env.OPENCODE_DAYTONA_PREVIEW_TOKEN ||
    process.env.DAYTONA_PREVIEW_TOKEN ||
    '';
  if (!token) return globalThis.fetch;
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    headers.set('x-daytona-preview-token', token);
    return globalThis.fetch(input, { ...init, headers });
  };
}

async function fetchHealth(
  baseUrl: string,
  previewToken?: string,
): Promise<{ healthy: boolean; version?: string; error?: string }> {
  try {
    const fetchImpl = makePreviewFetch(previewToken);
    const res = await fetchImpl(`${baseUrl}/global/health`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return { healthy: false, error: `HTTP ${res.status}` };
    const data = (await res.json()) as { healthy?: boolean; version?: string };
    return { healthy: Boolean(data.healthy), version: data.version };
  } catch (e) {
    return { healthy: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Raw HTTP helpers for OpenCode servers that predate SDK body shaping
 * (sandbox often runs older `opencode serve` than @opencode-ai/sdk).
 */
async function rawOpencode(
  baseUrl: string,
  method: string,
  apiPath: string,
  body?: unknown,
  previewToken?: string,
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const fetchImpl = makePreviewFetch(previewToken);
  const res = await fetchImpl(`${baseUrl}${apiPath}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(Number(process.env.MILESTONE_IDLE_MS || '180000')),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { ok: res.ok, status: res.status, json, text };
}

async function fetchDaytonaPreview(
  sandboxId: string,
  port: number,
): Promise<{ url: string; token?: string }> {
  const apiBase = (process.env.DAYTONA_API_URL || 'https://app.daytona.io/api').replace(/\/$/, '');
  const key = process.env.DAYTONA_API_KEY || '';
  const res = await fetch(`${apiBase}/sandbox/${sandboxId}/ports/${port}/preview-url`, {
    headers: {
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`preview-url HTTP ${res.status}: ${text.slice(0, 300)}`);
  const data = JSON.parse(text) as { url?: string; token?: string };
  if (!data.url) throw new Error('preview-url missing url');
  return { url: data.url.replace(/\/$/, ''), token: data.token };
}

async function subscribeEvents(
  client: ReturnType<typeof createOpencodeClient>,
  opts: {
    outPath: string;
    maxEvents: number;
    sessionId?: string;
    untilIdle?: boolean;
    idleMs?: number;
  },
): Promise<{ events: SdkEvent[]; idle: boolean }> {
  const events: SdkEvent[] = [];
  const stream = fs.createWriteStream(opts.outPath, { flags: 'a' });
  const idleMs = opts.idleMs ?? Number(process.env.MILESTONE_IDLE_MS || '180000');
  const start = Date.now();
  let idle = false;

  const sub = await client.event.subscribe();
  log('event.subscribe() active →', opts.outPath);

  for await (const raw of sub.stream) {
    const event = raw as SdkEvent;
    const sid = event.properties?.sessionID;
    if (opts.sessionId && sid && sid !== opts.sessionId) continue;

    events.push(event);
    stream.write(JSON.stringify({ t: new Date().toISOString(), event }) + '\n');
    log('event', event.type, sid || '');

    if (opts.untilIdle && event.type === 'session.idle') {
      idle = true;
      break;
    }
    if (event.type === 'session.error') {
      break;
    }
    if (events.length >= opts.maxEvents) break;
    if (Date.now() - start > idleMs) break;
  }

  stream.end();
  return { events, idle };
}

async function ensureOpencodeInSandbox(): Promise<{
  baseUrl: string;
  sandboxId: string;
  previewToken?: string;
}> {
  const port = Number(process.env.OPENCODE_SERVE_PORT || '4096');
  let state = readSandboxState();

  if (!state?.sandboxId) {
    log('creating Daytona sandbox via @daytona/sdk');
    const daytona = getDaytonaClient();
    const sandbox = await daytona.create(
      {
        language: 'python',
        snapshot: process.env.DAYTONA_SNAPSHOT || 'daytona-large',
        envVars: {
          ...defaultSandboxEnvs(),
          BASETEN_API_KEY: process.env.BASETEN_API_KEY || '',
          // Prefer Baseten Model APIs for sandbox agents (ngrok proxy may be down)
          OPENAI_BASE_URL:
            process.env.BASETEN_MODEL_APIS_BASE ||
            'https://inference.baseten.co/v1',
          OPENAI_API_KEY: process.env.BASETEN_API_KEY || process.env.OPENAI_API_KEY || '',
        },
        autoStopInterval: Math.min(
          5,
          Math.max(1, Number(process.env.DAYTONA_AUTO_STOP_MINUTES || 5) || 5),
        ),
        public: false,
      },
      { timeout: 300 },
    );
    state = { sandboxId: sandbox.id, createdAt: new Date().toISOString() };
    writeSandboxState(state);
    log('sandbox created', sandbox.id);
  }

  const { sandbox } = await getActiveSandbox();

  // Ensure opencode binary exists; install if missing
  const which = await execInSandbox(sandbox, 'command -v opencode || echo MISSING', {
    timeoutSeconds: 30,
  });
  if (which.stdout.includes('MISSING')) {
    log('opencode missing in sandbox — installing via npm');
    await execInSandbox(
      sandbox,
      'npm install -g opencode-ai@latest 2>&1 | tail -20',
      { timeoutSeconds: 300 },
    );
  } else if (process.env.OPENCODE_FORCE_UPGRADE === '1') {
    log('OPENCODE_FORCE_UPGRADE=1 — upgrading opencode in sandbox');
    await execInSandbox(
      sandbox,
      'npm install -g opencode-ai@latest 2>&1 | tail -20',
      { timeoutSeconds: 300 },
    );
  }

  // Start opencode serve if not already listening (in-sandbox curl — no preview auth)
  const check = await execInSandbox(
    sandbox,
    `curl -sf http://127.0.0.1:${port}/global/health || echo UNHEALTHY`,
    { timeoutSeconds: 30 },
  );
  if (!check.stdout.includes('"healthy"') && !check.stdout.includes('true')) {
    log('starting opencode serve in sandbox');
    const start = await execInSandbox(
      sandbox,
      `nohup opencode serve --hostname 127.0.0.1 --port ${port} > /tmp/opencode-serve.log 2>&1 & sleep 4; curl -sf http://127.0.0.1:${port}/global/health || (echo SERVE_FAIL; tail -n 40 /tmp/opencode-serve.log)`,
      { timeoutSeconds: 180 },
    );
    log('serve start output', start.stdout.slice(0, 800));
  }

  let baseUrl = `http://127.0.0.1:${port}`;
  let previewToken: string | undefined =
    process.env.OPENCODE_DAYTONA_PREVIEW_TOKEN || process.env.DAYTONA_PREVIEW_TOKEN;
  try {
    const preview = await fetchDaytonaPreview(state!.sandboxId, port);
    baseUrl = preview.url;
    previewToken = preview.token || previewToken;
    writeSandboxState({ ...state!, previewUrl: baseUrl });
    if (previewToken) {
      process.env.OPENCODE_DAYTONA_PREVIEW_TOKEN = previewToken;
    }
  } catch (e) {
    log('preview-url API failed', e instanceof Error ? e.message : e);
    try {
      const preview = await (sandbox as unknown as {
        getPreviewLink?: (p: number) => Promise<{ url: string; token?: string }>;
      }).getPreviewLink?.(port);
      if (preview?.url) {
        baseUrl = preview.url.replace(/\/$/, '');
        previewToken = preview.token || previewToken;
        writeSandboxState({ ...state!, previewUrl: baseUrl });
      }
    } catch (e2) {
      log('getPreviewLink failed', e2 instanceof Error ? e2.message : e2);
    }
  }

  return { baseUrl, sandboxId: state!.sandboxId, previewToken };
}

async function runPromptMode(
  baseUrl: string,
  milestone: MilestoneId,
  maxEvents: number,
  updateState: boolean,
  previewToken?: string,
): Promise<number> {
  const health = await fetchHealth(baseUrl, previewToken);
  if (!health.healthy) {
    const errPath = evidencePath('health-fail', 'md');
    fs.writeFileSync(
      errPath,
      `# OpenCode health failed\n\n- url: ${baseUrl}\n- error: ${health.error || 'unhealthy'}\n- previewToken: ${previewToken ? 'set' : 'unset'}\n`,
    );
    log('health failed', health);
    if (updateState) {
      appendStateNote(
        `- OpenCode SDK prompt aborted: health failed at \`${baseUrl}\` (${health.error || 'unhealthy'}). Evidence: \`${path.relative(ROOT, errPath)}\``,
      );
    }
    return 1;
  }

  const client = createOpencodeClient({
    baseUrl,
    fetch: makePreviewFetch(previewToken),
    throwOnError: true,
  });
  const modelRef =
    process.env.OPENCODE_MODEL ||
    process.env.BASETEN_INFERENCE_MODEL ||
    'baseten/openai/gpt-oss-120b';
  const model = parseModel(modelRef);

  if (process.env.BASETEN_API_KEY) {
    const auth = await rawOpencode(
      baseUrl,
      'PUT',
      '/auth/baseten',
      { type: 'api', key: process.env.BASETEN_API_KEY },
      previewToken,
    );
    log('auth.set baseten', auth.status, auth.ok ? 'ok' : auth.text.slice(0, 200));
  }

  // Prefer raw session create for older servers; SDK create also works on 1.1.x
  let sessionId: string | undefined;
  const created = await rawOpencode(
    baseUrl,
    'POST',
    '/session',
    { title: `gsd-milestone-${milestone}` },
    previewToken,
  );
  if (created.ok && created.json && typeof created.json === 'object') {
    sessionId = (created.json as { id?: string }).id;
  }
  if (!sessionId) {
    const session = await client.session.create({
      body: { title: `gsd-milestone-${milestone}` },
    });
    sessionId =
      (session.data as { id?: string } | undefined)?.id ||
      (session as unknown as { id?: string }).id;
  }
  if (!sessionId) {
    log('session.create missing id', created);
    return 1;
  }
  log('session', sessionId, 'model', model);

  const eventsPath = evidencePath(`${milestone.toLowerCase()}-events`);
  const watcher = subscribeEvents(client, {
    outPath: eventsPath,
    maxEvents,
    sessionId,
    untilIdle: true,
  });

  // Small delay so subscribe is ready before prompt (SDK best practice)
  await new Promise((r) => setTimeout(r, 200));

  const promptText = [
    MILESTONE_PROMPTS[milestone],
    '',
    'Repo context: cloud-agent formal happy path. Prefer editing .gsd/evidence and .gsd/STATE.md.',
    'Do not fabricate verification results.',
  ].join('\n');

  // Fire-and-forget style: prefer prompt_async so SSE can observe progress;
  // fall back to /message with a short timeout acknowledgment.
  const promptBody = {
    model,
    parts: [{ type: 'text', text: promptText }],
  };

  let promptResult: { ok: boolean; status: number; json: unknown; text: string; via: string };
  const asyncRes = await rawOpencode(
    baseUrl,
    'POST',
    `/session/${sessionId}/prompt_async`,
    promptBody,
    previewToken,
  ).catch(() => null);

  if (asyncRes && (asyncRes.ok || asyncRes.status === 204 || asyncRes.status === 200)) {
    log('prompt_async accepted', asyncRes.status);
    promptResult = { ...asyncRes, via: 'prompt_async' };
  } else {
    log('prompt_async unavailable; using /message (may block until completion)');
    // Don't let /message abort the whole run — race against idle watcher
    const msgPromise = rawOpencode(
      baseUrl,
      'POST',
      `/session/${sessionId}/message`,
      promptBody,
      previewToken,
    )
      .then((r) => ({ ...r, via: 'message' as const }))
      .catch((err: unknown) => ({
        ok: false,
        status: 0,
        json: null,
        text: err instanceof Error ? err.message : String(err),
        via: 'message' as const,
      }));
    promptResult = await Promise.race([
      msgPromise,
      new Promise<typeof promptResult>((resolve) =>
        setTimeout(
          () =>
            resolve({
              ok: true,
              status: 202,
              json: { note: 'message still in flight; relying on SSE idle' },
              text: '',
              via: 'message-timeout-defer',
            }),
          Math.min(15_000, Number(process.env.MILESTONE_IDLE_MS || '180000')),
        ),
      ),
    ]);
  }

  const { events, idle } = await watcher;

  const summaryPath = evidencePath(`${milestone.toLowerCase()}-summary`, 'md');
  const assistantText = JSON.stringify(promptResult.json ?? promptResult.text ?? {}, null, 2).slice(
    0,
    12000,
  );
  fs.writeFileSync(
    summaryPath,
    [
      `# OpenCode SDK milestone ${milestone}`,
      '',
      `- UTC: ${new Date().toISOString()}`,
      `- baseUrl: ${baseUrl}`,
      `- sessionId: ${sessionId}`,
      `- model: ${model.providerID}/${model.modelID}`,
      `- events: ${events.length}`,
      `- idle: ${idle}`,
      `- eventsFile: ${path.relative(ROOT, eventsPath)}`,
      '',
      '## Event types',
      ...[...new Set(events.map((e) => e.type || 'unknown'))].map((t) => `- ${t}`),
      '',
      '## Prompt result (truncated)',
      '```json',
      assistantText,
      '```',
      '',
    ].join('\n'),
  );

  log('wrote', summaryPath);
  if (updateState) {
    appendStateNote(
      `- OpenCode SDK \`${milestone}\` prompt: ${events.length} events, idle=${idle}. Evidence: \`${path.relative(ROOT, summaryPath)}\`, \`${path.relative(ROOT, eventsPath)}\``,
    );
  }
  return 0;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv);
  log('start', opts);

  if (opts.mode === 'dry-run') {
    const out = evidencePath(`${opts.milestone.toLowerCase()}-dry-run`, 'md');
    const plan = [
      `# OpenCode SDK milestone dry-run (${opts.milestone})`,
      '',
      `- UTC: ${new Date().toISOString()}`,
      `- mode: dry-run`,
      `- default baseUrl: ${opts.baseUrl}`,
      `- STATE_FILE: ${STATE_FILE}`,
      `- model hint: ${process.env.OPENCODE_MODEL || 'openai/gpt-oss-120b'}`,
      `- BASETEN_API_KEY: ${process.env.BASETEN_API_KEY ? 'set' : 'unset'}`,
      `- DAYTONA_API_KEY: ${process.env.DAYTONA_API_KEY ? 'set' : 'unset'}`,
      '',
      '## Prompt that would be sent',
      '',
      '```',
      MILESTONE_PROMPTS[opts.milestone],
      '```',
      '',
      '## Next',
      '',
      '```bash',
      `# local OpenCode serve + events`,
      `npx tsx scripts/opencode-sdk-milestone.ts --mode listen --base-url ${opts.baseUrl}`,
      `npx tsx scripts/opencode-sdk-milestone.ts --mode prompt --milestone ${opts.milestone}`,
      `# Daytona sandbox + OpenCode serve + events`,
      `npx tsx scripts/opencode-sdk-milestone.ts --mode daytona --milestone ${opts.milestone}`,
      '```',
      '',
    ].join('\n');
    fs.writeFileSync(out, plan);
    log('wrote', out);
    if (opts.updateState) {
      appendStateNote(
        `- OpenCode SDK dry-run for \`${opts.milestone}\` recorded at \`${path.relative(ROOT, out)}\``,
      );
    }
    process.exit(0);
  }

  let baseUrl = opts.baseUrl;
  let previewToken: string | undefined =
    process.env.OPENCODE_DAYTONA_PREVIEW_TOKEN || process.env.DAYTONA_PREVIEW_TOKEN;

  if (opts.mode === 'daytona') {
    if (!process.env.DAYTONA_API_KEY) {
      log('DAYTONA_API_KEY required for --mode daytona');
      process.exit(1);
    }
    try {
      const ensured = await ensureOpencodeInSandbox();
      baseUrl = process.env.OPENCODE_DAYTONA_BASE_URL || ensured.baseUrl;
      previewToken = ensured.previewToken || previewToken;
      log('daytona ready', {
        sandboxId: ensured.sandboxId,
        baseUrl,
        previewToken: previewToken ? 'set' : 'unset',
      });
    } catch (e) {
      const errPath = evidencePath('daytona-fail', 'md');
      fs.writeFileSync(
        errPath,
        `# Daytona bootstrap failed\n\n\`\`\`\n${e instanceof Error ? e.stack || e.message : String(e)}\n\`\`\`\n`,
      );
      if (opts.updateState) {
        appendStateNote(
          `- Daytona OpenCode bootstrap failed. Evidence: \`${path.relative(ROOT, errPath)}\``,
        );
      }
      releaseDaytonaClient();
      process.exit(1);
    }
  }

  if (opts.mode === 'listen') {
    const health = await fetchHealth(baseUrl, previewToken);
    if (!health.healthy) {
      log('unhealthy', health);
      process.exit(1);
    }
    const client = createOpencodeClient({
      baseUrl,
      fetch: makePreviewFetch(previewToken),
      throwOnError: true,
    });
    const outPath = evidencePath('listen');
    const { events } = await subscribeEvents(client, {
      outPath,
      maxEvents: opts.maxEvents,
      untilIdle: false,
    });
    log('listen done', events.length, 'events →', outPath);
    if (opts.updateState) {
      appendStateNote(
        `- OpenCode SDK listen captured ${events.length} events → \`${path.relative(ROOT, outPath)}\``,
      );
    }
    process.exit(0);
  }

  // prompt or daytona (after serve up)
  const code = await runPromptMode(
    baseUrl,
    opts.milestone,
    opts.maxEvents,
    opts.updateState,
    previewToken,
  );

  if (opts.mode === 'daytona' && opts.destroySandbox) {
    try {
      const state = readSandboxState();
      if (state?.sandboxId) {
        const daytona = getDaytonaClient();
        const sandbox = await daytona.get(state.sandboxId);
        await daytona.delete(sandbox, 60, true);
        clearSandboxState();
        log('sandbox destroyed');
      }
    } catch (e) {
      log('destroy failed', e instanceof Error ? e.message : e);
    }
  }

  releaseDaytonaClient();
  process.exit(code);
}

main().catch((e) => {
  console.error(e);
  releaseDaytonaClient();
  process.exit(1);
});
