/**
 * LIVE sandbox proof: tool_io_guard pre/post + ontologyHookContext against Daytona endpoints.
 *
 *   set -a && source .env && set +a
 *   VERIFIER_LIVE=1 npx tsx scripts/smoke-oteemo-hook-context-live.ts
 *
 * Requires DAYTONA_API_KEY. Exits non-zero if missing (does not mock-pass live).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  handlePxSandboxCreate,
  handlePxSandboxDestroy,
  handlePxShaclValidate,
  handlePxShaclPreview,
  handleToolIoGuard,
  resolvePxRoot,
} from '../src/verification-sandbox/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.gsd/evidence/oteemo-hook-context');
fs.mkdirSync(OUT, { recursive: true });

function loadEnvFile() {
  const envPath = path.join(ROOT, '.env');
  if (!fs.existsSync(envPath)) return;
  const text = fs.readFileSync(envPath, 'utf8');
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i < 0) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

async function main() {
  loadEnvFile();
  const live = process.env.VERIFIER_LIVE === '1' || process.env.VERIFIER_LIVE === 'true';
  const key = process.env.DAYTONA_API_KEY;
  if (!live) {
    console.error('LIVE_BLOCKED: set VERIFIER_LIVE=1');
    process.exit(2);
  }
  if (!key) {
    console.error('LIVE_BLOCKED: DAYTONA_API_KEY missing');
    fs.writeFileSync(
      path.join(OUT, 'live-blocked.json'),
      JSON.stringify({ ok: false, error: 'DAYTONA_API_KEY missing' }, null, 2),
    );
    process.exit(2);
  }

  const px = resolvePxRoot()!;
  const happy = parseYaml(
    fs.readFileSync(path.join(px, 'linkml/oteemo/fixtures/engagement.happy.yaml'), 'utf8'),
  );
  const sad = parseYaml(
    fs.readFileSync(path.join(px, 'linkml/oteemo/fixtures/engagement.sad.yaml'), 'utf8'),
  );

  const create = await handlePxSandboxCreate({
    forceMock: false,
    provider: 'daytona',
    pxRoot: px,
    skipShacl: false,
  });
  fs.writeFileSync(path.join(OUT, 'live-create.json'), JSON.stringify(create, null, 2));

  const provider = String((create as any).provider || '');
  const sandboxId = String((create as any).sandboxId || '');
  if ((create as any).ok === false && !sandboxId) {
    console.error('LIVE_FAIL: sandbox create failed', create);
    process.exit(1);
  }
  if (provider === 'mock' || sandboxId.startsWith('mock-')) {
    console.error('LIVE_FAIL: got mock provider — refusing to claim live pass', { provider, sandboxId });
    await handlePxSandboxDestroy({});
    process.exit(1);
  }

  const failures: string[] = [];
  try {
    // Live SHACL validate
    const shacl = await handlePxShaclValidate({
      data: happy,
      pack: 'oteemo',
      className: 'Engagement',
      force: true,
    });
    fs.writeFileSync(
      path.join(OUT, 'live-shacl-happy.json'),
      JSON.stringify(
        {
          ok: shacl.ok,
          conforms: shacl.conforms,
          engine: shacl.engine,
          sandboxId: shacl.sandboxId,
          provider,
        },
        null,
        2,
      ),
    );
    if (shacl.conforms !== true) failures.push(`live SHACL happy not conformant engine=${shacl.engine}`);

    let preview: unknown = null;
    try {
      preview = await handlePxShaclPreview({ expiresInSeconds: 180 });
      fs.writeFileSync(path.join(OUT, 'live-shacl-preview.json'), JSON.stringify(preview, null, 2));
    } catch (e) {
      fs.writeFileSync(
        path.join(OUT, 'live-shacl-preview.json'),
        JSON.stringify({ ok: false, error: String(e) }, null, 2),
      );
    }

    const pre = await handleToolIoGuard({
      tool: 'deploy_manifest',
      phase: 'pre',
      enforceSchema: true,
      pack: 'oteemo',
      className: 'Engagement',
      payload: happy,
    });
    const post = await handleToolIoGuard({
      tool: 'scan_image',
      phase: 'post',
      enforceSchema: true,
      pack: 'oteemo',
      className: 'Engagement',
      payload: happy,
      result: sad,
    });

    const preCtx = pre.ontologyHookContext as any;
    const postCtx = post.ontologyHookContext as any;
    fs.writeFileSync(
      path.join(OUT, 'live-pre.json'),
      JSON.stringify(
        {
          ok: pre.ok,
          sandboxId: pre.sandboxId,
          ontologyHookContext: preCtx,
          cotHead: String(pre.cot || '').slice(0, 800),
        },
        null,
        2,
      ),
    );
    fs.writeFileSync(
      path.join(OUT, 'live-post.json'),
      JSON.stringify(
        {
          ok: post.ok,
          sandboxId: post.sandboxId,
          ontologyHookContext: postCtx,
        },
        null,
        2,
      ),
    );

    if (!preCtx?.endpoint?.sandboxId && !pre.sandboxId) failures.push('pre missing sandbox endpoint id');
    if (!preCtx?.ontologies?.length) failures.push('pre missing ontologies');
    if (!preCtx?.shapes?.length) failures.push('pre missing shapes');
    if (!preCtx?.relationships?.length) failures.push('pre missing relationships');
    if (!preCtx?.guardrails?.length) failures.push('pre missing guardrails');
    if (pre.ok !== true) failures.push('pre happy should pass');
    if (post.ok !== false) failures.push('post sad should fail');
    if (String(pre.sandboxId || '').startsWith('mock-')) failures.push('sandboxId is mock');

    const summary = {
      ok: failures.length === 0,
      failures,
      provider,
      sandboxId: pre.sandboxId || sandboxId,
      preOk: pre.ok,
      postOk: post.ok,
      shaclEngine: shacl.engine,
      previewOk: Boolean((preview as any)?.ok || (preview as any)?.preview),
    };
    fs.writeFileSync(path.join(OUT, 'live-summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify(summary, null, 2));
    if (failures.length) process.exit(1);
  } finally {
    await handlePxSandboxDestroy({});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
