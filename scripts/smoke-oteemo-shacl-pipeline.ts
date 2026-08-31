/**
 * Oteemo LinkML → SHACL → pre/post tool_io_guard pipeline smoke.
 *
 * Drives shipped handlers (mock sandbox + invokeShacl / tool_io_guard), not a
 * reimplemented checker. Fixtures from assistant-ui .px/linkml/oteemo.
 *
 *   npx tsx scripts/smoke-oteemo-shacl-pipeline.ts
 *   OTEEMO_PIPELINE_OUT=/path/to/dir npx tsx scripts/smoke-oteemo-shacl-pipeline.ts
 *
 * Exit 0 only when happy conforms, sad does not, pre allows, post blocks —
 * and SHACL engine is pyshacl (not mock green-light).
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  handlePxSandboxCreate,
  handlePxSandboxDestroy,
  handlePxShaclValidate,
  handleToolIoGuard,
  resolvePxRoot,
  getExampleCustomer,
  customerPaths,
} from '../src/verification-sandbox/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function outDir(): string {
  const env = process.env.OTEEMO_PIPELINE_OUT?.trim();
  if (env) {
    fs.mkdirSync(env, { recursive: true });
    return env;
  }
  const d = path.join(ROOT, '.gsd/evidence');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeJson(dir: string, name: string, value: unknown): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(value, null, 2));
  return p;
}

function loadYaml(file: string): Record<string, unknown> {
  const raw = fs.readFileSync(file, 'utf8');
  const data = parseYaml(raw);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`expected YAML object: ${file}`);
  }
  return data as Record<string, unknown>;
}

function loadJson(file: string): Record<string, unknown> {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')) as unknown;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error(`expected JSON object: ${file}`);
  }
  return data as Record<string, unknown>;
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main(): Promise<void> {
  const dir = outDir();
  const runTag = process.env.OTEEMO_PIPELINE_RUN || '1';
  const failures: string[] = [];

  const customer = getExampleCustomer('oteemo-devsecops');
  assert(customer, 'example customer oteemo-devsecops missing');
  const paths = customerPaths(customer);
  assert(paths, 'customerPaths null — resolvePxRoot failed');

  const artifactLines = [
    `pxRoot=${paths.root}`,
    `metamodel=${paths.metamodel} exists=${fs.existsSync(paths.metamodel)}`,
    `instance=${paths.instance} exists=${paths.instance ? fs.existsSync(paths.instance) : false}`,
    `shacl=${paths.shacl} exists=${fs.existsSync(paths.shacl)}`,
    `linkmlDir=${paths.linkmlDir}`,
  ];
  const fixturesDir = path.join(paths.linkmlDir, 'fixtures');
  const happyPath = path.join(fixturesDir, 'engagement.happy.yaml');
  const sadPath = path.join(fixturesDir, 'engagement.sad.yaml');
  const prePath = path.join(fixturesDir, 'assumption-pre.happy.json');
  const postPath = path.join(fixturesDir, 'assumption-post.sad.json');
  for (const p of [happyPath, sadPath, prePath, postPath, paths.metamodel, paths.shacl]) {
    artifactLines.push(`${p} exists=${fs.existsSync(p)}`);
    if (!fs.existsSync(p)) failures.push(`missing artifact: ${p}`);
  }
  fs.writeFileSync(path.join(dir, 'oteemo-pipeline-artifacts.txt'), artifactLines.join('\n') + '\n');

  if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(2);
  }

  const happy = loadYaml(happyPath);
  const sad = loadYaml(sadPath);
  const preFixture = loadJson(prePath);
  const postFixture = loadJson(postPath);
  // Pre: validate the nested engagement (or full happy) — structural Engagement root.
  const prePayload =
    preFixture.engagement && typeof preFixture.engagement === 'object'
      ? (preFixture.engagement as Record<string, unknown>)
      : happy;
  // Post: sad engagement (critical/incomplete) or post fixture as non-conformant structured result.
  const postResult = sad;

  const create = await handlePxSandboxCreate({
    forceMock: true,
    pxRoot: paths.root,
    skipShacl: true,
  });
  assert(create.ok !== false || create.sandboxId, `sandbox create failed: ${JSON.stringify(create)}`);

  try {
    // --- 1/2 happy SHACL (run twice for stability) ---
    const happyResults: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 2; i++) {
      const h = (await handlePxShaclValidate({
        data: happy,
        pack: 'oteemo',
        className: 'Engagement',
        force: true,
      })) as Record<string, unknown>;
      happyResults.push(h);
      writeJson(dir, i === 0 ? 'oteemo-shacl-happy.json' : `oteemo-shacl-happy-run2.json`, h);
    }
    const h0 = happyResults[0];
    const h1 = happyResults[1];
    if (h0.conforms !== true) {
      failures.push(`happy SHACL expected conforms true, got ${JSON.stringify({ conforms: h0.conforms, engine: h0.engine, error: h0.error, violations: h0.violations })}`);
    }
    if (h0.engine === 'mock') {
      failures.push('happy SHACL used mock engine — pySHACL path did not run (install pySHACL / check shapes)');
      fs.writeFileSync(
        path.join(dir, 'oteemo-pyshacl-unavailable.txt'),
        `engine=mock\nresult=${JSON.stringify(h0, null, 2)}\n`,
      );
    }
    if (Boolean(h0.conforms) !== Boolean(h1.conforms)) {
      failures.push(`happy SHACL run1/run2 disagree: ${h0.conforms} vs ${h1.conforms}`);
    }

    // --- 3 sad SHACL (twice) ---
    const sadResults: Array<Record<string, unknown>> = [];
    for (let i = 0; i < 2; i++) {
      const s = (await handlePxShaclValidate({
        data: sad,
        pack: 'oteemo',
        className: 'Engagement',
        force: true,
      })) as Record<string, unknown>;
      sadResults.push(s);
      writeJson(dir, i === 0 ? 'oteemo-shacl-sad.json' : `oteemo-shacl-sad-run2.json`, s);
    }
    const s0 = sadResults[0];
    const s1 = sadResults[1];
    const sadViols = Array.isArray(s0.violations) ? s0.violations : [];
    if (s0.conforms !== false) {
      failures.push(`sad SHACL expected conforms false, got ${s0.conforms} engine=${s0.engine}`);
    }
    if (sadViols.length < 1) {
      failures.push('sad SHACL expected ≥1 violation');
    }
    if (Boolean(s0.conforms) !== Boolean(s1.conforms)) {
      failures.push(`sad SHACL run1/run2 disagree: ${s0.conforms} vs ${s1.conforms}`);
    }

    // --- 4 pre tool_io_guard ---
    const pre = (await handleToolIoGuard({
      tool: 'deploy_manifest',
      phase: 'pre',
      enforceSchema: true,
      pack: 'oteemo',
      payload: prePayload,
    })) as Record<string, unknown>;
    writeJson(dir, 'oteemo-tio-pre.json', pre);
    if (pre.skipped === true || pre.ontologyEnforcement === false) {
      failures.push(
        `pre tool_io_guard skipped enforcement (not a pipeline pass): ${JSON.stringify({ skipped: pre.skipped, ontologyEnforcement: pre.ontologyEnforcement })}`,
      );
    } else {
      const preSchema = (pre.schema || {}) as { pre?: { conforms?: boolean; engine?: string } };
      const engine = preSchema.pre?.engine || 'unknown';
      if (engine === 'mock' && pre.ok === true) {
        failures.push('pre tool_io_guard mock must not green-light oteemo');
      }
      if (pre.ok !== true) {
        failures.push(
          `pre tool_io_guard expected ok true for happy engagement, got ok=${pre.ok} schema=${JSON.stringify(preSchema)}`,
        );
      }
      if (preSchema.pre && preSchema.pre.conforms !== true) {
        failures.push(`pre schema.pre.conforms expected true, got ${preSchema.pre.conforms}`);
      }
    }

    // --- 5 post tool_io_guard (sad / critical structure) ---
    const post = (await handleToolIoGuard({
      tool: 'scan_image',
      phase: 'post',
      enforceSchema: true,
      pack: 'oteemo',
      payload: prePayload,
      result: postResult,
    })) as Record<string, unknown>;
    writeJson(dir, 'oteemo-tio-post.json', {
      ...post,
      _note: 'result=sad engagement; postFixture also available',
      postFixtureKeys: Object.keys(postFixture),
    });
    if (post.skipped === true) {
      failures.push('post tool_io_guard skipped — not a pipeline pass');
    } else {
      const postSchema = (post.schema || {}) as { post?: { conforms?: boolean; engine?: string; violations?: unknown[] } };
      const viols = Array.isArray(post.violations) ? post.violations : [];
      const blocking = viols.filter(
        (v) => v && typeof v === 'object' && (v as { severity?: string }).severity === 'blocking',
      );
      if (post.ok === true && blocking.length === 0) {
        failures.push(
          `post tool_io_guard expected SHACL/schema failure or blocking violations; got ok=true empty blocking. schema.post=${JSON.stringify(postSchema.post)}`,
        );
      }
      if (postSchema.post?.engine === 'mock' && post.ok === true) {
        failures.push('post mock must not green-light oteemo');
      }
      if (postSchema.post && postSchema.post.conforms === true) {
        failures.push('post schema.post.conforms expected false for sad engagement');
      }
    }

    // --- mock-only fail-closed probe (engine mock path via invalid shapes force is hard; assert happy without fleet_id would fail if mock) ---
    // Document: if engine were mock, happy oteemo must not pass — covered when engine=mock on happy above.

    const summary = {
      runTag,
      ok: failures.length === 0,
      failures,
      happyConforms: h0.conforms,
      happyEngine: h0.engine,
      sadConforms: s0.conforms,
      sadViolationCount: sadViols.length,
      preOk: pre.ok,
      postOk: post.ok,
      pxRoot: resolvePxRoot(paths.root),
    };
    writeJson(dir, `oteemo-pipeline-summary-run${runTag}.json`, summary);
    console.log(JSON.stringify(summary, null, 2));

    if (failures.length) {
      console.error('FAILURES:\n' + failures.join('\n'));
      process.exit(1);
    }
  } finally {
    await handlePxSandboxDestroy({});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
