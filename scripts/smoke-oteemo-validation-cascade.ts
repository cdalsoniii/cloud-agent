/**
 * Oteemo validation cascade smoke: SHACL → Lean → GraphQL via tool_io_guard / px_validate_cascade.
 *
 *   npm run smoke:oteemo-cascade
 *   OTEEMO_CASCADE_OUT=.gsd/evidence/oteemo-validation-cascade npx tsx scripts/smoke-oteemo-validation-cascade.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import {
  handlePxSandboxCreate,
  handlePxSandboxDestroy,
  handlePxValidateCascade,
  handleToolIoGuard,
  customerPaths,
  getExampleCustomer,
  lakeBuildGeneratedOteemo,
} from '../src/verification-sandbox/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function outDir(): string {
  const env = process.env.OTEEMO_CASCADE_OUT?.trim();
  if (env) {
    fs.mkdirSync(env, { recursive: true });
    return env;
  }
  const d = path.join(ROOT, '.gsd/evidence/oteemo-validation-cascade');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

function writeJson(dir: string, name: string, v: unknown) {
  fs.writeFileSync(path.join(dir, name), JSON.stringify(v, null, 2));
}

function loadYaml(p: string): Record<string, unknown> {
  return parseYaml(fs.readFileSync(p, 'utf8')) as Record<string, unknown>;
}

async function main() {
  const dir = outDir();
  const failures: string[] = [];
  const customer = getExampleCustomer('oteemo-devsecops');
  if (!customer) throw new Error('oteemo-devsecops missing');
  const paths = customerPaths(customer);
  if (!paths) throw new Error('customerPaths null');

  const happyPath = path.join(paths.linkmlDir, 'fixtures/engagement.happy.yaml');
  const sadPath = path.join(paths.linkmlDir, 'fixtures/engagement.sad.yaml');
  const rules = path.join(paths.root, 'generated/oteemo.lean-rules.json');
  const resolvers = path.join(paths.root, 'generated/oteemo.resolvers.json');
  const artifacts = {
    metamodel: paths.metamodel,
    shacl: paths.shacl,
    happyPath,
    sadPath,
    leanRules: rules,
    resolvers,
    graphql: path.join(paths.root, 'generated/oteemo.graphql'),
  };
  writeJson(dir, 'artifacts.json', {
    ...artifacts,
    exists: Object.fromEntries(
      Object.entries(artifacts).map(([k, v]) => [k, fs.existsSync(String(v))]),
    ),
  });
  for (const [k, v] of Object.entries(artifacts)) {
    if (!fs.existsSync(String(v))) failures.push(`missing ${k}: ${v}`);
  }

  const lake = lakeBuildGeneratedOteemo(180_000);
  writeJson(dir, 'lake-build.json', lake);
  if (!lake.ok) failures.push(`lake build failed exit=${lake.exit}`);

  const happy = loadYaml(happyPath);
  const sad = loadYaml(sadPath);

  await handlePxSandboxCreate({ forceMock: true, pxRoot: paths.root, skipShacl: true });
  try {
    const happyCascade = await handlePxValidateCascade({
      data: happy,
      pack: 'oteemo',
      className: 'Engagement',
      force: true,
    });
    writeJson(dir, 'cascade-happy.json', happyCascade);
    if (!happyCascade.ok) {
      failures.push(`happy cascade expected ok, layers=${JSON.stringify(happyCascade.layers)}`);
    }
    const hl = happyCascade.layers as Record<string, { ok?: boolean; engine?: string }>;
    if (hl?.shacl && !hl.shacl.ok) failures.push('happy SHACL layer failed');
    if (hl?.lean && !hl.lean.ok) failures.push('happy Lean layer failed');
    if (hl?.graphql && !hl.graphql.ok) failures.push('happy GraphQL layer failed');

    const sadCascade = await handlePxValidateCascade({
      data: sad,
      pack: 'oteemo',
      className: 'Engagement',
      force: true,
      shortCircuit: true,
    });
    writeJson(dir, 'cascade-sad.json', sadCascade);
    if (sadCascade.ok) failures.push('sad cascade must not be ok');

    const pre = await handleToolIoGuard({
      tool: 'deploy_manifest',
      phase: 'pre',
      enforceSchema: true,
      pack: 'oteemo',
      className: 'Engagement',
      payload: happy,
    });
    writeJson(dir, 'tio-pre-happy.json', pre);
    if (!pre.ok) failures.push(`pre happy expected ok got ${JSON.stringify(pre.violations)}`);

    const post = await handleToolIoGuard({
      tool: 'scan_image',
      phase: 'post',
      enforceSchema: true,
      pack: 'oteemo',
      className: 'Engagement',
      payload: happy,
      result: sad,
    });
    writeJson(dir, 'tio-post-sad.json', post);
    if (post.ok) failures.push('post sad expected fail');

    const summary = {
      ok: failures.length === 0,
      failures,
      happyCascadeOk: happyCascade.ok,
      sadCascadeOk: sadCascade.ok,
      preOk: pre.ok,
      postOk: post.ok,
      lakeOk: lake.ok,
      layersHappy: hl,
    };
    writeJson(dir, 'summary.json', summary);
    console.log(JSON.stringify(summary, null, 2));
    if (failures.length) {
      console.error(failures.join('\n'));
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
