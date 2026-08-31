/**
 * Create/mint LinkML verifier UIs + assistant-ui web in formal Daytona sandbox.
 *
 *   eval "$(python3 scripts/export-daytona-env.py)"
 *   VERIFIER_SANDBOX_PROVIDER=daytona npm run open:linkml-verifiers
 *   OPEN_BROWSER=0 npm run open:linkml-verifiers
 *   FORCE_LOCAL=1 npm run open:linkml-verifiers
 *   SKIP_ASSISTANT_UI=1  — skip :3010 pack (faster)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import { parse } from 'yaml';
import {
  handlePxFormalCreate,
  handlePxFormalPreview,
  handlePxFormalFleetPreview,
  handleToolIoGuard,
  handlePxSandboxCreate,
  handlePxUploadLinkml,
  handlePxShaclPreview,
  handlePxOntologyUiPreview,
  getActiveFormalBox,
} from '../src/verification-sandbox/handlers.js';
import { resolvePxRoot } from '../src/verification-sandbox/px-pack.js';
import { buildLinkmlReasoning } from '../src/verification-sandbox/linkml-reasoning.js';
import { readLinkmlUsageLog } from '../src/verification-sandbox/linkml-usage-log.js';
import { resolveAssistantUiRoot } from '../src/verification-sandbox/assistant-ui-web.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, '.gsd/evidence');
const OPEN_BROWSER = process.env.OPEN_BROWSER !== '0';

/** Load DAYTONA_* from .env via export script (safe for messy .env lines). */
function loadDaytonaEnvFromFile() {
  const script = path.join(ROOT, 'scripts/export-daytona-env.py');
  if (!fs.existsSync(script)) return;
  const r = spawnSync('python3', [script], { encoding: 'utf8', cwd: ROOT });
  if (r.status !== 0 || !r.stdout) return;
  for (const line of r.stdout.split('\n')) {
    const m = line.match(/^export\s+(DAYTONA_[A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith('"') && v.endsWith('"'))
    ) {
      v = v.slice(1, -1);
    }
    // unquote shell escapes lightly
    v = v.replace(/\\'/g, "'").replace(/\\"/g, '"');
    if (!process.env[m[1]]) process.env[m[1]] = v;
  }
}

function openUrl(url: string) {
  if (!OPEN_BROWSER || !url) return;
  if (process.platform === 'darwin') {
    spawnSync('open', [url], { stdio: 'ignore' });
  } else if (process.platform === 'linux') {
    spawnSync('xdg-open', [url], { stdio: 'ignore' });
  }
}

async function main() {
  loadDaytonaEnvFromFile();
  process.env.VERIFIER_SANDBOX_PROVIDER =
    process.env.VERIFIER_SANDBOX_PROVIDER || 'daytona';

  const FORCE_LOCAL =
    process.env.FORCE_LOCAL === '1' ||
    process.env.FORMAL_FORCE_LOCAL === '1' ||
    !process.env.DAYTONA_API_KEY;

  const wantAui = process.env.SKIP_ASSISTANT_UI !== '1';
  const auiRoot = resolveAssistantUiRoot(process.env.ASSISTANT_UI_ROOT);

  const px = resolvePxRoot();
  const happyPath = px
    ? path.join(px, 'linkml/oteemo/fixtures/engagement.happy.yaml')
    : '';
  const happy =
    happyPath && fs.existsSync(happyPath)
      ? parse(fs.readFileSync(happyPath, 'utf8'))
      : { engagement_id: 'e1' };

  const reasoning = buildLinkmlReasoning({
    pack: 'oteemo',
    className: 'Engagement',
    tool: 'open-linkml-verifiers',
    data: happy,
    pxRoot: px,
  });
  await handleToolIoGuard({
    tool: 'open-linkml-verifiers',
    phase: 'pre',
    pack: 'oteemo',
    className: 'Engagement',
    payload: happy,
    enforceSchema: true,
  });

  const urls: Array<{ name: string; url: string; port?: number }> = [];
  let createResult: any = null;
  let auiNote = '';

  if (!FORCE_LOCAL) {
    console.error(
      wantAui
        ? `Daytona formal create + assistant-ui from ${auiRoot || '(missing root)'} (may take several minutes)…`
        : 'Daytona formal create (SKIP_ASSISTANT_UI=1)…',
    );
    createResult = await handlePxFormalCreate({
      customerId: process.env.CUSTOMER_ID || 'oteemo-devsecops',
      forceLocal: false,
      startAssistantUiWeb: wantAui,
      assistantUiRoot: auiRoot || undefined,
    });
    if (createResult?.ok) {
      const ont = (await handlePxFormalPreview({
        app: 'ontology',
        expiresInSeconds: 3600,
      })) as any;
      const fleet = (await handlePxFormalFleetPreview({
        expiresInSeconds: 3600,
      })) as any;
      const val = (await handlePxFormalPreview({
        app: 'validate',
        expiresInSeconds: 3600,
      })) as any;
      if (ont?.preview?.url)
        urls.push({ name: 'formal-ontology', url: ont.preview.url, port: 7005 });
      if (fleet?.preview?.url)
        urls.push({ name: 'formal-fleet', url: fleet.preview.url, port: 7006 });
      if (val?.preview?.url)
        urls.push({ name: 'shacl-validate', url: val.preview.url, port: 7004 });

      // assistant-ui web :3010
      let auiUrl =
        createResult?.previews?.assistantUiWeb?.url ||
        createResult?.assistantUiWeb?.previewUrl ||
        null;
      const box = getActiveFormalBox();
      if (box?.getAssistantUiWebPreviewUrl) {
        try {
          const p = await box.getAssistantUiWebPreviewUrl(3600);
          if (p?.url) auiUrl = p.url;
        } catch {
          /* */
        }
      }
      if (auiUrl) {
        urls.push({ name: 'assistant-ui-web', url: auiUrl, port: 3010 });
      } else if (wantAui) {
        const probe = createResult?.assistantUiWeb;
        auiNote = `assistant-ui not ready: ${JSON.stringify(probe || {}).slice(0, 400)}`;
        console.error(auiNote);
      }
    } else {
      console.error('formal create failed:', JSON.stringify(createResult).slice(0, 500));
    }
  }

  if (!urls.length) {
    createResult = await handlePxSandboxCreate({
      forceMock: true,
      pxRoot: px || undefined,
      skipShacl: false,
    });
    try {
      await handlePxUploadLinkml({ pxRoot: px || undefined, regenerate: true });
    } catch {
      /* best effort */
    }
    const uiPort = Number(process.env.ONTOLOGY_UI_PORT || 7005);
    const uiScript = path.join(
      ROOT,
      'src/verification-sandbox/templates/ontology-ui-server.py',
    );
    const uiDir = path.join(ROOT, 'src/verification-sandbox/templates/ontology-ui');
    const child = spawn(
      'python3',
      [uiScript, '--port', String(uiPort), '--ui-dir', uiDir],
      {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          CLOUD_AGENT_ROOT: ROOT,
          GROK_PROJECT_DIR: ROOT,
          PX_REMOTE_ROOT: px || '',
          SHACL_SHAPES_DIR: px ? path.join(px, 'generated') : '',
          ONTOLOGY_UI_DIR: uiDir,
        },
      },
    );
    child.unref();
    await new Promise((r) => setTimeout(r, 800));
    urls.push({
      name: 'local-ontology-ui',
      url: `http://127.0.0.1:${uiPort}/`,
      port: uiPort,
    });
    if (auiRoot && process.env.OPEN_LOCAL_AUI === '1') {
      // optional: operator may already run AUI locally
      urls.push({
        name: 'assistant-ui-local-hint',
        url: process.env.ASSISTANT_UI_URL || 'http://127.0.0.1:3010/',
        port: 3010,
      });
    }
    try {
      const shaclPrev = (await handlePxShaclPreview({ expiresInSeconds: 600 })) as any;
      if (shaclPrev?.preview?.url || shaclPrev?.url) {
        urls.push({
          name: 'shacl-preview',
          url: shaclPrev.preview?.url || shaclPrev.url,
          port: 7004,
        });
      }
      const ontPrev = (await handlePxOntologyUiPreview({ expiresInSeconds: 600 })) as any;
      if (ontPrev?.preview?.url) {
        urls.push({ name: 'ontology-preview', url: ontPrev.preview.url, port: 7005 });
      }
    } catch {
      /* */
    }
  }

  const usage = readLinkmlUsageLog({ limit: 5, pack: 'oteemo' });
  const lines = [
    `# LinkML verifiers — ${new Date().toISOString()}`,
    `# provider default: ${process.env.VERIFIER_SANDBOX_PROVIDER}`,
    `# mode: ${FORCE_LOCAL ? 'local/mock' : 'daytona-formal'}`,
    `# assistant-ui root: ${auiRoot || 'not found'}`,
    `# create: ${JSON.stringify({
      ok: createResult?.ok,
      sandboxId: createResult?.sandboxId || createResult?.id,
      runtime: createResult?.runtime,
    })}`,
    auiNote ? `# aui: ${auiNote}` : '',
    '',
    ...urls.map((u) => `${u.name}${u.port ? ` (${u.port})` : ''}: ${u.url}`),
    '',
    '## LinkML reasoning (sample Engagement / oteemo)',
    reasoning.narrative,
    '',
    '## Recent usage (oteemo)',
    ...usage.entries.map(
      (e) =>
        `- ${e.at} tool=${e.tool} ok=${e.ok} classes=${(e.classesUsed || []).join(',')}`,
    ),
  ].filter((l) => l !== undefined);

  fs.mkdirSync(EVIDENCE, { recursive: true });
  const txt = path.join(EVIDENCE, 'LATEST-open-urls.txt');
  const json = path.join(EVIDENCE, 'LATEST-open-urls.json');
  fs.writeFileSync(txt, lines.join('\n') + '\n');
  fs.writeFileSync(
    json,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        urls,
        assistantUiRoot: auiRoot,
        assistantUi: createResult?.assistantUiWeb || null,
        reasoning: {
          classesUsed: reasoning.classesUsed,
          resolversUsed: reasoning.resolversUsed,
          mutationsReferenced: reasoning.mutationsReferenced,
          relationshipsUsed: reasoning.relationshipsUsed,
          narrative: reasoning.narrative,
        },
        usage: usage.entries.slice(-5),
        createResult,
      },
      null,
      2,
    ),
  );

  console.log(lines.join('\n'));
  console.log(`\nWrote ${txt}`);

  for (const u of urls) openUrl(u.url);

  if (!urls.length) {
    console.error('No preview URLs minted');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
