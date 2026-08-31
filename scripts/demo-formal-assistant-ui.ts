/**
 * Live: formal Daytona + latest 02-products/assistant-ui web on :3010.
 *
 *   eval "$(python3 scripts/export-daytona-env.py)"
 *   KEEP_FORMAL_SANDBOX=1 npx tsx scripts/demo-formal-assistant-ui.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { handlePxFormalCreate, handlePxSandboxDestroy } from '../src/verification-sandbox/handlers.js';
import { resolveAssistantUiRoot } from '../src/verification-sandbox/assistant-ui-web.js';
import { formalSurfaceOwnership } from '../src/verification-sandbox/formal-stack.js';
import { registrySyncSnapshot } from '../src/verification-sandbox/types-registry.js';
import { getActiveFormalBox } from '../src/verification-sandbox/handlers.js';

const SCRATCH =
  process.env.SCRATCH ||
  process.env.GOAL_SCRATCH ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../.gsd/evidence/formal-aui-scratch');

function wj(name: string, data: unknown) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, name), JSON.stringify(data, null, 2));
}
function wt(name: string, text: string) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, name), text);
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  const auiRoot = resolveAssistantUiRoot(process.env.ASSISTANT_UI_ROOT);
  wj('formal-role-registry.json', {
    ...registrySyncSnapshot(),
    ownership: formalSurfaceOwnership(),
    assistantUiRoot: auiRoot,
  });
  if (!process.env.DAYTONA_API_KEY) {
    wt('daytona-launch.txt', 'DAYTONA_API_KEY missing\n');
    process.exit(2);
  }
  if (!auiRoot) {
    wt('demo-fatal.txt', 'assistant-ui root not found under 02-products\n');
    process.exit(2);
  }
  wt('daytona-launch.txt', `key ok; ASSISTANT_UI_ROOT=${auiRoot}\n`);

  let created: Record<string, unknown> | null = null;
  try {
    created = await handlePxFormalCreate({
      customerId: process.env.CUSTOMER_ID || 'acme-fleet',
      startAssistantUiWeb: true,
      assistantUiRoot: auiRoot,
      forceLocal: false,
    });
    wj('formal-create-with-aui.json', created);
    if (!created.ok || created.runtime !== 'daytona') {
      throw new Error(`create failed: ${JSON.stringify(created).slice(0, 500)}`);
    }

    const aui = created.assistantUiWeb as {
      ok?: boolean;
      ready?: boolean;
      probe?: unknown;
      source?: unknown;
      error?: string;
    } | null;
    wj('assistant-ui-web-probe.json', aui || { missing: true });

    if (!aui?.ok && !aui?.ready) {
      throw new Error(`assistant-ui web not ready: ${aui?.error || JSON.stringify(aui)}`);
    }

    // Fresh signed previews (tokens expire)
    const box = getActiveFormalBox();
    let webPreview = (created.previews as { assistantUiWeb?: { url?: string } })?.assistantUiWeb;
    if (box?.getAssistantUiWebPreviewUrl) {
      webPreview = (await box.getAssistantUiWebPreviewUrl(3600)) || webPreview;
    }
    const ontology = (created.previews as { ontology?: { url?: string } })?.ontology;
    const fleet = (created.previews as { fleet?: { url?: string } })?.fleet;

    // Host fetch of assistant-ui preview
    const webUrl = webPreview?.url || (created.urls as { assistantUiWeb?: string })?.assistantUiWeb;
    let hostFetch: Record<string, unknown> = { url: webUrl };
    if (webUrl) {
      for (const pathSuffix of ['/', '/verifier-fleet']) {
        try {
          const r = await fetch(webUrl.replace(/\/$/, '') + pathSuffix, {
            redirect: 'follow',
          });
          const text = await r.text();
          hostFetch[pathSuffix] = {
            status: r.status,
            ok: r.ok,
            len: text.length,
            hasNext: /__NEXT_DATA__|next\/static|verifier-fleet|react-flow|Assistant/i.test(text),
            sample: text.slice(0, 400),
          };
        } catch (e) {
          hostFetch[pathSuffix] = {
            error: e instanceof Error ? e.message : String(e),
          };
        }
      }
    }
    wj('assistant-ui-web-preview.json', {
      preview: webPreview,
      hostFetch,
      sandboxId: created.sandboxId,
    });

    const homeOk = Boolean((hostFetch['/'] as { ok?: boolean })?.ok);
    const fleetOk = Boolean((hostFetch['/verifier-fleet'] as { ok?: boolean })?.ok);
    if (!homeOk && !fleetOk) {
      throw new Error(`host preview fetch failed: ${JSON.stringify(hostFetch)}`);
    }

    wt(
      'open-urls.txt',
      [
        `# Daytona formal + assistant-ui web — sandbox ${created.sandboxId}`,
        `# Open soon — signed tokens expire`,
        `assistant-ui web: ${webUrl}`,
        `assistant-ui /verifier-fleet: ${webUrl?.replace(/\/$/, '')}/verifier-fleet`,
        `ontology (formal 7005): ${ontology?.url || ''}`,
        `fleet-lite (formal 7006): ${fleet?.url || ''}`,
      ].join('\n') + '\n',
    );

    wj('demo-summary.json', {
      pass: true,
      runtime: 'daytona',
      sandboxId: created.sandboxId,
      assistantUiRoot: auiRoot,
      source: aui?.source,
      urls: {
        assistantUiWeb: webUrl,
        ontology: ontology?.url,
        fleetLite: fleet?.url,
      },
      hostFetch: {
        home: (hostFetch['/'] as { status?: number })?.status,
        verifierFleet: (hostFetch['/verifier-fleet'] as { status?: number })?.status,
      },
      probe: aui?.probe,
    });

    console.log('DEMO FORMAL ASSISTANT-UI PASS', {
      sandboxId: created.sandboxId,
      web: webUrl,
      home: (hostFetch['/'] as { status?: number })?.status,
      fleet: (hostFetch['/verifier-fleet'] as { status?: number })?.status,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.stack || e.message : String(e);
    wt('demo-fatal.txt', msg);
    wj('demo-summary.json', { pass: false, error: msg, created });
    console.error(e);
    process.exitCode = 1;
  } finally {
    if (process.env.KEEP_FORMAL_SANDBOX === '1') {
      wt('keep-sandbox.txt', `KEEP_FORMAL_SANDBOX=1 id=${created?.sandboxId}\n`);
    } else {
      wj('formal-destroy.json', await handlePxSandboxDestroy());
    }
  }
}

main();
