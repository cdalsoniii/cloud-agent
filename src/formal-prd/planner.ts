import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { smartCallChain } from '../chain-portfolio.js';
import { ingestAssistantUiContext, resolveAssistantUiDir } from './ingest.js';
import { interpretRequestLocal, slugFromRequest } from './interpret.js';
import {
  buildMilestones,
  expandIssues,
  parseChainIssueSuggestions,
} from './expand-issues.js';
import { buildJobsFromMilestones, writePlanningPack } from './write.js';
import type { PlannerOptions, PlanningPack } from './types.js';

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));

function asText(output: Record<string, unknown>): string {
  if (typeof output.markdown === 'string') return output.markdown;
  if (typeof output.text === 'string') return output.text;
  if (typeof output.prd === 'string') return output.prd;
  if (typeof output.analysis === 'string') return output.analysis;
  if (typeof output.research === 'string') return output.research;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function localAnalysis(
  request: string,
  context: ReturnType<typeof ingestAssistantUiContext>,
  interpreted: ReturnType<typeof interpretRequestLocal>,
): string {
  const gapIds = [
    ...new Set(Object.values(context.docs).flatMap((d) => d.gap_ids)),
  ].slice(0, 20);
  return [
    '# Comprehensive analysis (local fallback)',
    '',
    `## Request`,
    '',
    request,
    '',
    '## Intent',
    '',
    interpreted.intent,
    '',
    '## Grounded inventory',
    '',
    `- Verify APIs: ${context.verify_apis.join(', ') || '(none)'}`,
    `- Verification dirs: ${context.verification_dirs.join(', ') || '(none)'}`,
    `- CI: ${context.ci_workflows.join(', ') || '(none)'}`,
    `- npm scripts: ${context.npm_scripts.join(', ') || '(none)'}`,
    `- Gap IDs sampled: ${gapIds.join(', ') || '(none)'}`,
    '',
    '## Risks / potential problems',
    '',
    '1. **Toolchain env drift** — `DAFNY2JS_PATH` / `DAFNY_REPLAY_PATH` / `dotnet` missing in CI vs laptop.',
    '2. **Spec drift** — generated kernels out of date vs `config/verification/dafny` sources.',
    '3. **False happy path** — Speakeasy Petstore E2E mistaken for formal stack coverage.',
    '4. **Gate bypass** — Midspiral claimcheck not wired on all chat/build entrypoints.',
    '5. **Partial API surface** — dafny2js/dafny-replay succeed in isolation but kernels not consumed at runtime.',
    '',
    '## Dependency graph (happy path)',
    '',
    '```',
    'dafny verify → dafny translate js → verified-kernels',
    '  → /api/verify/dafny2js + /api/verify/dafny-replay',
    '  → createKernel Inv (Do/Undo/Redo)',
    '  → Midspiral claimcheck',
    '  → formal-verification CI + formal E2E',
    '```',
    '',
    '## Forced themes',
    '',
    ...context.forced_themes.map((t) => `- ${t}`),
    '',
  ].join('\n');
}

function localPrd(
  interpreted: ReturnType<typeof interpretRequestLocal>,
  analysis: string,
): string {
  return [
    '# PRD: Formal happy-path enforcement (assistant-ui)',
    '',
    '## Problem',
    '',
    interpreted.intent,
    '',
    '## Goals',
    '',
    ...interpreted.success_criteria.map((c, i) => `${i + 1}. ${c}`),
    '',
    '## Non-goals (v1)',
    '',
    '- Auto-creating GitHub Issues from this pack',
    '- Full Lean/Apalache expansion beyond existing stubs',
    '',
    '## Scope',
    '',
    '- dafny2js API + toolchain',
    '- dafny-replay API + Replay.dfy / lemmafit path',
    '- verified-kernels runtime Inv',
    '- Midspiral + CI formal-verification workflow',
    '',
    '## Analysis summary',
    '',
    analysis.split('\n').slice(0, 40).join('\n'),
    '',
    '## Delivery',
    '',
    'Milestones M0–M3 in `06-MILESTONES.md`; issues in `03-ISSUE_BACKLOG.md`.',
    '',
  ].join('\n');
}

function localSpecs(): Record<string, string> {
  return {
    'happy-path.md': [
      '# Spec: Formal happy path',
      '',
      '## Flow',
      '',
      '1. `dafny verify` on Replay + verification modules',
      '2. `dafny translate js` → `packages/verified-kernels/generated`',
      '3. `POST /api/verify/dafny2js` succeeds',
      '4. `POST /api/verify/dafny-replay` verify|compile|verify-app',
      '5. Kernel Do/Undo/Redo preserve Inv',
      '6. Midspiral claimcheck rejects bad claims',
      '7. CI formal-verification.yml green',
      '',
    ].join('\n'),
    'dafny2js.md': [
      '# Spec: dafny2js API',
      '',
      '- Route: `packages/web/src/app/api/verify/dafny2js`',
      '- Env: `DAFNY2JS_PATH`, `dotnet` available',
      '- Contract: structured JSON success/failure; no silent fallback to unverified JS',
      '',
    ].join('\n'),
    'dafny-replay.md': [
      '# Spec: dafny-replay API',
      '',
      '- Route: `packages/web/src/app/api/verify/dafny-replay`',
      '- Modes: verify, compile, verify-app',
      '- Sources: `config/verification/**/Replay.dfy` + lemmafit',
      '',
    ].join('\n'),
    'stack-enforcement.md': [
      '# Spec: Stack enforcement',
      '',
      '- Offline proofs are SSOT; runtime kernels must match generated outputs',
      '- Any behavioral change updates Quint/Alloy/Dafny under `config/verification/`',
      '- CI must run Dafny + package build for verified-kernels',
      '',
    ].join('\n'),
  };
}

/** Run the full planning pipeline and write artifacts. */
export async function runFormalPrdPlanner(
  options: PlannerOptions,
): Promise<PlanningPack> {
  const cloudAgentRoot =
    options.cloudAgentRoot || path.resolve(MODULE_DIR, '../..');
  const assistantRoot = resolveAssistantUiDir(
    options.target,
    cloudAgentRoot,
    options.assistantUiDir || process.env.ASSISTANT_UI_DIR,
  );
  const slug = slugFromRequest(options.request, options.slug);
  const outDir = path.join(cloudAgentRoot, 'artifacts', 'prd', slug);

  const interpreted = interpretRequestLocal(options.request);
  const context = ingestAssistantUiContext(assistantRoot, options.target);

  const providers: Record<string, string> = {};

  let researchOut: Record<string, unknown> = {};
  if (options.dryRun) {
    providers.research = 'dry-run';
    researchOut = {
      markdown: localAnalysis(options.request, context, interpreted),
      issues: [],
    };
  } else {
    const research = await smartCallChain(
      'deep-research-brief',
      {
        task: options.request,
        product: 'assistant-ui',
        interpreted,
        context_summary: {
          verify_apis: context.verify_apis,
          verification_dirs: context.verification_dirs,
          gap_ids: Object.values(context.docs).flatMap((d) => d.gap_ids),
          forced_themes: context.forced_themes,
        },
      },
      {
        timeout_sec: 120,
        fallback_fn: async () => ({
          markdown: localAnalysis(options.request, context, interpreted),
          issues: [],
        }),
      },
    );
    providers.research = research.provider;
    researchOut = research.output;
  }

  const analysisMarkdown =
    asText(researchOut).includes('#')
      ? asText(researchOut)
      : localAnalysis(options.request, context, interpreted);

  const chainIssues = parseChainIssueSuggestions(researchOut);
  const issues = expandIssues(interpreted, context, chainIssues);
  const milestones = buildMilestones(issues);

  let prdMarkdown = '';
  if (options.dryRun) {
    providers.prd = 'dry-run';
    prdMarkdown = localPrd(interpreted, analysisMarkdown);
  } else {
    const prd = await smartCallChain(
      'prd-from-analysis',
      {
        request: options.request,
        interpreted,
        analysis: analysisMarkdown,
        issues: issues.slice(0, 30),
        milestones,
      },
      {
        timeout_sec: 120,
        fallback_fn: async () => ({
          markdown: localPrd(interpreted, analysisMarkdown),
        }),
      },
    );
    providers.prd = prd.provider;
    prdMarkdown = asText(prd.output);
    if (!prdMarkdown.includes('PRD') && !prdMarkdown.includes('#')) {
      prdMarkdown = localPrd(interpreted, analysisMarkdown);
    }
  }

  let specs = localSpecs();
  if (!options.dryRun) {
    const spec = await smartCallChain(
      'spec-from-research',
      {
        research: { analysis: analysisMarkdown, interpreted },
        focus: ['happy-path', 'dafny2js', 'dafny-replay', 'stack-enforcement'],
      },
      {
        timeout_sec: 90,
        fallback_fn: async () => ({ specs: localSpecs() }),
      },
    );
    providers.specs = spec.provider;
    if (spec.output.specs && typeof spec.output.specs === 'object') {
      specs = { ...specs, ...(spec.output.specs as Record<string, string>) };
    } else if (typeof spec.output.markdown === 'string') {
      specs['from-chain.md'] = spec.output.markdown;
    }
  } else {
    providers.specs = 'dry-run';
  }

  const pack: PlanningPack = {
    slug,
    outDir,
    interpreted,
    context,
    analysisMarkdown,
    issues,
    prdMarkdown,
    specs,
    milestones,
    chainMeta: { dryRun: options.dryRun, providers },
  };

  if (options.writeJobs) {
    pack.jobs = buildJobsFromMilestones(pack);
  }

  writePlanningPack(pack);

  if (options.writeJobs && pack.jobs) {
    const jobsPath = path.join(
      cloudAgentRoot,
      'pybatch',
      `jobs-from-prd-${slug}.json`,
    );
    const fs = await import('node:fs');
    fs.writeFileSync(jobsPath, JSON.stringify(pack.jobs, null, 2), 'utf8');
  }

  return pack;
}
