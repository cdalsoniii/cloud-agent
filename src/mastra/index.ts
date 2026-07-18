import { Mastra } from '@mastra/core';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

// Load environment variables
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env') });

import { daytonaOrchestratorAgent } from './agents/daytona-agent.js';
import { daytonaOrchestrationWorkflow } from './workflows/daytona-workflow.js';

/**
 * Mastra Daytona Orchestrator
 *
 * Main entry point for the Mastra.ai agent system that orchestrates
 * Daytona sandboxes with formal Midspiral verification.
 *
 * Usage:
 *   npx tsx src/mastra/index.ts --task "implement a React component" --harness opencode
 *   npx tsx src/mastra/index.ts --dry-run --task "test the system"
 */

const mastra = new Mastra({
  agents: { daytonaOrchestrator: daytonaOrchestratorAgent },
  workflows: { daytonaOrchestration: daytonaOrchestrationWorkflow },
});

async function main() {
  // Parse CLI arguments
  const args = process.argv.slice(2);
  const flags: Record<string, string | boolean> = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const key = arg.replace(/^--/, '');
      const next = args[i + 1];
      if (next && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    }
  }

  const task = (flags.task as string) || 'echo "No task provided"';
  const harness = (flags.harness as string) || 'opencode';
  const dryRun = flags['dry-run'] === true || flags.dryRun === true || flags.dry === 'true';
  const skipCleanup = flags['skip-cleanup'] === true || flags.skipCleanup === true;

  console.log('╔═══════════════════════════════════════════════════════════╗');
  console.log('║  Mastra Daytona Orchestrator with Midspiral Verification  ║');
  console.log('╚═══════════════════════════════════════════════════════════╝');
  console.log();
  console.log('Configuration:');
  console.log(`  Task:        ${task}`);
  console.log(`  Harness:     ${harness}`);
  console.log(`  Dry Run:     ${dryRun}`);
  console.log(`  Skip Cleanup: ${skipCleanup}`);
  console.log();

  try {
    // Run the workflow
    const { runId, start } = mastra.workflows.daytonaOrchestration.createRun();

    const result = await start({
      triggerData: {
        task,
        harness: harness as 'goose' | 'opencode' | 'pi',
        dryRun,
        skipCleanup,
      },
    });

    console.log();
    console.log('═══════════════════════════════════════════════════════════');
    console.log('Workflow Result:');
    console.log('═══════════════════════════════════════════════════════════');
    console.log(JSON.stringify(result, null, 2));

    // Also run agent-based orchestration for comparison
    if (!dryRun) {
      console.log();
      console.log('═══════════════════════════════════════════════════════════');
      console.log('Agent-Based Orchestration:');
      console.log('═══════════════════════════════════════════════════════════');

      const agentResponse = await daytonaOrchestratorAgent.generate(
        `Orchestrate a Daytona sandbox for the following task: ${task}. Use the harness ${harness}.`,
      );

      console.log('Agent Response:', agentResponse.text);
    }

  } catch (error: any) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
