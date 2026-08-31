import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import {
  getDaytonaClient,
  execInSandbox,
  defaultSandboxEnvs,
} from '../mastra/tools/daytona-client.js';
import type {
  PackPlan,
  SandboxProviderName,
  ShaclPreviewUrl,
  ShaclRemoteResult,
  UploadPackResult,
  VerificationSandbox,
  VerifierBackend,
  VerifierServiceResult,
} from './types.js';
import {
  ASSISTANT_UI_WEB_PORT,
  daytonaAutoStopMinutes,
  FLEET_UI_PORT,
  GUARDRAILS_PORT,
  ONTOLOGY_UI_PORT,
  OPENCODE_SERVE_PORT,
  REMOTE_FLEET_UI_SERVER,
  REMOTE_MULTI_SERVICE,
  REMOTE_ONTOLOGY_UI,
  REMOTE_ONTOLOGY_UI_SERVER,
  REMOTE_PX_ROOT,
  REMOTE_SHACL_SERVER,
  REMOTE_SHAPES_DIR,
  REMOTE_VERIFIER_ROOT,
  SERVICE_PORTS,
  SHACL_PORT,
} from './types.js';
import {
  ensureAssistantUiWebRunning,
  mintAssistantUiWebPreview,
} from './assistant-ui-web.js';
import {
  ensureOpenCodeServeRunning,
  probeSandboxProcesses,
} from './opencode-serve.js';
import { packVerifiers, resolveProvider, type SelectableVerifier } from './packing.js';
import {
  collectPxUploadFiles,
  readFleetUiServerScript,
  readMultiServiceServerScript,
  readOntologyUiAssets,
  readShaclServerScript,
  resolvePxRoot,
} from './px-pack.js';
import { hostRegenerateLinkmlArtifacts } from './host-rebuild.js';
import { writeOntologyStateFile } from './ontology-state.js';

/** Build multi-service port list including optional extra Guardrails AI binds. */
export function multiServicePorts(
  base: number[] = [7000, 7001, 7002, 7003],
  env: NodeJS.ProcessEnv = process.env,
): number[] {
  const set = new Set(base);
  const raw =
    env.GUARDRAILS_PORTS || env.GUARDRAILS_EXTRA_PORTS || env.GUARDRAILS_AI_PORTS || '';
  for (const part of raw.replace(/;/g, ',').split(',')) {
    const p = Number(part.trim());
    if (Number.isFinite(p) && p >= 1 && p <= 65535) set.add(Math.floor(p));
  }
  return [...set].sort((a, b) => a - b);
}

export function multiServiceBootstrapScript(
  ports: number[] = multiServicePorts(),
): string {
  const portList = ports.join(',');
  return `python3 - <<'PY'
import json, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
PORTS = [${portList}]
class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, obj):
        b = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(b)))
        self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        if self.path.startswith('/health'):
            return self._send(200, {"ok": True, "port": self.server.server_address[1]})
        self._send(404, {"ok": False})
    def do_POST(self):
        n = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(n) if n else b'{}'
        try: body = json.loads(raw.decode() or '{}')
        except Exception: body = {}
        fail = bool(body.get('force_fail') or body.get('fail'))
        self._send(200, {"pass": not fail, "detail": "validation rejected" if fail else "validation accepted", "port": self.server.server_address[1]})
def serve(port):
    ThreadingHTTPServer(('127.0.0.1', port), H).serve_forever()
for p in PORTS:
    threading.Thread(target=serve, args=(p,), daemon=True).start()
print(json.dumps({"ready": True, "ports": PORTS}), flush=True)
while True: time.sleep(3600)
PY`;
}

function servicePortsFromPack(pack: PackPlan): number[] {
  const ports = pack.services.map((s) => s.port);
  if (!ports.includes(GUARDRAILS_PORT)) ports.push(GUARDRAILS_PORT);
  // Merge operator extra Guardrails AI binds (N instances)
  return multiServicePorts(ports);
}

function parseShaclResponse(
  stdout: string,
  started: number,
  fallbackOk = false,
): ShaclRemoteResult {
  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(stdout || '{}') as Record<string, unknown>;
  } catch {
    parsed = { ok: fallbackOk, conforms: fallbackOk, engine: 'unknown', error: stdout.slice(0, 300) };
  }
  const violations = Array.isArray(parsed.violations)
    ? (parsed.violations as ShaclRemoteResult['violations'])
    : [];
  const conforms = Boolean(parsed.conforms);
  return {
    ok: conforms,
    conforms,
    engine: String(parsed.engine || 'pyshacl'),
    violations,
    resultsText: parsed.resultsText ? String(parsed.resultsText) : undefined,
    shapesPath: parsed.shapesPath ? String(parsed.shapesPath) : undefined,
    error: parsed.error ? String(parsed.error) : undefined,
    durationMs: Date.now() - started,
    raw: parsed,
  };
}

function findPythonWithPyshacl(): string {
  const candidates = [
    process.env.PYTHON_SHACL,
    '/usr/bin/python3',
    '/opt/homebrew/bin/python3',
    '/opt/anaconda3/bin/python3',
    'python3',
  ].filter(Boolean) as string[];
  for (const py of candidates) {
    const probe = spawnSync(py, ['-c', 'import pyshacl, rdflib'], {
      encoding: 'utf8',
      timeout: 10_000,
    });
    if (probe.status === 0) return py;
  }
  return candidates[0] || 'python3';
}

/**
 * Host-unit SHACL (pySHACL when available; fail-closed mock for oteemo).
 * Used when no remote sandbox is active so MCP + harness hooks still enforce.
 */
export async function hostInvokeShacl(body: {
  data: unknown;
  pack?: string;
  className?: string;
}): Promise<ShaclRemoteResult> {
  return mockInvokeShacl(body);
}

