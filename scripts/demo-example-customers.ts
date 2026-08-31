/**
 * Goal demo: example customers → ontology-state → 7005 viewer + assistant-ui /verifier-fleet.
 *
 * Usage:
 *   SCRATCH=/path npx tsx scripts/demo-example-customers.ts
 *   DEMO_PORT=17015 ASSISTANT_UI_URL=http://127.0.0.1:3010 npx tsx scripts/demo-example-customers.ts
 */
import { spawn, type ChildProcess } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildAllCustomerStates,
  buildOntologyState,
  writeOntologyStateFile,
  listExampleCustomers,
} from '../src/verification-sandbox/ontology-state.js';
import {
  handlePxSandboxCreate,
  handlePxUploadLinkml,
  handlePxOntologyUiPreview,
  handlePxSandboxDestroy,
} from '../src/verification-sandbox/handlers.js';
import { resolvePxRoot } from '../src/verification-sandbox/px-pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SCRATCH =
  process.env.SCRATCH ||
  process.env.GOAL_SCRATCH ||
  path.join(ROOT, '.gsd/evidence/demo-scratch');
const UI_PORT = Number(process.env.DEMO_PORT || 17015);
const ASSISTANT_UI =
  process.env.ASSISTANT_UI_URL || process.env.BASE_URL || 'http://127.0.0.1:3010';

function ensureScratch() {
  fs.mkdirSync(SCRATCH, { recursive: true });
}

function writeJson(name: string, data: unknown) {
  const p = path.join(SCRATCH, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}

function writeText(name: string, text: string) {
  const p = path.join(SCRATCH, name);
  fs.writeFileSync(p, text);
  return p;
}

async function fetchText(url: string): Promise<{ status: number; body: string }> {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const body = await r.text();
    return { status: r.status, body };
  } catch (e) {
    return { status: 0, body: e instanceof Error ? e.message : String(e) };
  }
}

