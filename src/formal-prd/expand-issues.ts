import type { ContextBundle, ExpandedIssue, InterpretedRequest, Milestone } from './types.js';
import { FORCED_THEMES } from './ingest.js';

function severityForTheme(theme: string): ExpandedIssue['severity'] {
  if (/dafny2js|dafny-replay|prove|kernel|ci/i.test(theme)) return 'critical';
  if (/midspiral|gap|e2e/i.test(theme)) return 'high';
  return 'medium';
}

function milestoneForIndex(i: number): string {
  if (i < 3) return 'M0';
  if (i < 6) return 'M1';
  if (i < 9) return 'M2';
  return 'M3';
}

/** Seed issues from forced themes + gap IDs + optional chain suggestions. */
export function expandIssues(
  interpreted: InterpretedRequest,
  context: ContextBundle,
  chainSuggestions: Array<Partial<ExpandedIssue>> = [],
): ExpandedIssue[] {
  const issues: ExpandedIssue[] = [];
  let n = 1;

  for (const theme of FORCED_THEMES) {
    const id = `FORMAL-${String(n).padStart(3, '0')}`;
    n += 1;
    issues.push({
      id,
      title: theme,
      severity: severityForTheme(theme),
      description: `Grounded planning issue for assistant-ui formal happy path: ${theme}. Request themes: ${interpreted.themes.join(', ')}.`,
      acceptance_criteria: [
        'Documented steps reproducible locally and in CI',
        'Failure modes and env deps (DAFNY2JS_PATH / DAFNY_REPLAY_PATH) captured',
        'Linked formal artifacts under config/verification or packages/verified-kernels updated when behavior changes',
      ],
      formal_artifacts: pickArtifacts(theme, context),
      milestone: milestoneForIndex(issues.length),
      source: 'forced-theme',
    });
  }

  const gapIds = new Set<string>();
  for (const doc of Object.values(context.docs)) {
    for (const g of doc.gap_ids) gapIds.add(g);
  }
  // Prefer DF/QW/M that block happy path
  const prioritized = [...gapIds].filter((g) => /^(DF|QW|M)-/.test(g)).slice(0, 12);
  for (const gap of prioritized) {
    const id = `GAP-${gap}`;
    if (issues.some((i) => i.id === id)) continue;
    issues.push({
      id,
      title: `Close gap ${gap} blocking formal happy path`,
      severity: gap.startsWith('DF') ? 'critical' : 'high',
      description: `From assistant-ui gap analysis: ${gap}. Must be addressed for dafny2js / dafny-replay / stack enforcement.`,
      acceptance_criteria: [
        `${gap} marked resolved or explicitly deferred with rationale in gap analysis`,
        'Verification evidence attached (CI log or local verify-local output)',
      ],
      formal_artifacts: [
        '.gap-analysis.md',
        'config/verification/',
        'packages/verified-kernels/',
      ],
      milestone: gap.startsWith('DF') ? 'M1' : 'M2',
      source: 'gap-analysis',
    });
  }

  for (const sug of chainSuggestions) {
    if (!sug.title) continue;
    const id = sug.id || `CHAIN-${String(n).padStart(3, '0')}`;
    n += 1;
    if (issues.some((i) => i.id === id || i.title === sug.title)) continue;
    issues.push({
      id,
      title: sug.title,
      severity: sug.severity || 'medium',
      description: sug.description || sug.title,
      acceptance_criteria: sug.acceptance_criteria || ['Implemented and verified'],
      formal_artifacts: sug.formal_artifacts || ['config/verification/'],
      milestone: sug.milestone || 'M2',
      source: sug.source || 'chain',
    });
  }

  // Ensure verify API coverage called out
  for (const api of ['dafny2js', 'dafny-replay']) {
    if (!context.verify_apis.includes(api)) {
      issues.push({
        id: `MISSING-API-${api}`,
        title: `Restore or document missing verify API: ${api}`,
        severity: 'critical',
        description: `Expected packages/web/src/app/api/verify/${api} not found during ingest.`,
        acceptance_criteria: [`Route exists and returns structured JSON for happy path`],
        formal_artifacts: [`packages/web/src/app/api/verify/${api}`],
        milestone: 'M0',
        source: 'ingest',
      });
    }
  }

  return issues;
}

function pickArtifacts(theme: string, context: ContextBundle): string[] {
  const arts: string[] = [];
  if (/dafny2js|translate/i.test(theme)) {
    arts.push('packages/web/src/app/api/verify/dafny2js', 'packages/verified-kernels/');
  }
  if (/dafny-replay|Replay/i.test(theme)) {
    arts.push(
      'packages/web/src/app/api/verify/dafny-replay',
      'config/verification/dafny/',
      'config/verification/lemma/',
    );
  }
  if (/Prove Dafny|verify/i.test(theme)) {
    arts.push('config/verification/dafny/', ...context.verification_dirs.map((d) => `config/verification/${d}`));
  }
  if (/Midspiral/i.test(theme)) {
    arts.push('packages/web/src/lib/midspiral-tools.ts', 'packages/web/src/app/api/verify/claimcheck');
  }
  if (/CI/i.test(theme)) {
    arts.push(...context.ci_workflows.map((f) => `.github/workflows/${f}`));
  }
  if (/E2E/i.test(theme)) {
    arts.push('scripts/', 'e2e/');
  }
  if (arts.length === 0) arts.push('config/verification/');
  return [...new Set(arts)];
}

export function buildMilestones(issues: ExpandedIssue[]): Milestone[] {
  const order = ['M0', 'M1', 'M2', 'M3'];
  const titles: Record<string, string> = {
    M0: 'Toolchain & API baseline',
    M1: 'Prove → translate → kernels',
    M2: 'Runtime gates & gap closure',
    M3: 'CI + E2E happy path',
  };
  return order.map((id) => {
    const mine = issues.filter((i) => i.milestone === id);
    return {
      id,
      title: titles[id] || id,
      summary: `${mine.length} issues for ${titles[id]}`,
      issue_ids: mine.map((i) => i.id),
      exit_criteria: [
        `All ${id} issues closed or accepted with evidence`,
        id === 'M3'
          ? 'formal-verification CI green and formal E2E passes'
          : 'Dependent later milestones unblocked',
      ],
    };
  });
}

export function parseChainIssueSuggestions(output: Record<string, unknown>): Array<Partial<ExpandedIssue>> {
  const raw = output.issues || output.expanded_issues || output.items;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x) => x && typeof x === 'object')
    .map((x) => {
      const o = x as Record<string, unknown>;
      return {
        id: typeof o.id === 'string' ? o.id : undefined,
        title: typeof o.title === 'string' ? o.title : String(o.name || ''),
        severity: (o.severity as ExpandedIssue['severity']) || 'medium',
        description: typeof o.description === 'string' ? o.description : undefined,
        acceptance_criteria: Array.isArray(o.acceptance_criteria)
          ? (o.acceptance_criteria as string[])
          : undefined,
        formal_artifacts: Array.isArray(o.formal_artifacts)
          ? (o.formal_artifacts as string[])
          : undefined,
        milestone: typeof o.milestone === 'string' ? o.milestone : undefined,
        source: 'chain',
      };
    })
    .filter((i) => i.title);
}