/** Local mock SHACL using host pySHACL when available; else structural heuristic. */
async function mockInvokeShacl(body: {
  data: unknown;
  pack?: string;
  className?: string;
}): Promise<ShaclRemoteResult> {
  const started = Date.now();
  const data = body.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return {
      ok: false,
      conforms: false,
      engine: 'mock',
      violations: [
        {
          id: 'shacl-invalid-payload',
          severity: 'blocking',
          title: 'Invalid payload',
          reason: 'expected JSON object',
        },
      ],
      durationMs: Date.now() - started,
    };
  }
  // Prefer host script when present
  try {
    const px = resolvePxRoot();
    const pack = String(body.pack || 'verifier-fleet').toLowerCase().replace(/_/g, '-');
    const shapes =
      px &&
      path.join(
        px,
        'generated',
        pack === 'skydio'
          ? 'skydio.shacl.ttl'
          : pack === 'oteemo' || pack === 'oteemo-devsecops'
            ? 'oteemo.shacl.ttl'
            : 'verifier-fleet.shacl.ttl',
      );
    const scriptCandidates = [
      path.resolve(
        process.env.HOME || '',
        'Documents/Personal/employment/partners/experiments/02-products/assistant-ui/scripts/shacl-validate.py',
      ),
      path.resolve(process.cwd(), '../02-products/assistant-ui/scripts/shacl-validate.py'),
    ];
    const script = scriptCandidates.find((s) => fs.existsSync(s));
    if (script && shapes && fs.existsSync(shapes)) {
      const className =
        body.className ||
        (pack === 'skydio'
          ? 'IncidentPostmortemReport'
          : pack === 'oteemo' || pack === 'oteemo-devsecops'
            ? 'Engagement'
            : 'VerifierFleet');
      const py = findPythonWithPyshacl();
      const r = spawnSync(
        py,
        [script, '--shapes', shapes, '--stdin', '--pack', pack, '--class-name', className],
        { input: JSON.stringify(data), encoding: 'utf8', timeout: 30_000 },
      );
      const out = r.stdout || r.stderr || '{}';
      const result = parseShaclResponse(out, started, r.status === 0);
      // Normalize message-only violations from shacl-validate.py into blocking rows
      if (!result.conforms) {
        try {
          const raw = JSON.parse(out) as {
            violations?: Array<{ message?: string; id?: string; severity?: string; title?: string; reason?: string }>;
            resultsText?: string;
          };
          const list = raw.violations || [];
          if (list.length > 0) {
            result.violations = list.map((v, i) => ({
              id: v.id || `shacl-v${i}`,
              severity: (v.severity as 'blocking' | 'important' | 'info') || 'blocking',
              title: v.title || 'SHACL constraint violation',
              reason: v.reason || v.message || raw.resultsText?.slice(0, 300) || 'non-conformant',
            }));
          } else if (result.violations.length === 0) {
            result.violations = [
              {
                id: 'shacl-nonconformant',
                severity: 'blocking',
                title: 'SHACL constraint violation',
                reason: raw.resultsText?.slice(0, 300) || 'non-conformant',
              },
            ];
          }
        } catch {
          /* keep */
        }
      }
      if (result.engine !== 'unavailable') return result;
    }
  } catch {
    /* fall through to mock heuristic */
  }
  // Heuristic: empty object fails; presence of fleet_id or report_id passes mock.
  // Oteemo Engagement must never green-light via fleet mock alone — require pySHACL + oteemo.shacl.ttl.
  const packName = String(body.pack || 'verifier-fleet').toLowerCase().replace(/_/g, '-');
  if (packName === 'oteemo' || packName === 'oteemo-devsecops') {
    return {
      ok: false,
      conforms: false,
      engine: 'mock',
      violations: [
        {
          id: 'shacl-mock-oteemo-requires-pyshacl',
          severity: 'blocking',
          title: 'Oteemo pack requires pySHACL shapes',
          reason:
            'mock heuristic does not validate Engagement; ensure oteemo.shacl.ttl + pySHACL path ran',
        },
      ],
      durationMs: Date.now() - started,
    };
  }
  const o = data as Record<string, unknown>;
  const ok = Boolean(o.fleet_id || o.fleetId || o.report_id || o.reportId || o.verifiers);
  return {
    ok,
    conforms: ok,
    engine: 'mock',
    violations: ok
      ? []
      : [
          {
            id: 'shacl-mock-nonconformant',
            severity: 'blocking',
            title: 'Mock SHACL non-conformant',
            reason: 'payload missing expected root fields',
          },
        ],
    durationMs: Date.now() - started,
  };
}

class MockBox implements VerificationSandbox {
  provider: SandboxProviderName = 'mock';
  sandboxId: string;
  pack: PackPlan;
  private uploaded: string[] = [];
  private pxRoot: string | null = null;

  constructor(pack: PackPlan) {
    this.pack = pack;
    this.sandboxId = `mock-pack-${Date.now().toString(36)}`;
  }
  async create(opts?: { env?: Record<string, string>; pxRoot?: string }): Promise<void> {
    this.pxRoot = resolvePxRoot(opts?.pxRoot);
    if (this.pxRoot) {
      await this.uploadLinkmlPack(this.pxRoot);
    }
  }
  async ensureServicesReady(): Promise<void> {}
  async invoke(backend: VerifierBackend, body: unknown): Promise<VerifierServiceResult> {
    const started = Date.now();
    const force =
      body && typeof body === 'object' && (body as { force_fail?: boolean }).force_fail === true;
    return {
      pass: !force,
      detail: force ? 'Validation did not pass (mock)' : 'Validation accepted (mock)',
      durationMs: Date.now() - started,
      raw: { backend, mock: true },
    };
  }
  async uploadLinkmlPack(localRoot?: string): Promise<UploadPackResult> {
    const root = resolvePxRoot(localRoot || this.pxRoot || undefined);
    if (!root) {
      return { files: [], remoteRoot: REMOTE_PX_ROOT, shapesDir: REMOTE_SHAPES_DIR };
    }
    hostRegenerateLinkmlArtifacts(root);
    writeOntologyStateFile(root);
    const files = collectPxUploadFiles(root).map((f) => f.remoteRel);
    if (fs.existsSync(path.join(root, 'generated/ontology-state.json'))) {
      files.push('generated/ontology-state.json');
    }
    this.uploaded = files;
    this.pxRoot = root;
    return {
      files,
      remoteRoot: REMOTE_PX_ROOT,
      shapesDir: REMOTE_SHAPES_DIR,
      ontologyUiPort: ONTOLOGY_UI_PORT,
    } as UploadPackResult;
  }
  async invokeShacl(body: {
    data: unknown;
    pack?: string;
    className?: string;
  }): Promise<ShaclRemoteResult> {
    return mockInvokeShacl(body);
  }
  async getShaclPreviewUrl(): Promise<ShaclPreviewUrl | null> {
    return {
      url: `http://127.0.0.1:${SHACL_PORT}`,
      port: SHACL_PORT,
      expiresInSeconds: 3600,
    };
  }
  async getOntologyUiPreviewUrl(): Promise<ShaclPreviewUrl | null> {
    return {
      url: `http://127.0.0.1:${ONTOLOGY_UI_PORT}`,
      port: ONTOLOGY_UI_PORT,
      expiresInSeconds: 3600,
    };
  }
  async getFleetUiPreviewUrl(): Promise<ShaclPreviewUrl | null> {
    return {
      url: `http://127.0.0.1:${FLEET_UI_PORT}`,
      port: FLEET_UI_PORT,
      expiresInSeconds: 3600,
    };
  }
  async destroy(): Promise<void> {
    this.uploaded = [];
  }
}

