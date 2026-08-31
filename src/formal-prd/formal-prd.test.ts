import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';
import { extractGapIds, ingestAssistantUiContext, resolveAssistantUiDir } from './ingest.js';
import { interpretRequestLocal, slugFromRequest } from './interpret.js';
import { buildMilestones, expandIssues } from './expand-issues.js';
import { buildJobsFromMilestones, writePlanningPack } from './write.js';
import {
  buildDeepResearchBriefPayload,
  buildPrdFromAnalysisPayload,
  buildSpecFromResearchPayload,
  formalPrdSpecialtyMap,
} from './specialty-payloads.js';
import type { PlanningPack } from './types.js';

const CLOUD_AGENT_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

describe('extractGapIds', () => {
  it('finds DF/QW/M ids', () => {
    const ids = extractGapIds('See DF-12 and QW-3; also M-1 and noise DF');
    assert.ok(ids.includes('DF-12'));
    assert.ok(ids.includes('QW-3'));
    assert.ok(ids.includes('M-1'));
  });
});

describe('interpretRequestLocal', () => {
  it('detects dafny2js and dafny-replay themes', () => {
    const i = interpretRequestLocal(
      'Formally validate dafny2js and dafny-replay happy path enforcement',
    );
    assert.ok(i.themes.includes('dafny2js'));
    assert.ok(i.themes.includes('dafny-replay'));
    assert.ok(i.themes.includes('happy-path'));
    assert.ok(i.success_criteria.some((c) => /dafny2js/i.test(c)));
  });
});

describe('slugFromRequest', () => {
  it('uses explicit slug when provided', () => {
    assert.equal(slugFromRequest('anything', 'my-slug'), 'my-slug');
  });
});

describe('specialty payloads', () => {
  it('builds deep-research-brief payload', () => {
    const p = buildDeepResearchBriefPayload({
      task: 't',
      product: 'assistant-ui',
    });
    assert.equal(p.specialty, 'deep-research-brief');
    assert.equal((p.request as { task: string }).task, 't');
  });

  it('builds spec-from-research and prd-from-analysis', () => {
    const s = buildSpecFromResearchPayload({ research: { a: 1 } });
    assert.equal(s.specialty, 'spec-from-research');
    const prd = buildPrdFromAnalysisPayload({
      request: 'r',
      analysis: 'a',
      issues: [],
    });
    assert.equal(prd.specialty, 'prd-from-analysis');
  });

  it('exports map for sandbox specialtyMap', () => {
    assert.ok(formalPrdSpecialtyMap['deep-research-brief']);
    assert.ok(formalPrdSpecialtyMap['prd-from-analysis']);
    assert.ok(formalPrdSpecialtyMap.roadmap);
  });
});

describe('ingest + expand', () => {
  it('ingests fixture tree and expands forced themes', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-prd-fix-'));
    fs.writeFileSync(
      path.join(fixture, '.gap-analysis.md'),
      '# Gaps\n\n- DF-99 blocks dafny2js\n- QW-7 midspiral\n',
      'utf8',
    );
    fs.mkdirSync(path.join(fixture, 'packages/web/src/app/api/verify/dafny2js'), {
      recursive: true,
    });
    fs.mkdirSync(
      path.join(fixture, 'packages/web/src/app/api/verify/dafny-replay'),
      { recursive: true },
    );
    fs.mkdirSync(path.join(fixture, 'config/verification/dafny'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(fixture, '.github/workflows'), { recursive: true });
    fs.writeFileSync(
      path.join(fixture, '.github/workflows/formal-verification.yml'),
      'name: formal\n',
      'utf8',
    );

    const ctx = ingestAssistantUiContext(fixture, 'assistant-ui');
    assert.ok(ctx.verify_apis.includes('dafny2js'));
    assert.ok(ctx.verify_apis.includes('dafny-replay'));
    assert.ok(ctx.ci_workflows.includes('formal-verification.yml'));
    assert.ok(ctx.docs['.gap-analysis.md']?.gap_ids.includes('DF-99'));

    const interpreted = interpretRequestLocal(
      'happy path dafny2js dafny-replay formal validation',
    );
    const issues = expandIssues(interpreted, ctx, [
      { title: 'Chain-suggested hardening', severity: 'medium' },
    ]);
    assert.ok(issues.length >= 9);
    assert.ok(issues.some((i) => i.source === 'forced-theme'));
    assert.ok(issues.some((i) => i.id === 'GAP-DF-99'));
    assert.ok(issues.some((i) => i.title.includes('Chain-suggested')));

    const milestones = buildMilestones(issues);
    assert.equal(milestones.length, 4);
    assert.ok(milestones.every((m) => m.issue_ids.length >= 0));
  });
});

describe('writePlanningPack', () => {
  it('writes expected artifact files', () => {
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'formal-prd-out-'));
    const interpreted = interpretRequestLocal('dafny2js dafny-replay happy path');
    const context = {
      target: 'assistant-ui',
      root: '/tmp/fake',
      docs: {},
      verify_apis: ['dafny2js', 'dafny-replay'],
      verification_dirs: ['dafny'],
      kernels: [],
      ci_workflows: ['formal-verification.yml'],
      npm_scripts: [],
      forced_themes: ['Prove Dafny'],
    };
    const issues = expandIssues(interpreted, context, []);
    const milestones = buildMilestones(issues);
    const pack: PlanningPack = {
      slug: 'test-pack',
      outDir,
      interpreted,
      context,
      analysisMarkdown: '# Analysis\n',
      issues,
      prdMarkdown: '# PRD\n',
      specs: { 'happy-path.md': '# Spec\n' },
      milestones,
      jobs: buildJobsFromMilestones({
        slug: 'test-pack',
        outDir,
        interpreted,
        context,
        analysisMarkdown: '',
        issues,
        prdMarkdown: '',
        specs: {},
        milestones,
        chainMeta: { dryRun: true, providers: {} },
      }),
      chainMeta: { dryRun: true, providers: { research: 'dry-run' } },
    };
    writePlanningPack(pack);
    assert.ok(fs.existsSync(path.join(outDir, '00-REQUEST.md')));
    assert.ok(fs.existsSync(path.join(outDir, '01-CONTEXT_BUNDLE.json')));
    assert.ok(fs.existsSync(path.join(outDir, '03-ISSUE_BACKLOG.md')));
    assert.ok(fs.existsSync(path.join(outDir, '04-PRD.md')));
    assert.ok(fs.existsSync(path.join(outDir, '05-SPECS', 'happy-path.md')));
    assert.ok(fs.existsSync(path.join(outDir, '06-MILESTONES.md')));
    assert.ok(fs.existsSync(path.join(outDir, '07-jobs.json')));
  });
});

describe('resolveAssistantUiDir', () => {
  it('resolves sibling assistant-ui when present', () => {
    const resolved = resolveAssistantUiDir('assistant-ui', CLOUD_AGENT_ROOT);
    assert.ok(resolved.includes('assistant-ui'));
  });
});
