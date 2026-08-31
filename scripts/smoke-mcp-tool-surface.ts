/**
 * Assert Mastra MCP surface includes full verification registry + always-on tools.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { VERIFICATION_MCP_TOOLS, VERIFICATION_MCP_SCHEMAS } from '../src/verification-sandbox/mcp-tools.js';
import {
  callVerificationMcpTool,
} from '../src/verification-sandbox/mcp-tools.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../.gsd/evidence/px-pipeline-always');
fs.mkdirSync(OUT, { recursive: true });

async function main() {
  const names = VERIFICATION_MCP_TOOLS.map((t) => t.name);
  const schemaNames = Object.keys(VERIFICATION_MCP_SCHEMAS);
  const missingSchema = names.filter((n) => !schemaNames.includes(n));
  const extraSchema = schemaNames.filter((n) => !names.includes(n));

  const required = [
    'tool_io_guard',
    'px_validate_cascade',
    'px_ontology_scope',
    'px_pipeline_ready',
    'px_pack_resolve',
    'px_shacl_validate',
    'px_sandbox_create',
  ];
  const missingRequired = required.filter((n) => !names.includes(n));

  const scopeSkydio = (await callVerificationMcpTool('px_ontology_scope', {
    text: 'How do I get promoted at Skydio?',
    tool: 'request_promotion_review',
  })) as any;

  const scopeOteemo = (await callVerificationMcpTool('px_ontology_scope', {
    pack: 'oteemo',
  })) as any;

  const ready = (await callVerificationMcpTool('px_pipeline_ready', {
    packs: ['oteemo', 'skydio'],
  })) as any;

  const packResolve = (await callVerificationMcpTool('px_pack_resolve', {
    text: 'X10 dock remote ops postmortem',
  })) as any;

  // enforceSchema default: omit flag
  const { handlePxSandboxCreate, handlePxSandboxDestroy, handleToolIoGuard } = await import(
    '../src/verification-sandbox/handlers.js'
  );
  const { resolvePxRoot } = await import('../src/verification-sandbox/px-pack.js');
  const { parse } = await import('yaml');
  const px = resolvePxRoot()!;
  const happy = parse(
    fs.readFileSync(path.join(px, 'linkml/oteemo/fixtures/engagement.happy.yaml'), 'utf8'),
  );
  await handlePxSandboxCreate({ forceMock: true, pxRoot: px, skipShacl: true });
  let defaultEnforce: any;
  try {
    defaultEnforce = await handleToolIoGuard({
      tool: 'deploy_manifest',
      phase: 'pre',
      pack: 'oteemo',
      payload: happy,
      // enforceSchema omitted → should cascade
    });
  } finally {
    await handlePxSandboxDestroy();
  }

  const report = {
    ok:
      missingSchema.length === 0 &&
      missingRequired.length === 0 &&
      scopeSkydio?.relevantOntologyTag === 'there_is_one_relevant_ontology' &&
      scopeSkydio?.ontologyHookContext?.pack === 'skydio' &&
      scopeOteemo?.relevantOntologyTag === 'there_is_one_relevant_ontology' &&
      ready?.packs?.oteemo &&
      packResolve?.pack === 'skydio' &&
      defaultEnforce?.ontologyHookContext &&
      defaultEnforce?.ok === true,
    registryNames: names,
    missingSchema,
    extraSchema,
    missingRequired,
    scopeSkydio: {
      tag: scopeSkydio?.relevantOntologyTag,
      pack: scopeSkydio?.ontologyHookContext?.pack,
      count: scopeSkydio?.relevantOntologyCount,
    },
    scopeOteemo: {
      tag: scopeOteemo?.relevantOntologyTag,
      pack: scopeOteemo?.ontologyHookContext?.pack,
    },
    packResolve,
    ready: { ok: ready?.ok, ready: ready?.ready, ontologyEnforcement: ready?.ontologyEnforcement },
    defaultEnforce: {
      ok: defaultEnforce?.ok,
      hasContext: Boolean(defaultEnforce?.ontologyHookContext),
      hasCascade: Boolean(defaultEnforce?.cascade?.pre || defaultEnforce?.cascade),
    },
  };

  fs.writeFileSync(path.join(OUT, 'mcp-surface.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