async function daytonaUploadFiles(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  files: Array<{ local: string; remoteRel: string }>,
): Promise<string[]> {
  const uploaded: string[] = [];
  await execInSandbox(sandbox, `mkdir -p ${REMOTE_SHAPES_DIR} ${REMOTE_PX_ROOT}/linkml`, {
    timeoutSeconds: 30,
  });
  for (const f of files) {
    const remote = `${REMOTE_PX_ROOT}/${f.remoteRel}`;
    const remoteDir = path.posix.dirname(remote);
    await execInSandbox(sandbox, `mkdir -p ${JSON.stringify(remoteDir)}`, { timeoutSeconds: 15 });
    const buf = fs.readFileSync(f.local);
    if (sandbox.fs?.uploadFile) {
      await sandbox.fs.uploadFile(buf, remote);
    } else {
      // base64 fallback via shell
      const b64 = buf.toString('base64');
      // chunk if huge
      const chunkSize = 40_000;
      if (b64.length <= chunkSize) {
        await execInSandbox(
          sandbox,
          `python3 -c "import base64,pathlib; pathlib.Path(${JSON.stringify(remote)}).write_bytes(base64.b64decode(${JSON.stringify(b64)}))"`,
          { timeoutSeconds: 60 },
        );
      } else {
        await execInSandbox(sandbox, `rm -f ${JSON.stringify(remote + '.b64')}`, {
          timeoutSeconds: 15,
        });
        for (let i = 0; i < b64.length; i += chunkSize) {
          const part = b64.slice(i, i + chunkSize);
          await execInSandbox(
            sandbox,
            `printf %s ${JSON.stringify(part)} >> ${JSON.stringify(remote + '.b64')}`,
            { timeoutSeconds: 30 },
          );
        }
        await execInSandbox(
          sandbox,
          `python3 -c "import base64,pathlib; p=pathlib.Path(${JSON.stringify(remote + '.b64')}); pathlib.Path(${JSON.stringify(remote)}).write_bytes(base64.b64decode(p.read_text())); p.unlink(missing_ok=True)"`,
          { timeoutSeconds: 60 },
        );
      }
    }
    uploaded.push(f.remoteRel);
  }
  return uploaded;
}

async function ensureShaclServerRunning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
): Promise<void> {
  const script = readShaclServerScript();
  if (script) {
    if (sandbox.fs?.uploadFile) {
      await sandbox.fs.uploadFile(script.content, REMOTE_SHACL_SERVER);
    } else {
      const b64 = script.content.toString('base64');
      await execInSandbox(
        sandbox,
        `python3 -c "import base64,pathlib; pathlib.Path(${JSON.stringify(REMOTE_SHACL_SERVER)}).write_bytes(base64.b64decode(${JSON.stringify(b64)}))"`,
        { timeoutSeconds: 60 },
      );
    }
  }

  // Install pySHACL if missing (stock daytona-large)
  await execInSandbox(
    sandbox,
    `python3 -c "import pyshacl,rdflib" 2>/dev/null || pip install --user -q pyshacl rdflib`,
    { timeoutSeconds: 180 },
  );

  await execInSandbox(
    sandbox,
    `mkdir -p ${REMOTE_SHAPES_DIR}; ` +
      `(pkill -f '[s]hacl-server.py' 2>/dev/null || true); ` +
      `nohup env SHACL_SHAPES_DIR=${REMOTE_SHAPES_DIR} SHACL_PORT=${SHACL_PORT} ` +
      `python3 ${REMOTE_SHACL_SERVER} --port ${SHACL_PORT} --shapes-dir ${REMOTE_SHAPES_DIR} ` +
      `>/tmp/shacl-server.log 2>&1 & echo shacl-started`,
    { timeoutSeconds: 30 },
  );
}

/** Upload React Flow ontology viewer + state JSON; serve on ONTOLOGY_UI_PORT (7005). */
async function ensureOntologyUiRunning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  pxRoot?: string | null,
  customerId?: string | null,
): Promise<void> {
  // Host: snapshot current ontology graph state into generated/ontology-state.json
  const statePath = writeOntologyStateFile(pxRoot, undefined, customerId || undefined);
  await execInSandbox(sandbox, `mkdir -p ${REMOTE_ONTOLOGY_UI} ${REMOTE_SHAPES_DIR}`, {
    timeoutSeconds: 20,
  });

  const assets = readOntologyUiAssets();
  for (const a of assets) {
    const remote = a.remoteRel.startsWith('../')
      ? REMOTE_ONTOLOGY_UI_SERVER
      : `${REMOTE_ONTOLOGY_UI}/${a.remoteRel}`;
    if (sandbox.fs?.uploadFile) {
      await sandbox.fs.uploadFile(a.content, remote);
    } else {
      const b64 = a.content.toString('base64');
      await execInSandbox(
        sandbox,
        `python3 -c "import base64,pathlib; pathlib.Path(${JSON.stringify(remote)}).write_bytes(base64.b64decode(${JSON.stringify(b64)}))"`,
        { timeoutSeconds: 60 },
      );
    }
  }

  const defaultState = pxRoot
    ? path.join(pxRoot, 'generated/ontology-state.json')
    : null;
  const toUpload =
    (statePath && fs.existsSync(statePath) && statePath) ||
    (defaultState && fs.existsSync(defaultState) && defaultState) ||
    null;
  if (toUpload) {
    const buf = fs.readFileSync(toUpload);
    const remoteState = `${REMOTE_SHAPES_DIR}/ontology-state.json`;
    if (sandbox.fs?.uploadFile) {
      await sandbox.fs.uploadFile(buf, remoteState);
    } else {
      const b64 = buf.toString('base64');
      await execInSandbox(
        sandbox,
        `python3 -c "import base64,pathlib; pathlib.Path(${JSON.stringify(remoteState)}).write_bytes(base64.b64decode(${JSON.stringify(b64)}))"`,
        { timeoutSeconds: 60 },
      );
    }
  }

  await execInSandbox(
    sandbox,
    `(pkill -f '[o]ntology-ui-server.py' 2>/dev/null || true); ` +
      `nohup env PX_REMOTE_ROOT=${REMOTE_PX_ROOT} SHACL_SHAPES_DIR=${REMOTE_SHAPES_DIR} ` +
      `ONTOLOGY_UI_DIR=${REMOTE_ONTOLOGY_UI} ONTOLOGY_UI_PORT=${ONTOLOGY_UI_PORT} ` +
      `SANDBOX_ROLE=formal ` +
      `python3 ${REMOTE_ONTOLOGY_UI_SERVER} --port ${ONTOLOGY_UI_PORT} --ui-dir ${REMOTE_ONTOLOGY_UI} ` +
      `>/tmp/ontology-ui.log 2>&1 & echo ontology-ui-started`,
    { timeoutSeconds: 30 },
  );
}

