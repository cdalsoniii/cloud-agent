/**
 * OpenCode serve + sandbox process board for formal/agent Daytona boxes.
 * Local agent talks to signed preview of :4096 (opencode serve).
 */
import { execInSandbox } from '../mastra/tools/daytona-client.js';
import {
  ASSISTANT_UI_WEB_PORT,
  FLEET_UI_PORT,
  ONTOLOGY_UI_PORT,
  OPENCODE_SERVE_PORT,
  REMOTE_ASSISTANT_UI,
  SHACL_PORT,
} from './types.js';

export interface OpenCodeConfigShape {
  $schema: string;
  model: string;
  provider: Record<string, unknown>;
  enabled_providers: string[];
}

export interface ProcessProbe {
  name: string;
  port: number;
  path: string;
  status: number;
  ok: boolean;
  sample?: string;
}

export interface SandboxProcessBoard {
  sandboxId: string;
  probedAt: string;
  processes: ProcessProbe[];
  allRequiredOk: boolean;
  required: string[];
}

export interface EnsureOpenCodeResult {
  ok: boolean;
  port: number;
  configPath: string;
  agentReadyPath: string;
  logTail?: string;
  healthBody?: string;
  error?: string;
}

/** Pure: build opencode.json from host env (no secrets logged by caller). */
export function buildOpenCodeConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OpenCodeConfigShape {
  const openrouter = env.OPENROUTER_API_KEY || '';
  const basetenKey =
    env.BASETEN_API_KEY || env.PROXY_API_KEY || env.OPENAI_API_KEY || 'sk-proxy';
  const basetenBase =
    env.BASETEN_PROXY_BASE_URL ||
    env.OPENAI_BASE_URL ||
    'https://inference.baseten.co/v1';
  const openrouterBase = env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1';

  if (openrouter) {
    const model = env.OPENCODE_MODEL || 'openrouter/openai/gpt-4o-mini';
    return {
      $schema: 'https://opencode.ai/config.json',
      model,
      provider: {
        openrouter: {
          npm: '@ai-sdk/openai-compatible',
          options: {
            baseURL: openrouterBase,
            apiKey: openrouter,
          },
          models: {
            'openai/gpt-4o-mini': { name: 'GPT-4o mini', tool_call: true },
            'anthropic/claude-sonnet-4': { name: 'Claude Sonnet', tool_call: true },
          },
        },
      },
      enabled_providers: ['openrouter'],
    };
  }

  const model = env.OPENCODE_MODEL || 'baseten-proxy/qwen-coder';
  return {
    $schema: 'https://opencode.ai/config.json',
    model,
    provider: {
      'baseten-proxy': {
        npm: '@ai-sdk/openai-compatible',
        options: {
          baseURL: basetenBase,
          apiKey: basetenKey,
        },
        models: {
          'qwen-coder': {
            name: 'Qwen-2.5-Coder-32B-Instruct',
            tool_call: true,
          },
          'openai/gpt-oss-120b': {
            name: 'GPT-OSS-120B',
            tool_call: true,
          },
        },
      },
    },
    enabled_providers: ['baseten-proxy'],
  };
}

/** Pure: process board specs for formal sandbox. */
export function formalProcessSpecs(opts?: {
  includeAssistantUi?: boolean;
  includeOpencode?: boolean;
}): Array<{ name: string; port: number; path: string; required: boolean }> {
  // Next is always probed when includeAssistantUi, but not required for "smooth"
  // formal+agent path (OpenCode is the local-agent entry). Set requiredAui explicitly via env.
  const probeAui = opts?.includeAssistantUi !== false;
  const requireAui =
    process.env.FORMAL_REQUIRE_ASSISTANT_UI === '1' ||
    process.env.FORMAL_REQUIRE_ASSISTANT_UI === 'true';
  const includeOc = opts?.includeOpencode !== false;
  return [
    { name: 'shacl', port: SHACL_PORT, path: '/health', required: true },
    { name: 'ontology-ui', port: ONTOLOGY_UI_PORT, path: '/health', required: true },
    { name: 'fleet-ui', port: FLEET_UI_PORT, path: '/health', required: true },
    {
      name: 'assistant-ui-web',
      port: ASSISTANT_UI_WEB_PORT,
      path: '/',
      required: probeAui && requireAui,
    },
    {
      name: 'opencode-serve',
      port: OPENCODE_SERVE_PORT,
      path: '/global/health',
      required: includeOc,
    },
  ];
}

