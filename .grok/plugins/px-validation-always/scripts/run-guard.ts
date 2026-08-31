/**
 * CLI for harness PreToolUse / PostToolUse — same surface as MCP tool_io_guard.
 *
 * Usage:
 *   npx tsx run-guard.ts --phase pre  --tool NAME [--input-json '{}']
 *   npx tsx run-guard.ts --phase post --tool NAME [--input-json '{}'] [--result-json '{}']
 *   echo '<hook envelope>' | npx tsx run-guard.ts --from-stdin --phase pre|post
 */
import { parseArgs } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
// scripts → plugin → plugins → .grok → repo root
import { enforceToolIo, bareToolName } from '../../../../src/verification-sandbox/io-enforcement.js';

function readStdin(): string {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

function parseJson(s: string | undefined): unknown {
  if (!s || !s.trim()) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      phase: { type: 'string' },
      tool: { type: 'string' },
      pack: { type: 'string' },
      'class-name': { type: 'string' },
      'input-json': { type: 'string' },
      'result-json': { type: 'string' },
      'from-stdin': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'write-state': { type: 'string' },
    },
    allowPositionals: true,
  });

  let toolName = values.tool || '';
  let toolInput: unknown = parseJson(values['input-json']);
  let toolResult: unknown = parseJson(values['result-json']);
  let phase = (values.phase === 'post' ? 'post' : 'pre') as 'pre' | 'post';
  let text: string | undefined;

  if (values['from-stdin']) {
    const raw = readStdin();
    let env: Record<string, unknown> = {};
    try {
      env = JSON.parse(raw || '{}');
    } catch {
      env = {};
    }
    toolName =
      String(env.toolName || env.tool_name || env.tool || toolName || '');
    toolInput = env.toolInput ?? env.tool_input ?? env.input ?? toolInput;
    toolResult = env.toolResult ?? env.tool_result ?? env.toolResponse ?? toolResult;
    const ev = String(env.hookEventName || env.hook_event_name || '');
    if (/post/i.test(ev)) phase = 'post';
    if (/pre/i.test(ev) && !/post/i.test(ev)) phase = 'pre';
    if (values.phase === 'post') phase = 'post';
    if (values.phase === 'pre') phase = 'pre';
    text =
      typeof (env.prompt ?? env.userPrompt) === 'string'
        ? String(env.prompt ?? env.userPrompt)
        : undefined;
  }

  if (!toolName) {
    process.stdout.write(
      JSON.stringify({
        ok: false,
        decision: 'deny',
        reason: 'missing tool name',
        phase,
      }),
    );
    process.exit(0);
  }

  const decision = await enforceToolIo({
    toolName,
    phase,
    toolInput,
    toolResult,
    pack: values.pack,
    className: values['class-name'],
    text,
    force: values.force,
  });

  const out = {
    ...decision,
    bareTool: bareToolName(toolName),
    at: new Date().toISOString(),
  };

  const statePath =
    values['write-state'] ||
    process.env.PX_IO_GUARD_STATE ||
    path.join(process.cwd(), '.px/session/last-io-guard.json');
  try {
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(out, null, 2));
  } catch {
    /* best-effort session state */
  }

  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => {
  process.stderr.write(String(e?.stack || e));
  process.stdout.write(
    JSON.stringify({
      ok: false,
      decision: 'deny',
      reason: String(e?.message || e),
    }),
  );
  process.exit(0);
});