/** Upload formal verifier-fleet UI; serve on FLEET_UI_PORT (7006) inside sandbox. */
async function ensureFleetUiRunning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
): Promise<void> {
  const script = readFleetUiServerScript();
  if (script) {
    if (sandbox.fs?.uploadFile) {
      await sandbox.fs.uploadFile(script.content, REMOTE_FLEET_UI_SERVER);
    } else {
      const b64 = script.content.toString('base64');
      await execInSandbox(
        sandbox,
        `python3 -c "import base64,pathlib; pathlib.Path(${JSON.stringify(REMOTE_FLEET_UI_SERVER)}).write_bytes(base64.b64decode(${JSON.stringify(b64)}))"`,
        { timeoutSeconds: 60 },
      );
    }
  }

  await execInSandbox(
    sandbox,
    `mkdir -p ${REMOTE_VERIFIER_ROOT} ${REMOTE_SHAPES_DIR}; ` +
      `(pkill -f '[f]leet-ui-server.py' 2>/dev/null || true); ` +
      `nohup env FLEET_UI_PORT=${FLEET_UI_PORT} SANDBOX_ROLE=formal ` +
      `ONTOLOGY_STATE_PATH=${REMOTE_SHAPES_DIR}/ontology-state.json ` +
      `ONTOLOGY_STATE_URL=http://127.0.0.1:${ONTOLOGY_UI_PORT}/api/ontology/state ` +
      `python3 ${REMOTE_FLEET_UI_SERVER} --port ${FLEET_UI_PORT} ` +
      `>/tmp/fleet-ui.log 2>&1 & echo fleet-ui-started`,
    { timeoutSeconds: 30 },
  );
}

/** Wait until ontology (7005) and fleet (7006) health endpoints respond. */
async function waitFormalUiReady(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  timeoutMs = 45_000,
): Promise<{ ontology: boolean; fleet: boolean }> {
  const deadline = Date.now() + timeoutMs;
  let ontology = false;
  let fleet = false;
  while (Date.now() < deadline) {
    const o = await execInSandbox(
      sandbox,
      `curl -sf http://127.0.0.1:${ONTOLOGY_UI_PORT}/health`,
      { timeoutSeconds: 15 },
    );
    ontology = o.ok;
    const f = await execInSandbox(
      sandbox,
      `curl -sf http://127.0.0.1:${FLEET_UI_PORT}/health`,
      { timeoutSeconds: 15 },
    );
    fleet = f.ok;
    if (ontology && fleet) return { ontology, fleet };
    await new Promise((r) => setTimeout(r, 800));
  }
  return { ontology, fleet };
}

class DaytonaBox implements VerificationSandbox {
  provider: SandboxProviderName = 'daytona';
  sandboxId = '';
  pack: PackPlan;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sandbox: any = null;
  private pxRoot: string | null = null;
  /** Customer pack id for ontology-state (formal ingest). */
  customerId: string | null = null;

  constructor(pack: PackPlan) {
    this.pack = pack;
  }

