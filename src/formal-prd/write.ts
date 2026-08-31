import fs from 'node:fs';
import path from 'node:path';
import type { ExpandedIssue, Milestone, PlanningPack } from './types.js';

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writePlanningPack(pack: PlanningPack): string {
  const { outDir } = pack;
  ensureDir(outDir);
  ensureDir(path.join(outDir, '05-SPECS'));

  fs.writeFileSync(
    path.join(outDir, '00-REQUEST.md'),
    [
      '# Interpreted request',
      '',
      `**Intent:** ${pack.interpreted.intent}`,
      '',
      '## Success criteria',
      ...pack.interpreted.success_criteria.map((c) => `- ${c}`),
      '',
      '## Themes',
      ...pack.interpreted.themes.map((t) => `- ${t}`),
      '',
      '## Products',
      ...pack.interpreted.products.map((p) => `- ${p}`),
      '',
    ].join('\n'),
    'utf8',
  );

  fs.writeFileSync(
    path.join(outDir, '01-CONTEXT_BUNDLE.json'),
    JSON.stringify(pack.context, null, 2),
    'utf8',
  );

  fs.writeFileSync(path.join(outDir, '02-ANALYSIS.md'), pack.analysisMarkdown, 'utf8');

  fs.writeFileSync(
    path.join(outDir, '03-issues.json'),
    JSON.stringify(pack.issues, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, '03-ISSUE_BACKLOG.md'),
    renderIssueBacklog(pack.issues),
    'utf8',
  );

  fs.writeFileSync(path.join(outDir, '04-PRD.md'), pack.prdMarkdown, 'utf8');

  for (const [name, body] of Object.entries(pack.specs)) {
    const safe = name.replace(/[^a-zA-Z0-9._-]+/g, '-');
    fs.writeFileSync(path.join(outDir, '05-SPECS', safe), body, 'utf8');
  }

  fs.writeFileSync(
    path.join(outDir, '06-milestones.json'),
    JSON.stringify(pack.milestones, null, 2),
    'utf8',
  );
  fs.writeFileSync(
    path.join(outDir, '06-MILESTONES.md'),
    renderMilestones(pack.milestones, pack.issues),
    'utf8',
  );

  if (pack.jobs) {
    fs.writeFileSync(
      path.join(outDir, '07-jobs.json'),
      JSON.stringify(pack.jobs, null, 2),
      'utf8',
    );
  }

  fs.writeFileSync(
    path.join(outDir, 'meta.json'),
    JSON.stringify(
      {
        slug: pack.slug,
        chainMeta: pack.chainMeta,
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
    'utf8',
  );

  return outDir;
}

function renderIssueBacklog(issues: ExpandedIssue[]): string {
  const lines = ['# Issue backlog', '', `Total: ${issues.length}`, ''];
  for (const issue of issues) {
    lines.push(`## ${issue.id}: ${issue.title}`);
    lines.push('');
    lines.push(`- **Severity:** ${issue.severity}`);
    lines.push(`- **Milestone:** ${issue.milestone}`);
    lines.push(`- **Source:** ${issue.source}`);
    lines.push('');
    lines.push(issue.description);
    lines.push('');
    lines.push('### Acceptance criteria');
    for (const c of issue.acceptance_criteria) lines.push(`- ${c}`);
    lines.push('');
    lines.push('### Formal artifacts');
    for (const a of issue.formal_artifacts) lines.push(`- \`${a}\``);
    lines.push('');
  }
  return lines.join('\n');
}

function renderMilestones(milestones: Milestone[], issues: ExpandedIssue[]): string {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const lines = ['# Milestones', ''];
  for (const m of milestones) {
    lines.push(`## ${m.id}: ${m.title}`);
    lines.push('');
    lines.push(m.summary);
    lines.push('');
    lines.push('### Issues');
    for (const id of m.issue_ids) {
      const issue = byId.get(id);
      lines.push(`- ${id}${issue ? `: ${issue.title}` : ''}`);
    }
    lines.push('');
    lines.push('### Exit criteria');
    for (const c of m.exit_criteria) lines.push(`- ${c}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function buildJobsFromMilestones(
  pack: PlanningPack,
  repoUrl = 'https://github.com/BrightforestX/assistant-ui.git',
): Record<string, unknown>[] {
  return pack.milestones
    .filter((m) => m.issue_ids.length > 0)
    .map((m, idx) => ({
      job_id: `${pack.slug}-${m.id.toLowerCase()}`,
      repo_url: repoUrl,
      branch: 'main',
      task: [
        `Milestone ${m.id}: ${m.title}`,
        m.summary,
        'Implement and formally validate related issues:',
        ...m.issue_ids.map((id) => {
          const issue = pack.issues.find((i) => i.id === id);
          return `- ${id}: ${issue?.title || id}`;
        }),
        'Update config/verification specs when behavior changes (sync_formal).',
        'Success criteria from PRD must remain green for dafny2js + dafny-replay + formal stack.',
      ].join('\n'),
      max_iterations: 4,
      test_cmd:
        idx === 0
          ? 'test -x scripts/verify-local.sh && ./scripts/verify-local.sh --suite dafny || (command -v dafny >/dev/null && for f in config/verification/dafny/*.dfy; do dafny verify --allow-warnings "$f" || exit 1; done)'
          : 'test -x scripts/verify-local.sh && ./scripts/verify-local.sh --suite all || npm run verify:all',
      model: 'baseten-proxy/qwen-coder',
      deep_research: true,
      sync_formal: true,
      default_formal_suite: 'all',
      require_diff: true,
      validation: {
        formal_suite: idx === 0 ? 'dafny' : 'all',
      },
      create_pr: true,
      pr_branch_prefix: `formal-prd/${pack.slug}`,
      pr_title: `[formal-prd] ${m.id} ${m.title}`,
      pr_body: `Generated from formal-system-prd pack \`${pack.slug}\` milestone ${m.id}.`,
    }));
}