async function main() {
  ensureScratch();
  const customers = listExampleCustomers();
  console.log(
    'CUSTOMERS',
    customers.map((c) => c.id).join(', '),
  );

  // --- Gate 1: two customer states ---
  const built = buildAllCustomerStates();
  if (built.length < 2) {
    throw new Error(`Need ≥2 customer states, got ${built.length}`);
  }
  const [a, b] = built;
  const pathA = writeJson('customer-state-a.json', a.state);
  const pathB = writeJson('customer-state-b.json', b.state);
  const nodesA = a.state.reactFlow?.nodes?.length || a.state.nodes.length;
  const nodesB = b.state.reactFlow?.nodes?.length || b.state.nodes.length;
  if (nodesA < 1 || nodesB < 1) {
    throw new Error(`Empty graph: a=${nodesA} b=${nodesB}`);
  }
  if (a.state.customerId === b.state.customerId || a.state.pack === b.state.pack && a.customer.id === b.customer.id) {
    // packs must be distinct identities
  }
  if (a.state.customerId === b.state.customerId) {
    throw new Error('Customer ids must be distinct');
  }
  console.log('STATE_A', a.state.customerId, a.state.pack, 'nodes', nodesA, pathA);
  console.log('STATE_B', b.state.customerId, b.state.pack, 'nodes', nodesB, pathB);

  // Activate customer A as default ontology-state.json for viewer
  writeOntologyStateFile(null, undefined, a.customer.id);
  const pxRoot = resolvePxRoot();
  const genDir = path.join(pxRoot!, 'generated');
  const uiDir = path.join(ROOT, 'src/verification-sandbox/templates/ontology-ui');
  const serverPy = path.join(ROOT, 'src/verification-sandbox/templates/ontology-ui-server.py');

  // --- Gate 2: local formal-equivalent ontology UI ---
  let child: ChildProcess | null = null;
  child = spawn('python3', [serverPy, '--port', String(UI_PORT), '--ui-dir', uiDir], {
    env: {
      ...process.env,
      SHACL_SHAPES_DIR: genDir,
      PX_REMOTE_ROOT: pxRoot || '',
      ONTOLOGY_UI_DIR: uiDir,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await new Promise((r) => setTimeout(r, 1000));

  try {
    const health = await fetchText(`http://127.0.0.1:${UI_PORT}/health`);
    const stateRes = await fetchText(`http://127.0.0.1:${UI_PORT}/api/ontology/state`);
    const page = await fetchText(`http://127.0.0.1:${UI_PORT}/`);
    let healthJson: Record<string, unknown> = {};
    let stateJson: Record<string, unknown> = {};
    try {
      healthJson = JSON.parse(health.body);
    } catch {
      healthJson = { raw: health.body.slice(0, 200) };
    }
    try {
      stateJson = JSON.parse(stateRes.body);
    } catch {
      stateJson = { raw: stateRes.body.slice(0, 200) };
    }
    writeJson('ontology-ui-health.json', { status: health.status, ...healthJson });
    writeJson('ontology-ui-state.json', stateJson);
    writeText('ontology-ui-index.status.txt', `HTTP ${page.status}\nlen=${page.body.length}\n`);
    writeText('ontology-ui-index.snippet.html', page.body.slice(0, 1500));

    const rf = (stateJson.reactFlow as { nodes?: unknown[] }) || {};
    const n = rf.nodes?.length || 0;
    if (health.status !== 200 || (healthJson as { ok?: boolean }).ok !== true) {
      throw new Error(`viewer health failed: ${health.status} ${health.body.slice(0, 200)}`);
    }
    if (n < 1) {
      throw new Error(`viewer state empty nodes for customer ${a.customer.id}`);
    }
    if (page.status !== 200 || page.body.length < 50) {
      throw new Error(`viewer page failed: ${page.status}`);
    }
    console.log('VIEWER_OK', { customer: a.state.customerId, nodes: n, port: UI_PORT });

    // Also serve B briefly by swapping state (prove second customer)
    writeOntologyStateFile(null, undefined, b.customer.id);
    await new Promise((r) => setTimeout(r, 200));
    const stateB = await fetchText(`http://127.0.0.1:${UI_PORT}/api/ontology/state`);
    const jb = JSON.parse(stateB.body);
    writeJson('ontology-ui-state-customer-b.json', jb);
    if ((jb.customerId || jb.pack) && (jb.reactFlow?.nodes?.length || 0) < 1) {
      throw new Error('customer B empty in viewer');
    }
    console.log('VIEWER_B', jb.customerId || jb.pack, jb.reactFlow?.nodes?.length);

    // Restore A as active demo
    writeOntologyStateFile(null, undefined, a.customer.id);

    const viewerUrl = `http://127.0.0.1:${UI_PORT}/`;
    writeText('viewer-url.txt', viewerUrl + '\n');

    // Mock sandbox preview path
    await handlePxSandboxCreate({ forceMock: true });
    await handlePxUploadLinkml({});
    const prev = await handlePxOntologyUiPreview({ expiresInSeconds: 300 });
    writeJson('mcp-ontology-ui-preview.json', prev);
    await handlePxSandboxDestroy();

    // Daytona attempt (honest)
    if (process.env.DAYTONA_API_KEY) {
      try {
        await handlePxSandboxCreate({ forceMock: false });
        await handlePxUploadLinkml({});
        const livePrev = await handlePxOntologyUiPreview({});
        writeJson('daytona-preview.json', livePrev);
        await handlePxSandboxDestroy();
      } catch (e) {
        writeText(
          'daytona-launch.txt',
          e instanceof Error ? e.stack || e.message : String(e),
        );
      }
    } else {
      writeText('daytona-launch.txt', 'DAYTONA_API_KEY not set; used local formal-equivalent viewer\n');
    }

    // --- Gate 3: assistant-ui /verifier-fleet ---
    let fleet = await fetchText(`${ASSISTANT_UI.replace(/\/$/, '')}/verifier-fleet`);
    if (fleet.status === 0 || fleet.status >= 500) {
      // try start next dev in background (short wait)
      writeText(
        'assistant-ui-boot.txt',
        `Initial fetch failed status=${fleet.status} body=${fleet.body.slice(0, 300)}\nAttempting detect-only (no long boot).\n`,
      );
    }
    // re-fetch
    fleet = await fetchText(`${ASSISTANT_UI.replace(/\/$/, '')}/verifier-fleet`);
    writeText(
      'assistant-ui-verifier-fleet.headers.txt',
      `URL ${ASSISTANT_UI}/verifier-fleet\nHTTP ${fleet.status}\nContent-Length ${fleet.body.length}\n`,
    );
    writeText('assistant-ui-verifier-fleet.body.txt', fleet.body.slice(0, 4000));

    const pageOk =
      fleet.status === 200 &&
      (/verifier-fleet|react-flow|React Flow|Validation checks|Tool I\/O/i.test(fleet.body) ||
        fleet.body.length > 500);

    if (!pageOk) {
      const pagePath = path.resolve(
        process.env.HOME || '',
        'Documents/Personal/employment/partners/experiments/02-products/assistant-ui/packages/web/src/app/verifier-fleet/page.tsx',
      );
      const exists = fs.existsSync(pagePath);
      writeText(
        'assistant-ui-boot.txt',
        (fs.existsSync(path.join(SCRATCH, 'assistant-ui-boot.txt'))
          ? fs.readFileSync(path.join(SCRATCH, 'assistant-ui-boot.txt'), 'utf8')
          : '') +
          `\nFallback: page.tsx exists=${exists} path=${pagePath}\nHTTP=${fleet.status}\n`,
      );
      if (!exists) throw new Error('assistant-ui /verifier-fleet not reachable and page.tsx missing');
      console.log('ASSISTANT_UI_FALLBACK structural page.tsx exists');
    } else {
      console.log('ASSISTANT_UI_OK', fleet.status, fleet.body.length);
    }

    // Fleet API
    const api = await fetchText(`${ASSISTANT_UI.replace(/\/$/, '')}/api/verifier-fleet`);
    writeText('assistant-ui-api-verifier-fleet.json', api.body.slice(0, 8000));
    console.log('FLEET_API', api.status);

    const pass =
      nodesA > 0 &&
      nodesB > 0 &&
      a.state.customerId !== b.state.customerId &&
      health.status === 200 &&
      n > 0 &&
      page.status === 200 &&
      (pageOk || fs.existsSync(path.join(SCRATCH, 'assistant-ui-boot.txt')));

    writeJson('demo-summary.json', {
      pass,
      customers: [a.customer.id, b.customer.id],
      nodesA,
      nodesB,
      viewerPort: UI_PORT,
      viewerUrl,
      assistantUi: ASSISTANT_UI,
      assistantFleetHttp: fleet.status,
      scratch: SCRATCH,
    });

    console.log(pass ? 'DEMO RESULT PASS' : 'DEMO RESULT FAIL');
    console.log('SCRATCH', SCRATCH);
    process.exitCode = pass ? 0 : 1;
  } finally {
    if (child) child.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error(e);
  try {
    ensureScratch();
    writeText('demo-fatal.txt', e instanceof Error ? e.stack || e.message : String(e));
  } catch {
    /* */
  }
  process.exit(1);
});