  async create(opts?: {
    env?: Record<string, string>;
    pxRoot?: string;
    skipShacl?: boolean;
    customerId?: string;
  }): Promise<void> {
    const daytona = getDaytonaClient();
    if (opts?.customerId) this.customerId = opts.customerId;
    const envVars = {
      ...defaultSandboxEnvs(),
      ...(opts?.env || {}),
      VERIFIER_PACKED: '1',
      SHACL_PORT: String(SHACL_PORT),
      SHACL_SHAPES_DIR: REMOTE_SHAPES_DIR,
      SANDBOX_ROLE: 'formal',
      FLEET_UI_PORT: String(FLEET_UI_PORT),
      ONTOLOGY_UI_PORT: String(ONTOLOGY_UI_PORT),
      OPENCODE_SERVE_PORT: String(OPENCODE_SERVE_PORT),
      // Inference for in-sandbox opencode serve (local agent)
      ...(process.env.OPENROUTER_API_KEY
        ? {
            OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
            OPENROUTER_BASE_URL:
              process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
          }
        : {}),
      ...(process.env.BASETEN_API_KEY
        ? { BASETEN_API_KEY: process.env.BASETEN_API_KEY }
        : {}),
      ...(process.env.BASETEN_PROXY_BASE_URL
        ? { BASETEN_PROXY_BASE_URL: process.env.BASETEN_PROXY_BASE_URL }
        : {}),
      ...(process.env.OPENAI_API_KEY ? { OPENAI_API_KEY: process.env.OPENAI_API_KEY } : {}),
      ...(process.env.OPENAI_BASE_URL ? { OPENAI_BASE_URL: process.env.OPENAI_BASE_URL } : {}),
      ...(process.env.PROXY_API_KEY ? { PROXY_API_KEY: process.env.PROXY_API_KEY } : {}),
      ...(process.env.OPENCODE_MODEL ? { OPENCODE_MODEL: process.env.OPENCODE_MODEL } : {}),
    };
    const autoStopInterval = daytonaAutoStopMinutes(); // max 5 min for dev cost control
    const sandbox = await daytona.create(
      {
        language: 'python',
        snapshot: process.env.VERIFIER_SANDBOX_TEMPLATE || process.env.DAYTONA_SNAPSHOT || 'daytona-large',
        envVars,
        autoStopInterval,
        public: false,
      } as Parameters<typeof daytona.create>[0],
      { timeout: 120 },
    );
    this.sandbox = sandbox;
    this.sandboxId = sandbox.id;
    this.pxRoot = resolvePxRoot(opts?.pxRoot);

    // Prefer full multi-service-server.py (lean-aware); fallback to inline bootstrap
    // Paths under REMOTE_VERIFIER_ROOT (writable home), not /opt (root-only on stock snapshots)
    await execInSandbox(sandbox, `mkdir -p ${REMOTE_VERIFIER_ROOT}`, { timeoutSeconds: 20 });
    const multi = readMultiServiceServerScript();
    if (multi) {
      if (sandbox.fs?.uploadFile) {
        await sandbox.fs.uploadFile(multi.content, REMOTE_MULTI_SERVICE);
      } else {
        const b64 = multi.content.toString('base64');
        await execInSandbox(
          sandbox,
          `python3 -c "import base64,pathlib; pathlib.Path(${JSON.stringify(REMOTE_MULTI_SERVICE)}).write_bytes(base64.b64decode(${JSON.stringify(b64)}))"`,
          { timeoutSeconds: 60 },
        );
      }
      await execInSandbox(
        sandbox,
        `nohup python3 ${REMOTE_MULTI_SERVICE} >/tmp/verifier-services.log 2>&1 & echo started`,
        { timeoutSeconds: 30 },
      );
    } else {
      const ports = servicePortsFromPack(this.pack);
      const script = multiServiceBootstrapScript(ports);
      await execInSandbox(
        sandbox,
        `nohup bash -c ${JSON.stringify(script)} >/tmp/verifier-services.log 2>&1 & echo started`,
        { timeoutSeconds: 60 },
      );
    }

    if (!opts?.skipShacl) {
      if (this.pxRoot) {
        await this.uploadLinkmlPack(this.pxRoot);
      } else {
        await ensureShaclServerRunning(sandbox);
        await ensureOntologyUiRunning(sandbox, this.pxRoot, this.customerId);
        await ensureFleetUiRunning(sandbox);
      }
    }
  }

  async ensureServicesReady(timeoutMs = 45_000): Promise<void> {
    if (!this.sandbox) throw new Error('Daytona sandbox not created');
    const deadline = Date.now() + timeoutMs;
    const ports = servicePortsFromPack(this.pack);
    while (Date.now() < deadline) {
      const checks = [
        ...ports.map((p) => `curl -sf http://127.0.0.1:${p}/health`),
        `curl -sf http://127.0.0.1:${SHACL_PORT}/health`,
        `curl -sf http://127.0.0.1:${ONTOLOGY_UI_PORT}/health`,
        `curl -sf http://127.0.0.1:${FLEET_UI_PORT}/health`,
      ].join(' && ');
      const r = await execInSandbox(this.sandbox, checks, { timeoutSeconds: 20 });
      if (r.ok) return;
      await new Promise((res) => setTimeout(res, 800));
    }
    // Soft-fail if only SHACL is late: still require at least SHACL for schema path
    const shacl = await execInSandbox(
      this.sandbox,
      `curl -sf http://127.0.0.1:${SHACL_PORT}/health`,
      { timeoutSeconds: 15 },
    );
    if (shacl.ok) {
      // formal UIs may still be coming up
      await waitFormalUiReady(this.sandbox, 15_000);
      return;
    }
    throw new Error('verification/SHACL services not ready');
  }

  async invoke(backend: VerifierBackend, body: unknown): Promise<VerifierServiceResult> {
    const started = Date.now();
    if (!this.sandbox) throw new Error('Daytona sandbox not created');
    const port = SERVICE_PORTS[backend];
    const payload = JSON.stringify(body ?? {});
    const cmd = `curl -sf -X POST http://127.0.0.1:${port}/verify -H 'Content-Type: application/json' -d ${JSON.stringify(payload)}`;
    const r = await execInSandbox(this.sandbox, cmd, { timeoutSeconds: 60 });
    let parsed: { pass?: boolean; detail?: string } = {};
    try {
      parsed = JSON.parse(r.stdout || '{}');
    } catch {
      parsed = { pass: r.ok, detail: r.stdout.slice(0, 200) };
    }
    return {
      pass: Boolean(parsed.pass),
      detail: parsed.detail || (parsed.pass ? 'Validation accepted' : 'Validation rejected'),
      durationMs: Date.now() - started,
      raw: parsed,
    };
  }

  async uploadLinkmlPack(localRoot?: string): Promise<UploadPackResult> {
    if (!this.sandbox) throw new Error('Daytona sandbox not created');
    const root = resolvePxRoot(localRoot || this.pxRoot || undefined);
    if (!root) {
      await ensureShaclServerRunning(this.sandbox);
      await ensureOntologyUiRunning(this.sandbox, null, this.customerId);
      await ensureFleetUiRunning(this.sandbox);
      return {
        files: [],
        remoteRoot: REMOTE_PX_ROOT,
        shapesDir: REMOTE_SHAPES_DIR,
        ontologyUiPort: ONTOLOGY_UI_PORT,
      };
    }
    this.pxRoot = root;
    // Host regenerate so uploaded TTL matches latest LinkML YAML
    hostRegenerateLinkmlArtifacts(root);
    writeOntologyStateFile(root, undefined, this.customerId || undefined);
    const files = collectPxUploadFiles(root);
    if (fs.existsSync(path.join(root, 'generated/ontology-state.json'))) {
      files.push({
        local: path.join(root, 'generated/ontology-state.json'),
        remoteRel: 'generated/ontology-state.json',
      });
    }
    const uploaded = await daytonaUploadFiles(this.sandbox, files);
    await ensureShaclServerRunning(this.sandbox);
    await ensureOntologyUiRunning(this.sandbox, root, this.customerId);
    await ensureFleetUiRunning(this.sandbox);
    // reload + optional in-sandbox rebuild (gen-shacl when present)
    await execInSandbox(
      this.sandbox,
      `curl -s -X POST http://127.0.0.1:${SHACL_PORT}/reload -H 'Content-Type: application/json' -d '{"rebuild":true}' || curl -sf -X POST http://127.0.0.1:${SHACL_PORT}/rebuild || true`,
      { timeoutSeconds: 120 },
    );
    const ui = await waitFormalUiReady(this.sandbox, 30_000);
    return {
      files: uploaded,
      remoteRoot: REMOTE_PX_ROOT,
      shapesDir: REMOTE_SHAPES_DIR,
      ontologyUiPort: ONTOLOGY_UI_PORT,
      ...(ui as object),
    };
  }

