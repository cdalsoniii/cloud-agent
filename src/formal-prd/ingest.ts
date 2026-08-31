import fs from 'node:fs';
import path from 'node:path';
import type { ContextBundle } from './types.js';

const DOC_CANDIDATES = [
  '.gap-analysis.md',
  '.plan.md',
  'formal-validation-stack.plan.md',
  'DAFNYJS_VERIFICATION_REPORT.md',
  'SPEC.md',
  'ARCHITECTURE.md',
];

const FORCED_THEMES = [
  'Prove Dafny (Replay.dfy + config/verification/dafny)',
  'build:dafny / translate JS → packages/verified-kernels',
  'POST /api/verify/dafny2js happy path (DAFNY2JS_PATH)',
  'POST /api/verify/dafny-replay verify/compile/verify-app',
  'Kernel runtime Inv (Do/Undo/Redo)',
  'Midspiral claimcheck gate on chat/build',
  'CI formal-verification.yml green',
  'Gap closure from .gap-analysis.md (DF/QW/M blocking happy path)',
  'E2E formal happy-path test (not Speakeasy Petstore)',
];

function excerpt(text: string, max = 2400): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n…[truncated]…`;
}

function extractGapIds(text: string): string[] {
  const ids = new Set<string>();
  for (const m of text.matchAll(/\b((?:QW|M|DF)-\d+)\b/g)) {
    ids.add(m[1]!);
  }
  return [...ids].sort();
}

function listDirNames(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() || d.isFile())
    .map((d) => d.name)
    .sort();
}

function readPackageScripts(root: string): string[] {
  const pkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(pkgPath)) return [];
  try {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const keys = Object.keys(pkg.scripts || {});
    return keys.filter(
      (k) =>
        k.includes('dafny') ||
        k.includes('verify') ||
        k.includes('formal') ||
        k.includes('lemma'),
    );
  } catch {
    return [];
  }
}

/** Resolve assistant-ui root from target name or absolute path. */
export function resolveAssistantUiDir(
  target: string,
  cloudAgentRoot: string,
  override?: string,
): string {
  if (override && fs.existsSync(override)) return path.resolve(override);
  if (path.isAbsolute(target) && fs.existsSync(target)) return target;
  const sibling = path.resolve(cloudAgentRoot, '../../02-products/assistant-ui');
  if (target === 'assistant-ui' || target === 'default') {
    if (fs.existsSync(sibling)) return sibling;
  }
  const env = process.env.ASSISTANT_UI_DIR;
  if (env && fs.existsSync(env)) return path.resolve(env);
  return sibling;
}

/** Deterministic grounding pack from assistant-ui on disk. */
export function ingestAssistantUiContext(
  root: string,
  target = 'assistant-ui',
): ContextBundle {
  const docs: ContextBundle['docs'] = {};
  for (const rel of DOC_CANDIDATES) {
    const full = path.join(root, rel);
    if (!fs.existsSync(full)) continue;
    const text = fs.readFileSync(full, 'utf8');
    docs[rel] = {
      path: full,
      excerpt: excerpt(text),
      gap_ids: extractGapIds(text),
    };
  }

  const verifyApiDir = path.join(root, 'packages/web/src/app/api/verify');
  const verify_apis = listDirNames(verifyApiDir).filter(
    (n) => n !== 'route.ts' && !n.startsWith('.'),
  );

  const verificationRoot = path.join(root, 'config/verification');
  const verification_dirs = listDirNames(verificationRoot);

  const kernels: string[] = [];
  const vk = path.join(root, 'packages/verified-kernels');
  if (fs.existsSync(vk)) {
    kernels.push('packages/verified-kernels');
    const gen = path.join(vk, 'generated');
    if (fs.existsSync(gen)) {
      kernels.push(
        ...listDirNames(gen)
          .filter((f) => f.endsWith('.cjs') || f.endsWith('.js'))
          .map((f) => `packages/verified-kernels/generated/${f}`),
      );
    }
  }
  const webVk = path.join(root, 'packages/web/src/lib/verified-kernels');
  if (fs.existsSync(webVk)) kernels.push('packages/web/src/lib/verified-kernels');

  const ciDir = path.join(root, '.github/workflows');
  const ci_workflows = listDirNames(ciDir).filter(
    (f) => f.includes('formal') || f.includes('verify'),
  );

  return {
    target,
    root,
    docs,
    verify_apis,
    verification_dirs,
    kernels,
    ci_workflows,
    npm_scripts: readPackageScripts(root),
    forced_themes: FORCED_THEMES,
  };
}

export { FORCED_THEMES, extractGapIds };
