/**
 * Smoke: ontology enforce/edit + CoT + suggestions
 */
import { spawnSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { callVerificationMcpTool } from '../src/verification-sandbox/mcp-tools.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mode = path.join(root, 'scripts/px-ontology-mode.sh');

function runMode(...args: string[]) {
  const r = spawnSync('bash', [mode, ...args], { encoding: 'utf8', cwd: root });
  console.log(r.stdout || r.stderr);
}

async function main() {
  runMode('off');
  const skip = (await callVerificationMcpTool('tool_io_guard', {
    tool: 'bash',
    phase: 'pre',
    payload: { fleet_id: 'x' },
    enforceSchema: true,
  })) as Record<string, unknown>;
  console.log('SKIP', {
    ok: skip.ok,
    skipped: skip.skipped,
    cotPreview: String(skip.cot || '').slice(0, 180),
  });

  const shaclSkip = (await callVerificationMcpTool('px_shacl_validate', {
    data: { revision: 1 },
  })) as Record<string, unknown>;
  console.log('SHACL_SKIP', { ok: shaclSkip.ok, skipped: shaclSkip.skipped });

  runMode('on');
  runMode('edit', 'on');

  const modeStatus = (await callVerificationMcpTool('px_ontology_mode', {
    target: 'enforce',
    action: 'status',
  })) as Record<string, unknown>;
  console.log('MODE', {
    enf: modeStatus.ontologyEnforcement,
    edit: modeStatus.ontologyEditing,
  });

  const sug = (await callVerificationMcpTool('px_ontology_suggest', {
    violations: [{ title: 'missing fleet_id', reason: 'Required fleet_id minCount 1' }],
  })) as Record<string, unknown>;
  const suggestions = (sug.suggestions as unknown[]) || [];
  console.log('SUG', {
    ok: sug.ok,
    n: suggestions.length,
    cotPreview: String(sug.cot || '').slice(0, 220),
  });

  const tio = (await callVerificationMcpTool('tool_io_guard', {
    tool: 'bash',
    phase: 'pre',
    payload: { command: 'echo ok' },
    enforceSchema: false,
  })) as Record<string, unknown>;
  console.log('TIO', { ok: tio.ok, hasCot: Boolean(tio.cot) });

  const pass =
    skip.skipped === true &&
    shaclSkip.skipped === true &&
    modeStatus.ontologyEnforcement === true &&
    modeStatus.ontologyEditing === true &&
    suggestions.length > 0 &&
    Boolean(sug.cot) &&
    tio.ok === true;

  console.log(pass ? 'RESULT PASS' : 'RESULT FAIL');
  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