  async invokeShacl(body: {
    data: unknown;
    pack?: string;
    className?: string;
  }): Promise<ShaclRemoteResult> {
    const started = Date.now();
    if (!this.sandbox) throw new Error('Daytona sandbox not created');
    const payload = JSON.stringify({
      data: body.data,
      pack: body.pack || 'verifier-fleet',
      className: body.className,
    });
    // -s without -f so 422 body is returned
    const cmd = `curl -s -X POST http://127.0.0.1:${SHACL_PORT}/validate -H 'Content-Type: application/json' -d ${JSON.stringify(payload)}`;
    const r = await execInSandbox(this.sandbox, cmd, { timeoutSeconds: 60 });
    return parseShaclResponse(r.stdout || '{}', started, false);
  }

  private async signedPreview(
    port: number,
    expiresInSeconds = 3600,
  ): Promise<ShaclPreviewUrl | null> {
    if (!this.sandbox) return null;
    try {
      // Current @daytona/sdk: getSignedPreviewUrl(port) — short-lived tokens.
      // createSignedPreviewUrl may exist on older SDKs.
      // Prefer signed (port-token host) over getPreviewLink (sandbox-id host needs session).
      let signed: { url?: string; previewUrl?: string; token?: string } | string | null = null;
      if (typeof this.sandbox.getSignedPreviewUrl === 'function') {
        signed = await this.sandbox.getSignedPreviewUrl(port);
      } else if (typeof this.sandbox.createSignedPreviewUrl === 'function') {
        signed = await this.sandbox.createSignedPreviewUrl(port, expiresInSeconds);
      } else if (typeof this.sandbox.getPreviewLink === 'function') {
        signed = await this.sandbox.getPreviewLink(port);
      }
      if (!signed) return null;
      if (typeof signed === 'string') {
        return { url: signed, port, expiresInSeconds };
      }
      return {
        url: signed.url || signed.previewUrl || String(signed),
        token: signed.token,
        port,
        expiresInSeconds,
      };
    } catch {
      /* no signed preview */
    }
    return null;
  }

  async getShaclPreviewUrl(expiresInSeconds = 300): Promise<ShaclPreviewUrl | null> {
    return this.signedPreview(SHACL_PORT, expiresInSeconds);
  }

  async getOntologyUiPreviewUrl(expiresInSeconds = 300): Promise<ShaclPreviewUrl | null> {
    return this.signedPreview(ONTOLOGY_UI_PORT, expiresInSeconds);
  }

  async getFleetUiPreviewUrl(expiresInSeconds = 300): Promise<ShaclPreviewUrl | null> {
    return this.signedPreview(FLEET_UI_PORT, expiresInSeconds);
  }

  async getAssistantUiWebPreviewUrl(expiresInSeconds = 3600): Promise<ShaclPreviewUrl | null> {
    if (!this.sandbox) return null;
    const minted = await mintAssistantUiWebPreview(this.sandbox, ASSISTANT_UI_WEB_PORT);
    if (minted) return { ...minted, expiresInSeconds };
    return this.signedPreview(ASSISTANT_UI_WEB_PORT, expiresInSeconds);
  }

  async ensureAssistantUiWeb(opts?: {
    assistantUiRoot?: string;
    skipInstall?: boolean;
  }): Promise<unknown> {
    if (!this.sandbox) throw new Error('Daytona sandbox not created');
    return ensureAssistantUiWebRunning(this.sandbox, {
      assistantUiRoot: opts?.assistantUiRoot,
      skipInstall: opts?.skipInstall,
      port: ASSISTANT_UI_WEB_PORT,
    });
  }

  async ensureOpenCodeServe(opts?: { workspace?: string }): Promise<unknown> {
    if (!this.sandbox) throw new Error('Daytona sandbox not created');
    return ensureOpenCodeServeRunning(this.sandbox, {
      sandboxId: this.sandboxId,
      port: OPENCODE_SERVE_PORT,
      workspace: opts?.workspace,
    });
  }

  async probeProcesses(opts?: {
    includeAssistantUi?: boolean;
    includeOpencode?: boolean;
  }): Promise<unknown> {
    if (!this.sandbox) throw new Error('Daytona sandbox not created');
    return probeSandboxProcesses(this.sandbox, {
      sandboxId: this.sandboxId,
      includeAssistantUi: opts?.includeAssistantUi,
      includeOpencode: opts?.includeOpencode,
    });
  }

  async getOpenCodePreviewUrl(expiresInSeconds = 3600): Promise<ShaclPreviewUrl | null> {
    return this.signedPreview(OPENCODE_SERVE_PORT, expiresInSeconds);
  }

  /** Probe in-sandbox formal UI health via curl (product path). */
  async probeFormalUi(): Promise<{
    ontology: { ok: boolean; body?: string };
    fleet: { ok: boolean; body?: string };
    stateSnippet?: string;
  }> {
    if (!this.sandbox) {
      return {
        ontology: { ok: false },
        fleet: { ok: false },
      };
    }
    const o = await execInSandbox(
      this.sandbox,
      `curl -s http://127.0.0.1:${ONTOLOGY_UI_PORT}/health`,
      { timeoutSeconds: 20 },
    );
    const f = await execInSandbox(
      this.sandbox,
      `curl -s http://127.0.0.1:${FLEET_UI_PORT}/health`,
      { timeoutSeconds: 20 },
    );
    const st = await execInSandbox(
      this.sandbox,
      `curl -s http://127.0.0.1:${ONTOLOGY_UI_PORT}/api/ontology/state | head -c 4000`,
      { timeoutSeconds: 20 },
    );
    return {
      ontology: { ok: /"ok"\s*:\s*true/.test(o.stdout), body: o.stdout },
      fleet: { ok: /"ok"\s*:\s*true/.test(f.stdout), body: f.stdout },
      stateSnippet: st.stdout || undefined,
    };
  }

