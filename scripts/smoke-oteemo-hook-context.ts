/**
 * Host smoke: tool_io_guard pre/post returns ontologyHookContext.
 *
 *   npx tsx scripts/smoke-oteemo-hook-context.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  handlePxSandboxCreate,
  handlePxSandboxDestroy,
  handleToolIoGuard,
  resolvePxRoot,
} from '../src/verification-sandbox/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(__dirname, '../.gsd/evidence/oteemo-hook-context');
fs.mkdirSync(OUT, { recursive: true });

function slimCtx(c: any) {
  if (!c) return null;
  if (c.pre || c.post) {
    return { pre: slimCtx(c.pre), post: slimCtx(c.post) };
  }
  return {
    phase: c.phase,
    tool: c.tool,
    pack: c.pack,
    className: c.className,
    endpoint: c.endpoint,
    ontologies: c.ontologies,
    guardrails: c.guardrails?.map((g: any) => ({ name: g.name, kind: g.kind, port: g.port })),
    shapes: c.shapes?.map((s: any) => ({ shapeId: s.shapeId, targetClass: s.targetClass, source: s.source })),
    relationships: c.relationships?.slice(0, 12),
    cascadeLayers: c.cascadeLayers,
  };
}

async function main() {
  const px = resolvePxRoot()!;
  const happy = parseYaml(
    fs.readFileSync(path.join(px, 'linkml/oteemo/fixtures/engagement.happy.yaml'), 'utf8'),
  );
  const sad = parseYaml(
    fs.readFileSync(path.join(px, 'linkml/oteemo/fixtures/engagement.sad.yaml'), 'utf8'),
  );

  await handlePxSandboxCreate({ forceMock: true, pxRoot: px, skipShacl: true });
  try {
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
    fs.writeFileSync(path.join(OUT, 'pre.json'), JSON.stringify(slimCtx(preCtx), null, 2));
    fs.writeFileSync(path.join(OUT, 'post.json'), JSON.stringify(slimCtx(postCtx), null, 2));
    fs.writeFileSync(
      path.join(OUT, 'summary.json'),
      JSON.stringify(
        {
          preOk: pre.ok,
          postOk: post.ok,
          preHasContext: Boolean(preCtx?.ontologies?.length),
          postHasContext: Boolean(postCtx?.ontologies?.length),
          preShapes: preCtx?.shapes?.length,
          preRels: preCtx?.relationships?.length,
          preGuardrails: preCtx?.guardrails?.length,
        },
        null,
        2,
      ),
    );

    const fail: string[] = [];
    if (!preCtx?.ontologies?.some((o: any) => o.pack === 'oteemo')) fail.push('pre missing oteemo ontology');
    if (!preCtx?.shapes?.some((s: any) => s.targetClass === 'Engagement')) fail.push('pre missing Engagement shape');
    if (!preCtx?.relationships?.length) fail.push('pre missing relationships');
    if (!preCtx?.guardrails?.some((g: any) => g.kind === 'guardrails_ai')) fail.push('pre missing GuardrailsAI names');
    if (!preCtx?.guardrails?.some((g: any) => g.kind === 'formal_service')) fail.push('pre missing formal guardrails');
    if (!postCtx?.ontologies?.length) fail.push('post missing context');
    if (pre.ok !== true) fail.push('pre should pass happy');
    if (post.ok !== false) fail.push('post should fail sad');

    console.log(JSON.stringify({ ok: fail.length === 0, fail, summary: JSON.parse(fs.readFileSync(path.join(OUT, 'summary.json'), 'utf8')) }, null, 2));
    if (fail.length) process.exit(1);
  } finally {
    await handlePxSandboxDestroy({});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
