/**
 * Formal (S2) sandbox UI stack — 2nd lifecycle stage.
 * Serves LinkML diagram viewer + verifier-fleet surface under formal role ownership.
 *
 * Local formal-equivalent: host processes bound to formal ports with role=formal.
 * Live: Daytona formal sandbox + signed previews for those ports.
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { FLEET_UI_PORT, ONTOLOGY_UI_PORT, SHACL_PORT } from './types.js';
import {
  assertFormalOwnsDiagramAndFleet,
  assertNoPublicEditorDomains,
  getSandboxType,
  mintPreviewUrl,
  type SandboxRole,
} from './types-registry.js';
import { writeOntologyStateFile, buildOntologyState } from './ontology-state.js';
import { resolvePxRoot } from './px-pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface FormalStackHandle {
  role: 'formal';
  ontologyPort: number;
  fleetPort: number;
  shaclPort: number;
  ontologyUrl: string;
  fleetUrl: string;
  customerId: string;
  pack: string;
  stop: () => void;
  /** formal-role mint metadata */
  previews: {
    ontology: ReturnType<typeof mintPreviewUrl>;
    fleet: ReturnType<typeof mintPreviewUrl>;
  };
}

export interface StartFormalStackOpts {
  customerId?: string;
  ontologyPort?: number;
  fleetPort?: number;
  /** Host Next origin for reverse-proxy of /verifier-fleet (formal-backed) */
  assistantUiOrigin?: string;
  pxRoot?: string;
}

/**
 * Pure helper: formal role must own diagram+fleet; editor must not.
 * Used by unit tests and startFormalStack.
 */
export function formalSurfaceOwnership() {
  assertNoPublicEditorDomains();
  assertFormalOwnsDiagramAndFleet();
  const formal = getSandboxType('formal');
  return {
    role: formal.role as SandboxRole,
    ports: formal.ports,
    surfaces: formal.domains.map((d) => d.surface),
    ontologyPort: ONTOLOGY_UI_PORT,
    fleetPort: FLEET_UI_PORT,
    shaclPort: SHACL_PORT,
    editorPublicApps: getSandboxType('editor').domains.filter((d) => d.public).map((d) => d.app),
  };
}