  async destroy(): Promise<void> {
    try {
      if (this.sandbox) {
        const daytona = getDaytonaClient();
        await daytona.delete(this.sandbox);
      }
    } catch {
      /* best-effort */
    }
    this.sandbox = null;
  }
}

class E2BBox implements VerificationSandbox {
  provider: SandboxProviderName = 'e2b';
  sandboxId = '';
  pack: PackPlan;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sandbox: any = null;
  private pxRoot: string | null = null;

  constructor(pack: PackPlan) {
    this.pack = pack;
  }

  async create(opts?: {
    env?: Record<string, string>;
    pxRoot?: string;
    skipShacl?: boolean;
  }): Promise<void> {
    const apiKey = process.env.E2B_API_KEY;
    if (!apiKey) throw new Error('E2B_API_KEY required');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let mod: any;
    try {
      mod = await import('e2b');
    } catch {
      throw new Error('e2b package not installed (npm i e2b)');
    }
    const template = process.env.VERIFIER_SANDBOX_TEMPLATE || process.env.E2B_TEMPLATE;
    this.sandbox = template
      ? await mod.Sandbox.create(template, { apiKey, envs: opts?.env })
      : await mod.Sandbox.create({ apiKey, envs: opts?.env });
    this.sandboxId = this.sandbox.sandboxId || this.sandbox.id || `e2b-${Date.now()}`;
    this.pxRoot = resolvePxRoot(opts?.pxRoot);

    const ports = servicePortsFromPack(this.pack);
    const script = multiServiceBootstrapScript(ports);
    await this.sandbox.commands.run(
      `bash -c ${JSON.stringify(`nohup bash -c ${JSON.stringify(script)} >/tmp/verifier-services.log 2>&1 &`)}`,
      { timeoutMs: 60_000 },
    );

    if (!opts?.skipShacl) {
      if (this.pxRoot) await this.uploadLinkmlPack(this.pxRoot);
      else await this.startShaclOnly();
    }
  }

  private async startShaclOnly(): Promise<void> {
    if (!this.sandbox) return;
    const script = readShaclServerScript();
    if (script) {
      const b64 = script.content.toString('base64');
      await this.sandbox.commands.run(
        `mkdir -p ${REMOTE_SHAPES_DIR} && python3 -c "import base64,pathlib; pathlib.Path('${REMOTE_SHACL_SERVER}').write_bytes(base64.b64decode('${b64}'))"`,
        { timeoutMs: 60_000 },
      );
    }
    await this.sandbox.commands.run(
      `python3 -c "import pyshacl,rdflib" 2>/dev/null || pip install --user -q pyshacl rdflib; ` +
        `nohup env SHACL_SHAPES_DIR=${REMOTE_SHAPES_DIR} python3 ${REMOTE_SHACL_SERVER} --port ${SHACL_PORT} --shapes-dir ${REMOTE_SHAPES_DIR} >/tmp/shacl-server.log 2>&1 &`,
      { timeoutMs: 180_000 },
    );
  }

  async ensureServicesReady(timeoutMs = 45_000): Promise<void> {
    if (!this.sandbox) throw new Error('E2B sandbox not created');
    const deadline = Date.now() + timeoutMs;
    const ports = servicePortsFromPack(this.pack);
    while (Date.now() < deadline) {
      const check = [
        ...ports.map((p) => `curl -sf http://127.0.0.1:${p}/health`),
        `curl -sf http://127.0.0.1:${SHACL_PORT}/health`,
      ].join(' && ');
      try {
        const r = await this.sandbox.commands.run(check || 'true', { timeoutMs: 15_000 });
        if ((r.exitCode ?? 1) === 0) return;
      } catch {
        /* retry */
      }
      await new Promise((res) => setTimeout(res, 800));
    }
    throw new Error('E2B services not ready');
  }

  async invoke(backend: VerifierBackend, body: unknown): Promise<VerifierServiceResult> {
    const started = Date.now();
    if (!this.sandbox) throw new Error('E2B sandbox not created');
    const port = SERVICE_PORTS[backend];
    const payload = JSON.stringify(body ?? {});
    const cmd = `curl -sf -X POST http://127.0.0.1:${port}/verify -H 'Content-Type: application/json' -d ${JSON.stringify(payload)}`;
    const r = await this.sandbox.commands.run(cmd, { timeoutMs: 60_000 });
    const stdout = String(r.stdout || '');
    let parsed: { pass?: boolean; detail?: string } = {};
    try {
      parsed = JSON.parse(stdout);
    } catch {
      parsed = { pass: (r.exitCode ?? 1) === 0, detail: stdout.slice(0, 200) };
    }
    return {
      pass: Boolean(parsed.pass),
      detail: parsed.detail || (parsed.pass ? 'Validation accepted' : 'Validation rejected'),
      durationMs: Date.now() - started,
      raw: parsed,
    };
  }

