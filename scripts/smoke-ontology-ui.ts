/**
 * Smoke: ontology-state build + local UI server + MCP preview handle.
 */
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  writeOntologyStateFile,
  buildOntologyState,
} from '../src/verification-sandbox/ontology-state.js';
import {
  handlePxSandboxCreate,
  handlePxUploadLinkml,
  handlePxOntologyUiPreview,
  handlePxSandboxDestroy,
} from '../src/verification-sandbox/handlers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const statePath = writeOntologyStateFile();
  const state = buildOntologyState();
  console.log(
    'STATE',
    JSON.stringify({
      path: statePath,
      summary: state?.summary,
      fleet: state?.fleet,
      rfNodes: (state as { reactFlow?: { nodes?: unknown[] } })?.reactFlow?.nodes?.length,
    }),
  );

  const uiDir = path.join(root, 'src/verification-sandbox/templates/ontology-ui');
  const genDir = path.join(
    path.dirname(statePath || ''),
  );
  const port = 17008;
  const child = spawn(
    'python3',
    [
      path.join(root, 'src/verification-sandbox/templates/ontology-ui-server.py'),
      '--port',
      String(port),
      '--ui-dir',
      uiDir,
    ],
    {
      env: {
        ...process.env,
        SHACL_SHAPES_DIR: genDir,
        PX_REMOTE_ROOT: path.dirname(genDir),
        ONTOLOGY_UI_DIR: uiDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  await new Promise((r) => setTimeout(r, 900));

  try {
    const health = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());
    const page = await fetch(`http://127.0.0.1:${port}/`);
    const st = await fetch(`http://127.0.0.1:${port}/api/ontology/state`).then((r) => r.json());
    const overlay = await fetch(`http://127.0.0.1:${port}/api/ontology/overlay`).then((r) =>
      r.json(),
    );
    const midspiral = await fetch(`http://127.0.0.1:${port}/api/midspiral/status`).then((r) =>
      r.json(),
    );
    const credits = await fetch(`http://127.0.0.1:${port}/api/usage/credits`).then((r) =>
      r.json(),
    );
    console.log('HEALTH', health);
    console.log('PAGE', page.status);
    console.log(
      'API',
      JSON.stringify({
        pack: st.pack,
        summary: st.summary,
        nodes: st.reactFlow?.nodes?.length,
      }),
    );
    console.log(
      'OVERLAY',
      JSON.stringify({
        ok: overlay.ok,
        source: overlay.source,
        nodeKeys: overlay.nodes ? Object.keys(overlay.nodes).length : 0,
      }),
    );
    console.log(
      'MIDSPIRAL',
      JSON.stringify({
        ok: midspiral.ok !== false,
        readyCount: midspiral.readyCount,
        total: midspiral.total || (midspiral.tools || []).length,
        tools: (midspiral.tools || []).map((t: { id: string; ready?: boolean }) => t.id),
      }),
    );
    console.log(
      'CREDITS',
      JSON.stringify({
        ok: credits.ok !== false,
        prepaid: credits.prepaid,
        remaining: credits.creditsRemaining,
        prepaidUsd: credits.creditsPrepaid || credits.prepaidUsd,
        burn: credits.burnUsd,
        runtime: credits.fmtRuntime,
      }),
    );

    await handlePxSandboxCreate({ forceMock: true });
    const up = await handlePxUploadLinkml({});
    const prev = await handlePxOntologyUiPreview({});
    console.log(
      'MCP',
      JSON.stringify({
        files: (up as { files?: string[] }).files?.length,
        preview: prev,
      }),
    );
    await handlePxSandboxDestroy();

    const pass =
      Boolean(statePath) &&
      page.status === 200 &&
      (health as { ok?: boolean }).ok === true &&
      (st.reactFlow?.nodes?.length || 0) > 0 &&
      (prev as { ok?: boolean }).ok === true;

    console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
    process.exitCode = pass ? 0 : 1;
  } finally {
    child.kill('SIGTERM');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