function fleetHtml(opts: {
  customerId: string;
  pack: string;
  ontologyStateUrl: string;
  assistantUiOrigin?: string;
  formalRole: string;
}): string {
  const proxyNote = opts.assistantUiOrigin
    ? `Formal reverse-proxy target: ${opts.assistantUiOrigin}/verifier-fleet`
    : 'Formal-native fleet diagram (ontology-state verifiers)';
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Verifier Fleet — formal sandbox</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reactflow@11.11.4/dist/style.css" />
  <style>
    body { margin:0; font-family: system-ui,sans-serif; background:#0b1220; color:#e5e7eb; height:100vh; display:flex; flex-direction:column; }
    header { padding:12px 16px; border-bottom:1px solid #1f2937; background:#111827; display:flex; justify-content:space-between; align-items:center; }
    h1 { font-size:16px; margin:0; }
    .badge { font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(99,102,241,.2); color:#a5b4fc; }
    #flow { flex:1; }
    .react-flow__node { font-size:11px; padding:8px; border-radius:8px; border:1px solid #334155; background:#1e293b; color:#e2e8f0; min-width:100px; }
    a { color:#a5b4fc; }
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Verifier Fleet <span style="opacity:.6">/verifier-fleet</span></h1>
      <div style="font-size:12px;color:#9ca3af">formal sandbox (S2) · customer ${opts.customerId} · pack ${opts.pack}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="badge">role=${opts.formalRole}</span>
      <span class="badge">react-flow</span>
      <a href="/" id="link-ontology">Ontology diagram</a>
    </div>
  </header>
  <div id="flow" class="react-flow" data-surface="verifier-fleet" data-formal-role="formal"></div>
  <script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reactflow@11.11.4/dist/umd/index.js"></script>
  <script>
    const STATE_URL = ${JSON.stringify(opts.ontologyStateUrl)};
    const ASSISTANT = ${JSON.stringify(opts.assistantUiOrigin || '')};
    const RF = window.ReactFlow;
    const ReactFlow = RF.default || RF;
    const { Background, Controls } = RF;
    async function main() {
      const st = await fetch(STATE_URL).then(r => r.json());
      const verifiers = (st.nodes || []).filter(n => n.type === 'verifier');
      const rf = st.reactFlow || { nodes: [], edges: [] };
      // Prefer verifier nodes from full graph
      let nodes = (rf.nodes || []).filter(n => (n.data && n.data.label) || n.id);
      if (!nodes.length) {
        nodes = [{ id: 'fleet-root', type: 'input', position: { x: 40, y: 40 }, data: { label: 'Validation checks', detail: st.customerId } }];
      }
      const edges = rf.edges || [];
      const root = ReactDOM.createRoot(document.getElementById('flow'));
      function App() {
        return React.createElement(ReactFlow, {
          nodes: nodes.map(n => ({ ...n, data: { ...(n.data||{}), label: (n.data&&n.data.label)||n.id } })),
          edges,
          fitView: true,
          proOptions: { hideAttribution: true },
        }, React.createElement(Background, { color: '#1f2937' }), React.createElement(Controls));
      }
      root.render(React.createElement(App));
      if (ASSISTANT) {
        const a = document.createElement('div');
        a.style.cssText = 'padding:8px 16px;font-size:12px;border-top:1px solid #1f2937';
        a.innerHTML = 'Formal-backed · also open host Next: <a href="'+ASSISTANT+'/verifier-fleet">'+ASSISTANT+'/verifier-fleet</a> · ${proxyNote.replace(/'/g, '')}';
        document.body.appendChild(a);
      }
    }
    main().catch(e => { document.getElementById('flow').textContent = String(e); });
  </script>
</body>
</html>`;
}

/**
 * Start formal-equivalent UI stack (diagram on ontologyPort, fleet on fleetPort).
 * Uses shipped registry ownership rules.
 */
export async function startFormalStack(opts: StartFormalStackOpts = {}): Promise<FormalStackHandle> {
  formalSurfaceOwnership();

  const customerId = opts.customerId || 'acme-fleet';
  const ontologyPort = opts.ontologyPort ?? ONTOLOGY_UI_PORT;
  const fleetPort = opts.fleetPort ?? FLEET_UI_PORT;
  const assistantUiOrigin = (opts.assistantUiOrigin || process.env.ASSISTANT_UI_URL || 'http://127.0.0.1:3010').replace(
    /\/$/,
    '',
  );

  const statePath = writeOntologyStateFile(opts.pxRoot, undefined, customerId);
  const state = buildOntologyState(opts.pxRoot, customerId);
  if (!state || (state.reactFlow?.nodes?.length || 0) < 1) {
    throw new Error(`formal stack: empty ontology state for ${customerId}`);
  }

  const pxRoot = resolvePxRoot(opts.pxRoot);
  const genDir = path.join(pxRoot!, 'generated');
  const uiDir = path.join(__dirname, 'templates/ontology-ui');
  const serverPy = path.join(__dirname, 'templates/ontology-ui-server.py');

  const children: ChildProcess[] = [];

  // Ontology diagram (formal 7005)
  const ont = spawn('python3', [serverPy, '--port', String(ontologyPort), '--ui-dir', uiDir], {
    env: {
      ...process.env,
      SHACL_SHAPES_DIR: genDir,
      PX_REMOTE_ROOT: pxRoot || '',
      ONTOLOGY_UI_DIR: uiDir,
      SANDBOX_ROLE: 'formal',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(ont);

  // Fleet UI (formal 7006) — formal-native page + optional proxy marker to host Next
  const fleetServer = http.createServer(async (req, res) => {
    const url = req.url || '/';
    if (url.startsWith('/health')) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          service: 'formal-fleet-ui',
          role: 'formal',
          port: fleetPort,
          customerId: state.customerId,
          pack: state.pack,
          surfaces: ['fleet_ui', 'verifier-fleet'],
        }),
      );
      return;
    }
    // Proxy Next fleet page when requested
    if (url.startsWith('/proxy/verifier-fleet')) {
      try {
        const r = await fetch(`${assistantUiOrigin}/verifier-fleet`);
        const body = await r.text();
        res.writeHead(r.status, {
          'Content-Type': 'text/html; charset=utf-8',
          'X-Formal-Sandbox-Role': 'formal',
          'X-Formal-Backed': '1',
        });
        res.end(body);
      } catch (e) {
        res.writeHead(502, { 'Content-Type': 'text/plain' });
        res.end(`formal proxy to ${assistantUiOrigin}/verifier-fleet failed: ${e}`);
      }
      return;
    }
    if (url.startsWith('/api/ontology/state')) {
      res.writeHead(200, { 'Content-Type': 'application/json', 'X-Formal-Sandbox-Role': 'formal' });
      res.end(JSON.stringify(state));
      return;
    }
    // Default: formal verifier-fleet React Flow page
    const html = fleetHtml({
      customerId: state.customerId,
      pack: state.pack,
      ontologyStateUrl: `http://127.0.0.1:${ontologyPort}/api/ontology/state`,
      assistantUiOrigin,
      formalRole: 'formal',
    });
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'X-Formal-Sandbox-Role': 'formal',
      'X-Formal-Backed': '1',
    });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    fleetServer.once('error', reject);
    fleetServer.listen(fleetPort, '0.0.0.0', () => resolve());
  });

  // Wait for ontology diagram server health (real path, not blind sleep only)
  const ontologyUrl = `http://127.0.0.1:${ontologyPort}/`;
  const healthUrl = `http://127.0.0.1:${ontologyPort}/health`;
  let ready = false;
  let lastErr = '';
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(healthUrl);
      if (r.ok) {
        const j = (await r.json()) as { ok?: boolean };
        if (j.ok) {
          ready = true;
          break;
        }
      }
    } catch (e) {
      lastErr = e instanceof Error ? e.message : String(e);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) {
    for (const c of children) {
      try {
        c.kill('SIGTERM');
      } catch {
        /* */
      }
    }
    try {
      fleetServer.close();
    } catch {
      /* */
    }
    throw new Error(
      `formal stack: ontology viewer on :${ontologyPort} did not become healthy (${lastErr || 'timeout'})`,
    );
  }

  const ontologyPreview = mintPreviewUrl({
    role: 'formal',
    app: 'ontology',
    localhostFallback: true,
    sessionId: `formal-local-${ontologyPort}`,
  });
  const fleetPreview = mintPreviewUrl({
    role: 'formal',
    app: 'fleet',
    localhostFallback: true,
    sessionId: `formal-local-${fleetPort}`,
  });

  return {
    role: 'formal',
    ontologyPort,
    fleetPort,
    shaclPort: SHACL_PORT,
    ontologyUrl,
    fleetUrl: `http://127.0.0.1:${fleetPort}/`,
    customerId: state.customerId,
    pack: state.pack,
    previews: { ontology: ontologyPreview, fleet: fleetPreview },
    stop: () => {
      for (const c of children) {
        try {
          c.kill('SIGTERM');
        } catch {
          /* */
        }
      }
      try {
        fleetServer.close();
      } catch {
        /* */
      }
    },
  };
}

