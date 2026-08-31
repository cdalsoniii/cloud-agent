/**
 * Prove validation I/O is written to host Surreal + queryable via MCP handler.
 *
 *   bash scripts/surreal-stack.sh start
 *   export SURREALDB_URL=http://127.0.0.1:8000
 *   npm run smoke:validation-io-surreal
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { resolvePxRoot } from '../src/verification-sandbox/px-pack.js';
import { handleToolIoGuard, handlePxValidationCalls } from '../src/verification-sandbox/handlers.js';
import { callVerificationMcpTool } from '../src/verification-sandbox/mcp-tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.gsd/evidence/px-pipeline-always');

async function main() {
  process.env.SURREALDB_URL =
    process.env.SURREALDB_URL || 'http://127.0.0.1:8000';
  process.env.SURREALDB_NS = process.env.SURREALDB_NS || 'main';
  process.env.SURREALDB_DB = process.env.SURREALDB_DB || 'main';
  process.env.SURREALDB_USER = process.env.SURREALDB_USER || 'root';
  process.env.SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';

  const px = resolvePxRoot()!;
  const happyPath = path.join(px, 'linkml/oteemo/fixtures/engagement.happy.yaml');
  const happy = fs.existsSync(happyPath)
    ? parse(fs.readFileSync(happyPath, 'utf8'))
    : { engagement_id: 'e1' };

  const guard = (await handleToolIoGuard({
    tool: 'sdlc-batch',
    phase: 'pre',
    pack: 'oteemo',
    className: 'Engagement',
    payload: happy,
    enforceSchema: true,
  })) as any;

  // brief wait for Surreal index
  await new Promise((r) => setTimeout(r, 200));

  const calls = (await handlePxValidationCalls({
    limit: 10,
    pack: 'oteemo',
    includeEndpointIo: true,
  })) as any;

  const mcp = (await callVerificationMcpTool('px_validation_calls', {
    limit: 5,
    pack: 'oteemo',
  })) as any;

  const jsonl = path.join(ROOT, '.px/session/validation-calls.jsonl');
  const report = {
    ok:
      Boolean(guard?.validationCallId) &&
      guard?.validationIoSurreal === true &&
      calls?.source === 'surreal' &&
      (calls?.entries?.length ?? 0) > 0 &&
      mcp?.ok === true &&
      fs.existsSync(jsonl),
    guard: {
      validationCallId: guard?.validationCallId,
      validationIoSurreal: guard?.validationIoSurreal,
      ok: guard?.ok,
    },
    calls: {
      source: calls?.source,
      surreal: calls?.surreal,
      count: calls?.count,
      firstCallId: calls?.entries?.[0]?.call_id,
      endpointIoCount: calls?.endpointIo?.entries?.length ?? calls?.endpointIo?.count,
    },
    mcpOk: mcp?.ok,
    jsonlExists: fs.existsSync(jsonl),
  };

  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(
    path.join(OUT, 'validation-io-surreal-smoke.json'),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
