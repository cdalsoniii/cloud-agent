import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { createTool } from './tool-shim.js';
import { runFormalPrdPlanner } from '../../formal-prd/planner.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Mastra MCP tool: formal-prd-plan
 * Interprets a request, ingests assistant-ui formal context, expands issues,
 * and writes PRD / specs / milestones under artifacts/prd/<slug>/.
 */
export const formalPrdPlanTool = createTool({
  id: 'formal-prd-plan',
  description:
    'Plan a formal-system PRD for assistant-ui (dafny2js, dafny-replay, verified-kernels, Midspiral, CI): ingest grounding, expand issues, emit PRD/specs/milestones via Baseten chain specialties with local fallbacks. Use dryRun for offline packs.',
  inputSchema: z.object({
    request: z
      .string()
      .describe(
        'Natural-language request, e.g. formally validate dafny2js + dafny-replay happy path',
      ),
    target: z
      .string()
      .default('assistant-ui')
      .describe('Product target (default assistant-ui)'),
    dryRun: z
      .boolean()
      .default(false)
      .describe('Skip live Baseten; use local analysis/PRD/spec fallbacks'),
    writeJobs: z
      .boolean()
      .default(false)
      .describe('Emit 07-jobs.json and pybatch/jobs-from-prd-<slug>.json'),
    slug: z.string().optional().describe('Optional artifact slug override'),
  }),
  execute: async ({ context }) => {
    const cloudAgentRoot = path.resolve(__dirname, '../../..');
    try {
      const pack = await runFormalPrdPlanner({
        request: context.request,
        target: context.target,
        dryRun: context.dryRun,
        writeJobs: context.writeJobs,
        slug: context.slug,
        cloudAgentRoot,
      });
      return {
        ok: true,
        slug: pack.slug,
        outDir: pack.outDir,
        issue_count: pack.issues.length,
        milestones: pack.milestones.map((m) => ({
          id: m.id,
          title: m.title,
          issue_count: m.issue_ids.length,
        })),
        providers: pack.chainMeta.providers,
        jobs: pack.jobs?.length ?? 0,
        next: [
          `Review ${pack.outDir}/04-PRD.md and 03-ISSUE_BACKLOG.md`,
          pack.jobs?.length
            ? `Run sdlc-batch with jobsFile=jobs-from-prd-${pack.slug}.json`
            : 'Call again with writeJobs=true to emit pybatch jobs',
        ],
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message };
    }
  },
});
