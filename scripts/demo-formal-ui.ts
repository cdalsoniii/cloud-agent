/**
 * Formal (S2) sandbox UI demo: LinkML diagram + verifier-fleet via px_formal_create/ingest.
 *
 *   SCRATCH=... npx tsx scripts/demo-formal-ui.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  formalSurfaceOwnership,
  formalDestroy,
} from '../src/verification-sandbox/formal-stack.js';
import { registrySyncSnapshot, getSandboxType } from '../src/verification-sandbox/types-registry.js';
import {
  handlePxFormalCreate,
  handlePxFormalIngest,
  handlePxFormalPreview,
  handlePxFormalFleetPreview,
  handlePxSandboxCreate,
  handlePxUploadLinkml,
  handlePxSandboxDestroy,
} from '../src/verification-sandbox/handlers.js';
import { callVerificationMcpTool } from '../src/verification-sandbox/mcp-tools.js';

const SCRATCH =
  process.env.SCRATCH ||
  process.env.GOAL_SCRATCH ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../.gsd/evidence/formal-ui-scratch');

function wj(name: string, data: unknown) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const p = path.join(SCRATCH, name);
  fs.writeFileSync(p, JSON.stringify(data, null, 2));
  return p;
}
function wt(name: string, text: string) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const p = path.join(SCRATCH, name);
  fs.writeFileSync(p, text);
  return p;
}

async function runOnce(label: string) {
  const ownership = formalSurfaceOwnership();
  wj('formal-role-registry.json', {
    ...registrySyncSnapshot(),
    ownership,
    formal: getSandboxType('formal'),
    editor: getSandboxType('editor'),
  });

  // Prefer non-colliding ports for parallel smokes
  const base = label === '1' ? 17205 : 17305;
  formalDestroy();

  // Production formal create/ingest path (not startFormalStack-only)
  const created = await handlePxFormalCreate({
    customerId: process.env.CUSTOMER_ID || 'acme-fleet',
    ontologyPort: base,
    fleetPort: base + 1,
    assistantUiOrigin: process.env.ASSISTANT_UI_URL || 'http://127.0.0.1:3010',
  });
  if (!created.ok) {
    throw new Error(`px_formal_create failed: ${JSON.stringify(created)}`);
  }
  wj(label === '1' ? 'formal-create.json' : `formal-create-${label}.json`, created);

  const ingested = await handlePxFormalIngest({
    customerId: process.env.CUSTOMER_ID || 'acme-fleet',
    ontologyPort: base,
    fleetPort: base + 1,
  });
  if (!ingested.ok) {
    throw new Error(`px_formal_ingest failed: ${JSON.stringify(ingested)}`);
  }
  wj(label === '1' ? 'formal-ingest.json' : `formal-ingest-${label}.json`, ingested);

  const urls = created.urls as {
    ontology: string;
    fleet: string;
    ontologyHealth: string;
    ontologyState: string;
  };
  const ontologyPort = (created.ports as { ontology: number }).ontology;
  const fleetPort = (created.ports as { fleet: number }).fleet;

  try {
    const h = await fetch(urls.ontologyHealth);
    const health = await h.json();
    const stRes = await fetch(urls.ontologyState || `http://127.0.0.1:${ontologyPort}/api/ontology/state`);
    const state = await stRes.json();
    if (label === '1') {
      wj('formal-viewer-health.json', health);
      wj('formal-viewer-state.json', state);
    } else {
      wj(`formal-viewer-health-${label}.json`, health);
      wj(`formal-viewer-state-${label}.json`, state);
    }

    const nodes = state.reactFlow?.nodes?.length || 0;
    if (!health.ok || nodes < 1) {
      throw new Error(`viewer fail ok=${health.ok} nodes=${nodes}`);
    }

    const fleet = await fetch(`http://127.0.0.1:${fleetPort}/`);
    const fleetBody = await fleet.text();
    wt(
      label === '1' ? 'verifier-fleet.headers.txt' : `verifier-fleet-${label}.headers.txt`,
      `URL http://127.0.0.1:${fleetPort}/\nHTTP ${fleet.status}\nX-Formal-Sandbox-Role: ${fleet.headers.get('x-formal-sandbox-role')}\nlen=${fleetBody.length}\n`,
    );
    wt(
      label === '1' ? 'verifier-fleet.body.txt' : `verifier-fleet-${label}.body.txt`,
      fleetBody.slice(0, 4000),
    );
    if (fleet.status !== 200 || !/verifier-fleet|react-flow|formal/i.test(fleetBody)) {
      throw new Error(`fleet page fail status=${fleet.status}`);
    }
    wt(
      'verifier-fleet-bar.txt',
      'formal-native fleet UI on FLEET_UI_PORT under role=formal via px_formal_create/ingest; optional /proxy/verifier-fleet to host Next\n',
    );

    const ontologyMint = await handlePxFormalPreview({ app: 'ontology' });
    const fleetMint = await handlePxFormalFleetPreview({});
    wj(label === '1' ? 'formal-preview-mint.json' : `formal-preview-mint-${label}.json`, {
      ontology: ontologyMint,
      fleet: fleetMint,
    });

    // MCP tool path
    const mcpCreate = await callVerificationMcpTool('px_sandbox_types', {});
    wj(`mcp-types-${label}.json`, mcpCreate);

    // Host Next still available as formal-backed companion
    const hostFleet = await fetch(
      (process.env.ASSISTANT_UI_URL || 'http://127.0.0.1:3010').replace(/\/$/, '') + '/verifier-fleet',
    ).catch(() => null);
    if (hostFleet) {
      wt(
        'host-verifier-fleet.headers.txt',
        `HTTP ${hostFleet.status} formal-backed companion Next\n`,
      );
    }

    // Optional legacy packed mock path (does not replace formal create)
    await handlePxSandboxCreate({ forceMock: true });
    await handlePxUploadLinkml({});
    await handlePxSandboxDestroy();

    if (process.env.DAYTONA_API_KEY) {
      try {
        await handlePxSandboxCreate({ forceMock: false });
        await handlePxUploadLinkml({});
        await handlePxSandboxDestroy();
        wt('daytona-launch.txt', 'DAYTONA packed create attempted (formal UI still from formal-create path)\n');
      } catch (e) {
        wt('daytona-launch.txt', e instanceof Error ? e.stack || e.message : String(e));
      }
    } else {
      wt('daytona-launch.txt', 'DAYTONA_API_KEY unset; formal-equivalent via px_formal_create/ingest\n');
    }

    const openUrls = [
      urls.ontology,
      urls.fleet,
      (ontologyMint.preview as { url?: string })?.url || '',
      (fleetMint.preview as { url?: string })?.url || '',
      (process.env.ASSISTANT_UI_URL || 'http://127.0.0.1:3010') + '/verifier-fleet',
    ]
      .filter(Boolean)
      .join('\n');
    wt('open-urls.txt', openUrls + '\n');

    console.log(`RUN ${label} PASS`, {
      ontology: urls.ontology,
      fleet: urls.fleet,
      nodes,
      customer: created.customerId,
      path: 'px_formal_create+ingest',
    });
    return { created, nodes, ontologyPort, fleetPort };
  } finally {
    formalDestroy();
  }
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const r1 = await runOnce('1');
  fs.writeFileSync(
    path.join(SCRATCH, 'formal-ui-smoke-1.log'),
    `formal-ui-smoke-1 PASS nodes=${r1.nodes} customer=${r1.created.customerId} path=px_formal_create+ingest\n`,
  );

  const r2 = await runOnce('2');
  fs.writeFileSync(
    path.join(SCRATCH, 'formal-ui-smoke-2.log'),
    `formal-ui-smoke-2 PASS nodes=${r2.nodes} customer=${r2.created.customerId} path=px_formal_create+ingest\n`,
  );

  wj('demo-summary.json', {
    pass: true,
    role: 'formal',
    path: 'px_formal_create+px_formal_ingest',
    ontologyPort: r1.ontologyPort,
    fleetPort: r1.fleetPort,
    customerId: r1.created.customerId,
    urls: (r1.created as { urls: unknown }).urls,
    scratch: SCRATCH,
  });

  console.log('DEMO FORMAL UI RESULT PASS');
  console.log('SCRATCH', SCRATCH);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  try {
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(
      path.join(SCRATCH, 'demo-fatal.txt'),
      e instanceof Error ? e.stack || e.message : String(e),
    );
  } catch {
    /* */
  }
  process.exit(1);
});
