/**
 * Prove linkmlReasoning + usage log + px_linkml_usage.
 *   npm run smoke:linkml-reasoning
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse } from 'yaml';
import { resolvePxRoot } from '../src/verification-sandbox/px-pack.js';
import { buildLinkmlReasoning } from '../src/verification-sandbox/linkml-reasoning.js';
import { callVerificationMcpTool } from '../src/verification-sandbox/mcp-tools.js';
import { handleToolIoGuard } from '../src/verification-sandbox/handlers.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.gsd/evidence/px-pipeline-always');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const px = resolvePxRoot()!;
  const happyPath = path.join(px, 'linkml/oteemo/fixtures/engagement.happy.yaml');
  const happy = fs.existsSync(happyPath)
    ? parse(fs.readFileSync(happyPath, 'utf8'))
    : { engagement_id: 'e1', customer: { customer_id: 'c1' } };

  const direct = buildLinkmlReasoning({
    pack: 'oteemo',
    className: 'Engagement',
    tool: 'sdlc-batch',
    data: happy,
    pxRoot: px,
  });

  const guard = (await handleToolIoGuard({
    tool: 'sdlc-batch',
    phase: 'pre',
    pack: 'oteemo',
    className: 'Engagement',
    payload: happy,
    enforceSchema: true,
  })) as any;

  const usage = (await callVerificationMcpTool('px_linkml_usage', {
    limit: 10,
    pack: 'oteemo',
  })) as any;

  const logPath = path.join(ROOT, '.px/session/linkml-usage.jsonl');
  const logExists = fs.existsSync(logPath);

  const report = {
    ok:
      direct.mutations.some((m) => m.name === 'writeEngagement') &&
      (direct.classesUsed.includes('Engagement') || direct.classes.some((c) => c.name === 'Engagement' && c.used)) &&
      Boolean(guard?.linkmlReasoning?.narrative) &&
      Boolean(guard?.linkmlReasoning?.mutations) &&
      usage?.ok === true &&
      logExists &&
      (usage?.entries?.length ?? 0) > 0,
    direct: {
      classesUsed: direct.classesUsed.slice(0, 12),
      resolversUsed: direct.resolversUsed.slice(0, 12),
      mutationsReferenced: direct.mutationsReferenced,
      relationshipsUsedCount: direct.relationshipsUsed.length,
      mutationNames: direct.mutations.map((m) => m.name),
    },
    guardHasReasoning: Boolean(guard?.linkmlReasoning),
    guardOk: guard?.ok,
    usageCount: usage?.count,
    usageLast: usage?.entries?.slice(-1)?.[0],
    logPath,
  };

  fs.writeFileSync(path.join(OUT, 'linkml-reasoning-smoke.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