/** Session-scoped formal stack (create/ingest path). */
let activeFormal: FormalStackHandle | null = null;

export function getActiveFormalStack(): FormalStackHandle | null {
  return activeFormal;
}

/**
 * Formal create: start formal-role stack (diagram + fleet) for a customer pack.
 * Production path for px_formal_create — local formal-equivalent when Daytona unavailable.
 */
export async function formalCreate(opts: StartFormalStackOpts = {}): Promise<FormalStackHandle> {
  if (activeFormal) {
    try {
      activeFormal.stop();
    } catch {
      /* replace */
    }
    activeFormal = null;
  }
  activeFormal = await startFormalStack(opts);
  return activeFormal;
}

/**
 * Formal ingest: rebuild pack state into the active formal stack (restart with customer).
 * Production path for px_formal_ingest.
 */
export async function formalIngest(opts: {
  customerId?: string;
  pxRoot?: string;
  ontologyPort?: number;
  fleetPort?: number;
  assistantUiOrigin?: string;
}): Promise<FormalStackHandle> {
  const prev = activeFormal;
  const ontologyPort = opts.ontologyPort ?? prev?.ontologyPort;
  const fleetPort = opts.fleetPort ?? prev?.fleetPort;
  if (prev) {
    try {
      prev.stop();
    } catch {
      /* */
    }
    activeFormal = null;
    // brief release so ports free
    await new Promise((r) => setTimeout(r, 150));
  }
  activeFormal = await startFormalStack({
    customerId: opts.customerId || prev?.customerId || 'acme-fleet',
    pxRoot: opts.pxRoot,
    ontologyPort,
    fleetPort,
    assistantUiOrigin: opts.assistantUiOrigin,
  });
  return activeFormal;
}

export function formalDestroy(): { ok: true; destroyed: boolean; customerId?: string } {
  if (!activeFormal) {
    return { ok: true, destroyed: false };
  }
  const customerId = activeFormal.customerId;
  try {
    activeFormal.stop();
  } finally {
    activeFormal = null;
  }
  return { ok: true, destroyed: true, customerId };
}
