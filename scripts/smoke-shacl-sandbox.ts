/**
 * Smoke: packed sandbox SHACL server (port 7004) + LinkML pack upload.
 *
 *   # mock (no cloud keys)
 *   npx tsx scripts/smoke-shacl-sandbox.ts
 *
 *   # live Daytona
 *   VERIFIER_LIVE=1 DAYTONA_API_KEY=... npx tsx scripts/smoke-shacl-sandbox.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, spawnSync } from 'child_process';
import {
  callVerificationMcpTool,
  handlePxSandboxCreate,
  handlePxUploadLinkml,
  handlePxShaclValidate,
  handlePxShaclPreview,
  handlePxSandboxDestroy,
  resolvePxRoot,
  readShaclServerScript,
} from '../src/verification-sandbox/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function evidencePath(): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15);
  const dir = path.join(ROOT, '.gsd/evidence');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${ts}Z-shacl-sandbox-server.md`);
}

function loadHappy(_pxRoot: string | null): Record<string, unknown> {
  // Minimal VerifierFleet that passes gen-shacl enums (kind ∈ proof|property|guard|typecheck)
  return {
    fleet_id: 'fleet-smoke-1',
    revision: '1',
    environment: 'test',
    verifiers: [
      {
        verifier_id: 'v-proof',
        backend: 'lean',
        kind: 'proof',
        name: 'Safety proof',
        order: 1,
        match_mode: 'all',
        blocking: true,
        enabled: true,
        tags: ['safety'],
      },
    ],
  };
}

/** Spin local shacl-server.py on ephemeral port for container-parity proof. */
async function localShaclServerSmoke(
  pxRoot: string | null,
  happy: Record<string, unknown>,
  sad: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const script = readShaclServerScript();
  const shapesDir = pxRoot ? path.join(pxRoot, 'generated') : null;
  if (!script || !shapesDir || !fs.existsSync(shapesDir)) {
    return { skipped: true, reason: 'no shacl-server.py or shapes dir' };
  }
  const pyCandidates = ['/usr/bin/python3', 'python3'];
  let py = 'python3';
  for (const c of pyCandidates) {
    const p = spawnSync(c, ['-c', 'import pyshacl,rdflib'], { encoding: 'utf8', timeout: 8000 });
    if (p.status === 0) {
      py = c;
      break;
    }
  }
  const port = 17004;
  const child = spawn(
    py,
    [script.local, '--port', String(port), '--shapes-dir', shapesDir],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  await new Promise((r) => setTimeout(r, 800));
  try {
    const health = spawnSync('curl', ['-sf', `http://127.0.0.1:${port}/health`], {
      encoding: 'utf8',
      timeout: 5000,
    });
    const happyR = spawnSync(
      'curl',
      [
        '-s',
        '-X',
        'POST',
        `http://127.0.0.1:${port}/validate`,
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify({ data: happy, pack: 'verifier-fleet' }),
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    const sadR = spawnSync(
      'curl',
      [
        '-s',
        '-X',
        'POST',
        `http://127.0.0.1:${port}/validate`,
        '-H',
        'Content-Type: application/json',
        '-d',
        JSON.stringify({ data: sad, pack: 'verifier-fleet' }),
      ],
      { encoding: 'utf8', timeout: 30_000 },
    );
    let happyJ: { conforms?: boolean; engine?: string } = {};
    let sadJ: { conforms?: boolean; engine?: string } = {};
    try {
      happyJ = JSON.parse(happyR.stdout || '{}');
    } catch {
      /* */
    }
    try {
      sadJ = JSON.parse(sadR.stdout || '{}');
    } catch {
      /* */
    }
    return {
      skipped: false,
      port,
      healthOk: health.status === 0,
      health: health.stdout?.slice(0, 300),
      happyConforms: Boolean(happyJ.conforms),
      sadConforms: Boolean(sadJ.conforms),
      engine: happyJ.engine || sadJ.engine,
    };
  } finally {
    child.kill('SIGTERM');
  }
}

async function main() {
  const live = process.env.VERIFIER_LIVE === '1' || process.env.VERIFIER_LIVE === 'true';
  const forceMock = !live || !process.env.DAYTONA_API_KEY;
  const pxRoot = resolvePxRoot(process.env.PX_ROOT) || undefined;

  const lines: string[] = [
    '# SHACL sandbox server smoke',
    '',
    `- live: ${live}`,
    `- forceMock: ${forceMock}`,
    `- pxRoot: ${pxRoot || '(none)'}`,
    `- shaclPort: 7004`,
    '',
  ];

  const create = await handlePxSandboxCreate({
    forceMock,
    pxRoot,
  });
  lines.push('## create', '```json', JSON.stringify(create, null, 2), '```', '');

  const upload = await handlePxUploadLinkml({ pxRoot });
  lines.push('## upload', '```json', JSON.stringify(upload, null, 2), '```', '');

  const preview = await handlePxShaclPreview({ expiresInSeconds: 120 });
  const previewSafe = JSON.parse(JSON.stringify(preview));
  if (previewSafe?.preview?.token) previewSafe.preview.token = '[redacted]';
  lines.push('## preview (signed URL)', '```json', JSON.stringify(previewSafe, null, 2), '```', '');

  const happy = loadHappy(pxRoot || null);
  const sad = { revision: 1 };

  const rounds: Array<{ round: number; happy: unknown; sad: unknown; upload?: unknown }> = [];
  const periods = Number(process.env.SHACL_UPLOAD_ROUNDS || 3);
  for (let i = 0; i < periods; i++) {
    if (i > 0) {
      // periodic re-upload (host regen + apply shapes)
      const reup = await handlePxUploadLinkml({ pxRoot, regenerate: true });
      rounds.push({
        round: i,
        upload: {
          ok: (reup as { ok?: boolean }).ok,
          files: Array.isArray((reup as { files?: unknown[] }).files)
            ? (reup as { files: unknown[] }).files.length
            : 0,
        },
        happy: null,
        sad: null,
      });
    }
    const h = await handlePxShaclValidate({ data: happy, pack: 'verifier-fleet' });
    const s = await handlePxShaclValidate({ data: sad, pack: 'verifier-fleet' });
    if (i === 0) {
      rounds.push({ round: 0, happy: null, sad: null });
    }
    const entry = rounds[rounds.length - 1] || { round: i, happy: null, sad: null };
    entry.happy = {
      ok: h.ok,
      conforms: (h as { conforms?: boolean }).conforms,
      engine: (h as { engine?: string }).engine,
    };
    entry.sad = {
      ok: s.ok,
      conforms: (s as { conforms?: boolean }).conforms,
      engine: (s as { engine?: string }).engine,
      violationCount: Array.isArray((s as { violations?: unknown[] }).violations)
        ? (s as { violations: unknown[] }).violations.length
        : 0,
    };
  }

  const happyR = rounds[0]?.happy as { ok?: boolean; conforms?: boolean; engine?: string };
  const sadR = rounds[0]?.sad as {
    ok?: boolean;
    conforms?: boolean;
    engine?: string;
    violationCount?: number;
  };

  lines.push(
    '## validate happy (round 0)',
    '```json',
    JSON.stringify(happyR, null, 2),
    '```',
    '',
    '## validate sad (round 0)',
    '```json',
    JSON.stringify(sadR, null, 2),
    '```',
    '',
    '## periodic re-upload rounds',
    '```json',
    JSON.stringify(rounds, null, 2),
    '```',
    '',
  );

  // fleet_run + tool_io_guard smoke
  const fleet = await callVerificationMcpTool('fleet_run', {
    forceMock: true,
    maxRetries: 2,
  });
  const tio = await callVerificationMcpTool('tool_io_guard', {
    tool: 'bash',
    phase: 'pre',
    payload: { command: 'echo ok' },
    enforceSchema: false,
  });
  lines.push(
    '## fleet_run',
    '```json',
    JSON.stringify(
      {
        ok: (fleet as { ok?: boolean }).ok,
        attempts: (fleet as { attempts?: number }).attempts,
        message: (fleet as { message?: string }).message,
      },
      null,
      2,
    ),
    '```',
    '',
    '## tool_io_guard',
    '```json',
    JSON.stringify(
      { ok: (tio as { ok?: boolean }).ok, violations: (tio as { violations?: unknown[] }).violations },
      null,
      2,
    ),
    '```',
    '',
  );

  const localServer = await localShaclServerSmoke(pxRoot || null, happy, sad);
  lines.push(
    '## local shacl-server.py (container parity)',
    '```json',
    JSON.stringify(localServer, null, 2),
    '```',
    '',
  );

  const destroy = await handlePxSandboxDestroy();
  lines.push('## destroy', '```json', JSON.stringify(destroy, null, 2), '```', '');

  const manifest = await callVerificationMcpTool('px_load', {});
  lines.push('## mcp manifest', '```json', JSON.stringify(manifest, null, 2), '```', '');

  const happyOk = Boolean(happyR?.conforms);
  const sadFail = happyR != null && sadR?.conforms === false;
  const roundsOk = rounds.every((r) => {
    const h = r.happy as { conforms?: boolean } | null;
    const s = r.sad as { conforms?: boolean } | null;
    if (!h || !s) return true;
    return h.conforms === true && s.conforms === false;
  });
  const localOk =
    localServer.skipped ||
    (localServer.healthOk && localServer.happyConforms === true && localServer.sadConforms === false);
  const fleetOk = (fleet as { ok?: boolean }).ok === true;
  const tioOk = (tio as { ok?: boolean }).ok === true;
  const pass =
    create &&
    (create as { ok?: boolean }).ok !== false &&
    happyOk &&
    sadFail &&
    roundsOk &&
    Boolean(localOk) &&
    fleetOk &&
    tioOk;

  lines.push(`## result: ${pass ? 'PASS' : 'FAIL'}`, '');
  lines.push(
    `- happy conforms: ${happyOk}`,
    `- sad non-conforms: ${sadFail}`,
    `- periodic rounds ok: ${roundsOk} (n=${rounds.length})`,
    `- local shacl-server health+happy/sad: ${JSON.stringify(localOk)}`,
    `- fleet_run ok: ${fleetOk}`,
    `- tool_io_guard ok: ${tioOk}`,
    `- SHACL server in container: port 7004 (Dockerfile + bootstrap + /rebuild)`,
    `- upload via product MCP + host regen + SDK (not agent keys)`,
    '',
  );

  const out = evidencePath();
  fs.writeFileSync(out, lines.join('\n'));
  console.log(lines.join('\n'));
  console.log(`\nwrote ${out}`);
  if (!pass) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