export function boardAllRequiredOk(board: SandboxProcessBoard): boolean {
  const requiredNames = new Set(board.required);
  return board.processes
    .filter((p) => requiredNames.has(p.name))
    .every((p) => p.ok);
}

async function curlPort(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  port: number,
  path: string,
): Promise<{ status: number; sample: string }> {
  let cmd = `code=$(curl -s -o /tmp/probe-${port}.body -w "%{http_code}" --max-time 5 http://127.0.0.1:${port}${path} 2>/dev/null || echo 000); echo $code; head -c 200 /tmp/probe-${port}.body 2>/dev/null`;
  if (port === OPENCODE_SERVE_PORT) {
    cmd = `code=$(curl -s -o /tmp/probe-${port}.body -w "%{http_code}" --max-time 5 http://127.0.0.1:${port}/global/health 2>/dev/null || echo 000); if [ "$code" = "000" ] || [ "$code" = "404" ]; then code=$(curl -s -o /tmp/probe-${port}.body -w "%{http_code}" --max-time 5 http://127.0.0.1:${port}/health 2>/dev/null || echo 000); fi; echo $code; head -c 200 /tmp/probe-${port}.body 2>/dev/null`;
  }
  const r = await execInSandbox(sandbox, cmd, { timeoutSeconds: 20 });
  const lines = String(r.stdout || '').split('\n');
  const status = parseInt(lines[0] || '0', 10) || 0;
  return { status, sample: lines.slice(1).join('\n').slice(0, 200) };
}

export async function probeSandboxProcesses(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  opts?: {
    sandboxId?: string;
    includeAssistantUi?: boolean;
    includeOpencode?: boolean;
  },
): Promise<SandboxProcessBoard> {
  const specs = formalProcessSpecs(opts);
  const processes: ProcessProbe[] = [];
  for (const s of specs) {
    const { status, sample } = await curlPort(sandbox, s.port, s.path);
    const ok =
      status >= 200 &&
      status < 500 &&
      (s.port !== OPENCODE_SERVE_PORT ||
        status === 200 ||
        /ok|healthy|true/i.test(sample));
    processes.push({
      name: s.name,
      port: s.port,
      path: s.path,
      status,
      ok: status >= 200 && status < 400 ? true : ok && status === 200,
      sample,
    });
    // simplify: 2xx is ok
    processes[processes.length - 1].ok = status >= 200 && status < 400;
  }
  const required = specs.filter((s) => s.required).map((s) => s.name);
  const board: SandboxProcessBoard = {
    sandboxId: opts?.sandboxId || 'unknown',
    probedAt: new Date().toISOString(),
    processes,
    required,
    allRequiredOk: false,
  };
  board.allRequiredOk = boardAllRequiredOk(board);
  return board;
}

/**
 * Install/start OpenCode serve on OPENCODE_SERVE_PORT and write AGENT_READY.json.
 */