  async uploadLinkmlPack(localRoot?: string): Promise<UploadPackResult> {
    if (!this.sandbox) throw new Error('E2B sandbox not created');
    const root = resolvePxRoot(localRoot || this.pxRoot || undefined);
    if (!root) {
      await this.startShaclOnly();
      return { files: [], remoteRoot: REMOTE_PX_ROOT, shapesDir: REMOTE_SHAPES_DIR };
    }
    this.pxRoot = root;
    hostRegenerateLinkmlArtifacts(root);
    const files = collectPxUploadFiles(root);
    const uploaded: string[] = [];
    await this.sandbox.commands.run(`mkdir -p ${REMOTE_SHAPES_DIR} ${REMOTE_PX_ROOT}/linkml`, {
      timeoutMs: 15_000,
    });
    for (const f of files) {
      const remote = `${REMOTE_PX_ROOT}/${f.remoteRel}`;
      const remoteDir = path.posix.dirname(remote);
      await this.sandbox.commands.run(`mkdir -p ${remoteDir}`, { timeoutMs: 10_000 });
      const buf = fs.readFileSync(f.local);
      if (this.sandbox.files?.write) {
        await this.sandbox.files.write(remote, buf);
      } else {
        const b64 = buf.toString('base64');
        await this.sandbox.commands.run(
          `python3 -c "import base64,pathlib; pathlib.Path('${remote}').write_bytes(base64.b64decode('${b64}'))"`,
          { timeoutMs: 60_000 },
        );
      }
      uploaded.push(f.remoteRel);
    }
    await this.startShaclOnly();
    try {
      await this.sandbox.commands.run(
        `curl -s -X POST http://127.0.0.1:${SHACL_PORT}/reload -H 'Content-Type: application/json' -d '{"rebuild":true}' || true`,
        { timeoutMs: 120_000 },
      );
    } catch {
      /* */
    }
    // Ontology UI: best-effort base64 upload of static viewer + state
    try {
      writeOntologyStateFile(root);
      const assets = readOntologyUiAssets();
      await this.sandbox.commands.run(`mkdir -p ${REMOTE_ONTOLOGY_UI} ${REMOTE_SHAPES_DIR}`, {
        timeoutMs: 15_000,
      });
      for (const a of assets) {
        const remote = a.remoteRel.startsWith('../')
          ? REMOTE_ONTOLOGY_UI_SERVER
          : `${REMOTE_ONTOLOGY_UI}/${a.remoteRel}`;
        const b64 = a.content.toString('base64');
        await this.sandbox.commands.run(
          `python3 -c "import base64,pathlib; pathlib.Path('${remote}').write_bytes(base64.b64decode('${b64}'))"`,
          { timeoutMs: 60_000 },
        );
      }
      const st = path.join(root, 'generated/ontology-state.json');
      if (fs.existsSync(st)) {
        const b64 = fs.readFileSync(st).toString('base64');
        await this.sandbox.commands.run(
          `python3 -c "import base64,pathlib; pathlib.Path('${REMOTE_SHAPES_DIR}/ontology-state.json').write_bytes(base64.b64decode('${b64}'))"`,
          { timeoutMs: 60_000 },
        );
      }
      await this.sandbox.commands.run(
        `nohup python3 ${REMOTE_ONTOLOGY_UI_SERVER} --port ${ONTOLOGY_UI_PORT} --ui-dir ${REMOTE_ONTOLOGY_UI} >/tmp/ontology-ui.log 2>&1 &`,
        { timeoutMs: 20_000 },
      );
    } catch {
      /* optional */
    }
    return { files: uploaded, remoteRoot: REMOTE_PX_ROOT, shapesDir: REMOTE_SHAPES_DIR };
  }

  async invokeShacl(body: {
    data: unknown;
    pack?: string;
    className?: string;
  }): Promise<ShaclRemoteResult> {
    const started = Date.now();
    if (!this.sandbox) throw new Error('E2B sandbox not created');
    const payload = JSON.stringify({
      data: body.data,
      pack: body.pack || 'verifier-fleet',
      className: body.className,
    });
    const cmd = `curl -s -X POST http://127.0.0.1:${SHACL_PORT}/validate -H 'Content-Type: application/json' -d ${JSON.stringify(payload)}`;
    const r = await this.sandbox.commands.run(cmd, { timeoutMs: 60_000 });
    return parseShaclResponse(String(r.stdout || '{}'), started, false);
  }

  async getShaclPreviewUrl(): Promise<ShaclPreviewUrl | null> {
    try {
      if (this.sandbox?.getHost) {
        const host = await this.sandbox.getHost(SHACL_PORT);
        return { url: `https://${host}`, port: SHACL_PORT };
      }
    } catch {
      /* none */
    }
    return null;
  }

  async getOntologyUiPreviewUrl(): Promise<ShaclPreviewUrl | null> {
    try {
      if (this.sandbox?.getHost) {
        const host = await this.sandbox.getHost(ONTOLOGY_UI_PORT);
        return { url: `https://${host}`, port: ONTOLOGY_UI_PORT };
      }
    } catch {
      /* none */
    }
    return null;
  }

  async destroy(): Promise<void> {
    try {
      if (this.sandbox?.kill) await this.sandbox.kill();
      else if (this.sandbox?.close) await this.sandbox.close();
    } catch {
      /* best-effort */
    }
    this.sandbox = null;
  }
}

export async function createPackedSandbox(opts: {
  selected: readonly SelectableVerifier[];
  provider?: SandboxProviderName;
  forceMock?: boolean;
  env?: Record<string, string>;
  pxRoot?: string;
  skipShacl?: boolean;
  /** Customer pack for ontology-state (formal diagram). */
  customerId?: string;
}): Promise<VerificationSandbox> {
  const provider = opts.forceMock ? 'mock' : opts.provider ?? resolveProvider();
  const pack = packVerifiers(opts.selected, provider);
  const live = process.env.VERIFIER_LIVE === '1' || process.env.VERIFIER_LIVE === 'true';
  const createOpts = {
    env: opts.env,
    pxRoot: opts.pxRoot,
    skipShacl: opts.skipShacl,
    customerId: opts.customerId,
  };

  if (provider === 'mock' || opts.forceMock) {
    const box = new MockBox(pack);
    await box.create(createOpts);
    return box;
  }

  if (provider === 'e2b') {
    if (!process.env.E2B_API_KEY) {
      if (live) throw new Error('E2B_API_KEY missing and VERIFIER_LIVE=1');
      const box = new MockBox({ ...pack, provider: 'mock' });
      await box.create(createOpts);
      return box;
    }
    const box = new E2BBox(pack);
    await box.create(createOpts);
    try {
      await box.ensureServicesReady();
    } catch {
      /* invoke may still work after delay */
    }
    return box;
  }

  if (!process.env.DAYTONA_API_KEY) {
    if (live) throw new Error('DAYTONA_API_KEY missing and VERIFIER_LIVE=1');
    const box = new MockBox({ ...pack, provider: 'mock' });
    await box.create(createOpts);
    return box;
  }

  const box = new DaytonaBox(pack);
  await box.create(createOpts);
  try {
    await box.ensureServicesReady();
  } catch {
    /* allow later */
  }
  return box;
}

export { SHACL_PORT, ONTOLOGY_UI_PORT, REMOTE_PX_ROOT, REMOTE_SHAPES_DIR };
