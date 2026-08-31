#!/usr/bin/env npx tsx
/**
 * CLI: Formal System PRD planner (Baseten chain + local fallbacks).
 *
 *   npm run prd:plan -- --request "..." --dry-run --write-jobs
 */
import { runFormalPrdPlanner } from './formal-prd/planner.js';

function parseArgs(argv: string[]): {
  request: string;
  target: string;
  dryRun: boolean;
  writeJobs: boolean;
  slug?: string;
  assistantUiDir?: string;
} {
  let request = '';
  let target = 'assistant-ui';
  let dryRun = false;
  let writeJobs = false;
  let slug: string | undefined;
  let assistantUiDir: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--request' || a === '-r') {
      request = argv[++i] || '';
    } else if (a === '--target' || a === '-t') {
      target = argv[++i] || 'assistant-ui';
    } else if (a === '--dry-run') {
      dryRun = true;
    } else if (a === '--write-jobs') {
      writeJobs = true;
    } else if (a === '--slug') {
      slug = argv[++i];
    } else if (a === '--assistant-ui-dir') {
      assistantUiDir = argv[++i];
    } else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    }
  }

  if (!request) {
    console.error('Error: --request is required\n');
    printHelp();
    process.exit(1);
  }

  return { request, target, dryRun, writeJobs, slug, assistantUiDir };
}

function printHelp(): void {
  console.log(`Usage:
  npm run prd:plan -- --request "<text>" [options]

Options:
  --request, -r       Natural-language planning request (required)
  --target, -t        Product target (default: assistant-ui)
  --dry-run           Skip live Baseten; use local fallbacks
  --write-jobs        Emit 07-jobs.json + pybatch/jobs-from-prd-<slug>.json
  --slug              Override artifact slug
  --assistant-ui-dir  Override ASSISTANT_UI_DIR
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const pack = await runFormalPrdPlanner({
    request: opts.request,
    target: opts.target,
    dryRun: opts.dryRun,
    writeJobs: opts.writeJobs,
    slug: opts.slug,
    assistantUiDir: opts.assistantUiDir,
  });

  console.log(
    JSON.stringify(
      {
        ok: true,
        slug: pack.slug,
        outDir: pack.outDir,
        issue_count: pack.issues.length,
        milestones: pack.milestones.map((m) => m.id),
        providers: pack.chainMeta.providers,
        jobs: pack.jobs?.length ?? 0,
        next: [
          `ls ${pack.outDir}`,
          pack.jobs?.length
            ? `SDLC_JOBS_FILE=pybatch/jobs-from-prd-${pack.slug}.json npm run mastra:mcp  # or sdlc-batch tool`
            : 'Re-run with --write-jobs to emit pybatch jobs',
          'npm run verify:all  # in assistant-ui or cloud-agent as appropriate',
        ],
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