export async function ensureOpenCodeServeRunning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  opts?: {
    sandboxId?: string;
    port?: number;
    workspace?: string;
    readyTimeoutMs?: number;
  },
): Promise<EnsureOpenCodeResult> {
  const port = opts?.port ?? OPENCODE_SERVE_PORT;
  const configPath = '/home/daytona/.config/opencode/opencode.json';
  const agentReadyPath = '/home/daytona/AGENT_READY.json';
  const workspace =
    opts?.workspace ||
    (await pathExists(sandbox, REMOTE_ASSISTANT_UI)
      ? REMOTE_ASSISTANT_UI
      : '/home/daytona/work');

  const config = buildOpenCodeConfigFromEnv();
  const configJson = JSON.stringify(config, null, 2);
  // hex encode to avoid shell escaping secrets badly
  const hex = Buffer.from(configJson, 'utf8').toString('hex');

  await execInSandbox(
    sandbox,
    `mkdir -p /home/daytona/.config/opencode /home/daytona/work ${JSON.stringify(workspace)} && ` +
      `python3 -c "import pathlib; pathlib.Path(${JSON.stringify(configPath)}).write_text(bytes.fromhex(${JSON.stringify(hex)}).decode())"`,
    { timeoutSeconds: 30 },
  );

  // Ensure binary
  const which = await execInSandbox(
    sandbox,
    `export PATH="$HOME/.opencode/bin:/usr/local/bin:$PATH"; which opencode || true; opencode --version 2>/dev/null || true`,
    { timeoutSeconds: 30 },
  );
  if (!/opencode/i.test(which.stdout || '') && !which.ok) {
    // try install (non-fatal if fails — report error later)
    await execInSandbox(
      sandbox,
      `curl -fsSL https://opencode.ai/install 2>/dev/null | bash 2>/tmp/opencode-install.log || ` +
        `npm install -g opencode-ai 2>>/tmp/opencode-install.log || true; ` +
        `export PATH="$HOME/.opencode/bin:/usr/local/bin:$PATH"; which opencode || echo OPENCODE_MISSING`,
      { timeoutSeconds: 180 },
    );
  }

  // Kill prior serve by PID (sandbox only)
  await execInSandbox(
    sandbox,
    `for pid in $(ps -eo pid,args | awk '/opencode serve/ && !/awk/ {print $1}'); do kill $pid 2>/dev/null || true; done; sleep 1`,
    { timeoutSeconds: 20 },
  );

  // Start serve on 0.0.0.0 for Daytona proxy
  await execInSandbox(
    sandbox,
    `export PATH="$HOME/.opencode/bin:/usr/local/bin:$PATH"; ` +
      `export OPENAI_API_KEY="\${OPENAI_API_KEY:-}"; ` +
      `cd ${JSON.stringify(workspace)} && ` +
      `nohup opencode serve --hostname 0.0.0.0 --port ${port} >/tmp/opencode-serve.log 2>&1 & echo started; sleep 2`,
    { timeoutSeconds: 30 },
  );

  const deadline = Date.now() + (opts?.readyTimeoutMs ?? 90_000);
  let healthBody = '';
  let ok = false;
  while (Date.now() < deadline) {
    const h = await curlPort(sandbox, port, '/global/health');
    healthBody = h.sample;
    if (h.status >= 200 && h.status < 400) {
      ok = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 1500));
  }

  const log = await execInSandbox(sandbox, `tail -40 /tmp/opencode-serve.log 2>/dev/null || true`, {
    timeoutSeconds: 15,
  });

  const agentReady = {
    role: 'agent',
    runtime: 'opencode-serve',
    sandboxId: opts?.sandboxId || null,
    port,
    workspace,
    configPath,
    model: config.model,
    ready: ok,
    readyAt: new Date().toISOString(),
  };
  const readyHex = Buffer.from(JSON.stringify(agentReady, null, 2), 'utf8').toString('hex');
  await execInSandbox(
    sandbox,
    `python3 -c "import pathlib; pathlib.Path(${JSON.stringify(agentReadyPath)}).write_text(bytes.fromhex(${JSON.stringify(readyHex)}).decode())"`,
    { timeoutSeconds: 15 },
  );

  return {
    ok,
    port,
    configPath,
    agentReadyPath,
    logTail: log.stdout?.slice(-800),
    healthBody,
    error: ok ? undefined : 'opencode serve did not become healthy on port ' + port,
  };
}

async function pathExists(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  p: string,
): Promise<boolean> {
  const r = await execInSandbox(sandbox, `test -e ${JSON.stringify(p)} && echo yes || echo no`, {
    timeoutSeconds: 10,
  });
  return /yes/.test(r.stdout || '');
}

/** Host-side OpenCode health fetch (signed preview URL). */
export async function hostFetchOpenCodeHealth(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; status: number; body: string; url: string }> {
  const base = baseUrl.replace(/\/$/, '');
  for (const path of ['/global/health', '/health', '/']) {
    try {
      const res = await fetchImpl(base + path, { redirect: 'follow' });
      const body = await res.text();
      if (res.status >= 200 && res.status < 500) {
        return {
          ok: res.status >= 200 && res.status < 400,
          status: res.status,
          body: body.slice(0, 500),
          url: base + path,
        };
      }
    } catch {
      /* try next */
    }
  }
  return { ok: false, status: 0, body: '', url: base };
}
