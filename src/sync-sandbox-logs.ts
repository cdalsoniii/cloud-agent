/**
 * Sync / verify sandbox logs → local SurrealDB
 *
 * Usage:
 *   npx tsx src/sync-sandbox-logs.ts --verify
 *   npx tsx src/sync-sandbox-logs.ts --sandbox-id <id> --fetch
 *   npx tsx src/sync-sandbox-logs.ts --sandbox-id <id> --content "manual log line"
 *   npx tsx src/sync-sandbox-logs.ts --list [--sandbox-id <id>]
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv, createLogger } from './types.js';
import {
  logSandboxLogs,
  getRecentSandboxLogs,
  getSurrealDbTarget,
  isSurrealDbConfigured,
  ensureSandboxLogTable,
} from './event-logger.js';
import { BasetenChainSandbox } from './baseten-chain-sandbox.js';
import { getDefaultConfig } from './types.js';

const log = createLogger('sync-sandbox-logs', process.env.VERBOSE === '1');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function printHelp(): void {
  console.log(`Usage: npx tsx src/sync-sandbox-logs.ts [options]

Options:
  --verify                 Write a probe record and read it back from SurrealDB
  --fetch                  Fetch live sandbox logs via chain and persist them
  --sandbox-id <id>        Target sandbox ID (required for --fetch / --content)
  --content <text>         Persist a manual log blob for sandbox-id
  --list                   List recent sandbox_log rows
  --limit <n>              Limit for --list (default 10)
  --lines <n>              Lines to fetch with --fetch (default 100)
  --help                   Show help
`);
}

async function verifyPath(): Promise<number> {
  const target = getSurrealDbTarget();
  console.log('SurrealDB target:', target);

  if (!target.configured) {
    console.error('SURREALDB_URL is not set. Add it to .env (e.g. http://localhost:8000).');
    return 1;
  }

  await ensureSandboxLogTable();
  const probeId = `verify-${Date.now()}`;
  const logId = await logSandboxLogs({
    sandbox_id: probeId,
    provider: process.env.SANDBOX_PROVIDER || 'daytona',
    source: 'verify',
    content: `cloud-agent sandbox_log verify probe at ${new Date().toISOString()}`,
    line_count: 1,
    operation: 'verify',
    metadata: { probe: true },
  });
  console.log('Wrote probe log_id:', logId);

  const rows = await getRecentSandboxLogs(probeId, 5);
  if (!rows.length) {
    console.error('Probe write succeeded but SELECT returned 0 rows — check NS/DB and auth.');
    return 1;
  }

  console.log('Verified rows:', JSON.stringify(rows.slice(0, 2), null, 2));
  console.log('OK: sandbox logs are writing to local SurrealDB.');
  return 0;
}

async function main(): Promise<void> {
  loadEnv(ROOT);

  const args = process.argv.slice(2);
  let verify = false;
  let fetchLogs = false;
  let list = false;
  let sandboxId = '';
  let content = '';
  let limit = 10;
  let lines = 100;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--verify':
        verify = true;
        break;
      case '--fetch':
        fetchLogs = true;
        break;
      case '--list':
        list = true;
        break;
      case '--sandbox-id':
        sandboxId = args[++i] || '';
        break;
      case '--content':
        content = args[++i] || '';
        break;
      case '--limit':
        limit = parseInt(args[++i] || '10', 10);
        break;
      case '--lines':
        lines = parseInt(args[++i] || '100', 10);
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }

  if (!verify && !fetchLogs && !list && !content) {
    printHelp();
    process.exit(1);
  }

  if (verify) {
    process.exit(await verifyPath());
  }

  if (!isSurrealDbConfigured()) {
    log.error('SURREALDB_URL not configured');
    process.exit(1);
  }

  if (list) {
    const rows = await getRecentSandboxLogs(sandboxId || undefined, limit);
    console.log(JSON.stringify({ count: rows.length, target: getSurrealDbTarget(), rows }, null, 2));
    process.exit(0);
  }

  if (content) {
    if (!sandboxId) {
      log.error('--sandbox-id required with --content');
      process.exit(1);
    }
    const logId = await logSandboxLogs({
      sandbox_id: sandboxId,
      provider: process.env.SANDBOX_PROVIDER || 'daytona',
      source: 'manual',
      content,
      line_count: content.split('\n').length,
      operation: 'manual',
    });
    console.log(JSON.stringify({ ok: true, logId, sandboxId }, null, 2));
    process.exit(0);
  }

  if (fetchLogs) {
    if (!sandboxId) {
      log.error('--sandbox-id required with --fetch');
      process.exit(1);
    }
    const client = new BasetenChainSandbox(getDefaultConfig());
    const response = await client.getSandboxLogs(sandboxId, lines);
    console.log(JSON.stringify({ persisted: true, response }, null, 2));
    process.exit(response.ok ? 0 : 1);
  }
}

main().catch((err) => {
  log.error('Fatal', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
