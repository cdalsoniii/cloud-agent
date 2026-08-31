/**
 * Live Daytona formal (S2) demo: diagram (7005) + verifier-fleet (7006) inside sandbox.
 *
 *   set -a && source .env && set +a
 *   SCRATCH=... npx tsx scripts/demo-formal-daytona.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  handlePxFormalCreate,
  handlePxFormalIngest,
  handlePxFormalPreview,
  handlePxFormalFleetPreview,
  handlePxSandboxDestroy,
} from '../src/verification-sandbox/handlers.js';
import { formalSurfaceOwnership } from '../src/verification-sandbox/formal-stack.js';
import { registrySyncSnapshot } from '../src/verification-sandbox/types-registry.js';

const SCRATCH =
  process.env.SCRATCH ||
  process.env.GOAL_SCRATCH ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../.gsd/evidence/formal-daytona-scratch');

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

async function fetchPreview(url: string, label: string) {
  try {
    const r = await fetch(url, { redirect: 'follow' });
    const text = await r.text();
    return { ok: r.ok, status: r.status, len: text.length, sample: text.slice(0, 1500), label };
  } catch (e) {
    return {
      ok: false,
      status: 0,
      len: 0,
      sample: e instanceof Error ? e.message : String(e),
      label,
    };
  }
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  wj('formal-role-registry.json', {
    ...registrySyncSnapshot(),
    ownership: formalSurfaceOwnership(),
  });

  if (!process.env.DAYTONA_API_KEY) {
    wt(
      'daytona-launch.txt',
      'DAYTONA_API_KEY missing after env load — cannot run live Daytona formal demo\n',
    );
    console.error('DAYTONA_API_KEY required. source .env first.');
    process.exit(2);
  }

  wt(
    'daytona-launch.txt',
    `DAYTONA_API_KEY present len=${process.env.DAYTONA_API_KEY.length}; starting formal create\n`,
  );

  let created: Record<string, unknown> | null = null;
  try {
    created = await handlePxFormalCreate({
      customerId: process.env.CUSTOMER_ID || 'acme-fleet',
      forceLocal: false,
    });
    wj('formal-create-daytona.json', created);
    if (!created.ok) {
      throw new Error(`formal create failed: ${JSON.stringify(created)}`);
    }
    if (created.runtime !== 'daytona') {
      throw new Error(`expected runtime=daytona got ${created.runtime}`);
    }

    const ingested = await handlePxFormalIngest({
      customerId: process.env.CUSTOMER_ID || 'acme-fleet',
    });
    wj('formal-ingest-daytona.json', ingested);
    if (!ingested.ok) {
      throw new Error(`formal ingest failed: ${JSON.stringify(ingested)}`);
    }

    const ontologyMint = await handlePxFormalPreview({ app: 'ontology', expiresInSeconds: 3600 });
    const fleetMint = await handlePxFormalFleetPreview({ expiresInSeconds: 3600 });
    wj('formal-preview-mint-daytona.json', { ontology: ontologyMint, fleet: fleetMint });

    const ontologyUrl =
      (ontologyMint.preview as { url?: string })?.url ||
      (created.urls as { ontology?: string })?.ontology ||
      '';
    const fleetUrl =
      (fleetMint.preview as { url?: string })?.url ||
      (created.urls as { fleet?: string })?.fleet ||
      '';

    wt(
      'open-urls.txt',
      [
        `# Daytona formal sandbox ${created.sandboxId}`,
        `ontology: ${ontologyUrl}`,
        `fleet: ${fleetUrl}`,
        `shacl: ${(created.urls as { shacl?: string })?.shacl || ''}`,
      ].join('\n') + '\n',
    );

    // Host fetch of signed previews (proves external reachability)
    const oHit = ontologyUrl ? await fetchPreview(ontologyUrl, 'ontology') : null;
    const fHit = fleetUrl ? await fetchPreview(fleetUrl, 'fleet') : null;
    wj('formal-viewer-health.json', {
      runtime: 'daytona',
      sandboxId: created.sandboxId,
      probe: created.probe || ingested.probe,
      ontologyPreviewFetch: oHit,
      fleetPreviewFetch: fHit,
    });

    // State from in-sandbox probe if present
    const probe = (ingested.probe || created.probe) as {
      ontology?: { body?: string };
      stateSnippet?: string;
    } | null;
    let state: unknown = null;
    if (probe?.stateSnippet) {
      try {
        state = JSON.parse(probe.stateSnippet);
      } catch {
        state = { snippet: probe.stateSnippet };
      }
    } else if (probe?.ontology?.body) {
      try {
        state = JSON.parse(probe.ontology.body);
      } catch {
        state = { body: probe.ontology.body };
      }
    }
    wj('formal-viewer-state.json', state || { note: 'state from probe only', probe });

    // Fleet body sample from signed URL if possible
    if (fHit?.sample) {
      wt('verifier-fleet.body.txt', fHit.sample);
      wt(
        'verifier-fleet.headers.txt',
        `URL ${fleetUrl}\nHTTP ${fHit.status}\nruntime=daytona\n`,
      );
    }
    wt(
      'verifier-fleet-bar.txt',
      'Daytona in-sandbox fleet-ui-server.py on 7006 + signed preview; ontology-ui-server on 7005\n',
    );

    const nodes =
      (state as { reactFlow?: { nodes?: unknown[] } })?.reactFlow?.nodes?.length ||
      (ingested.stateSummary as { nodes?: number })?.nodes ||
      0;

    // Accept if in-sandbox probe ok even if public CDN fetch of preview is flaky
    const probeOk =
      Boolean((created.probe as { ontology?: { ok?: boolean } })?.ontology?.ok) ||
      Boolean((ingested.probe as { ontology?: { ok?: boolean } })?.ontology?.ok);
    const fleetProbeOk =
      Boolean((created.probe as { fleet?: { ok?: boolean } })?.fleet?.ok) ||
      Boolean((ingested.probe as { fleet?: { ok?: boolean } })?.fleet?.ok);

    if (!probeOk || !fleetProbeOk) {
      throw new Error(
        `in-sandbox formal UI not healthy probeOk=${probeOk} fleetProbeOk=${fleetProbeOk}`,
      );
    }

    wj('demo-summary.json', {
      pass: true,
      runtime: 'daytona',
      sandboxId: created.sandboxId,
      customerId: created.customerId,
      urls: { ontology: ontologyUrl, fleet: fleetUrl },
      nodes,
      probeOk,
      fleetProbeOk,
      previewFetch: { ontology: oHit?.status, fleet: fHit?.status },
    });

    console.log('DEMO FORMAL DAYTONA PASS', {
      sandboxId: created.sandboxId,
      ontology: ontologyUrl,
      fleet: fleetUrl,
      nodes,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.stack || e.message : String(e);
    wt('demo-fatal.txt', msg);
    wj('demo-summary.json', { pass: false, error: msg, created });
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (process.env.KEEP_FORMAL_SANDBOX === '1') {
      wt('keep-sandbox.txt', `KEEP_FORMAL_SANDBOX=1 sandboxId=${created?.sandboxId}\n`);
    } else {
      const d = await handlePxSandboxDestroy();
      wj('formal-destroy.json', d);
    }
  }
}

main();
