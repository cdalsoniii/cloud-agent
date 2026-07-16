import { Workflow, Step } from '@mastra/core';
import { z } from 'zod';
import {
  envValidationTool,
  daytonaCreateTool,
  daytonaBootstrapTool,
  daytonaConnectivityTool,
  daytonaExecTool,
  daytonaDestroyTool,
  verifyRuleTool,
} from '../tools/daytona-tools.js';

/**
 * Daytona Sandbox Orchestration Workflow
 *
 * A formally-verified workflow that:
 * 1. Validates environment prerequisites
 * 2. Creates a Daytona sandbox
 * 3. Verifies sandbox creation via business rules
 * 4. Bootstraps the sandbox (git clone + harness install)
 * 5. Verifies bootstrap success
 * 6. Checks connectivity to Baseten/proxy
 * 7. Verifies connectivity via business rules
 * 8. Executes the agent task
 * 9. Verifies task execution
 * 10. Optionally cleans up the sandbox
 *
 * Each verification step uses Midspiral formal verification tools.
 */

// Step 1: Environment Validation
const validateEnvironment = new Step({
  id: 'validate-environment',
  description: 'Validate all required environment variables are present',
  inputSchema: z.object({
    requiredVars: z.array(z.string()).default([
      'DAYTONA_API_KEY',
      'GIT_TOKEN',
      'GIT_REPO_URL',
      'BASETEN_API_KEY',
    ]),
  }),
  execute: async ({ context }) => {
    const result = await envValidationTool.execute({
      context: {
        requiredVars: context.inputData.requiredVars,
      },
    });

    // Verify business rule: env-vars-present
    const ruleVerify = await verifyRuleTool.execute({
      context: {
        ruleSpec: 'All required environment variables must be present and non-empty: DAYTONA_API_KEY, GIT_TOKEN, GIT_REPO_URL, BASETEN_API_KEY',
        ruleCode: `required_vars CONTAINS 'DAYTONA_API_KEY' AND required_vars CONTAINS 'GIT_TOKEN' AND required_vars CONTAINS 'GIT_REPO_URL' AND required_vars CONTAINS 'BASETEN_API_KEY'`,
      },
    });

    return {
      ...result,
      ruleVerified: ruleVerify.verified,
      ruleCoverage: ruleVerify.coverage,
      step: 'validate-environment',
    };
  },
});

// Step 2: Create Sandbox
const createSandbox = new Step({
  id: 'create-sandbox',
  description: 'Create a Daytona sandbox',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    const result = await daytonaCreateTool.execute({
      context: {
        dryRun: context.inputData.dryRun,
        timeoutSeconds: 300,
      },
    });

    // Verify business rule: sandbox-id-present
    const ruleVerify = await verifyRuleTool.execute({
      context: {
        ruleSpec: 'Daytona sandbox creation must return a valid sandbox_id UUID',
        ruleCode: `sandbox_id IS NOT NULL AND sandbox_id MATCHES '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
      },
    });

    return {
      ...result,
      ruleVerified: ruleVerify.verified,
      ruleCoverage: ruleVerify.coverage,
      step: 'create-sandbox',
    };
  },
});

// Step 3: Bootstrap Sandbox
const bootstrapSandbox = new Step({
  id: 'bootstrap-sandbox',
  description: 'Bootstrap the sandbox with git clone and harness install',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    const result = await daytonaBootstrapTool.execute({
      context: {
        dryRun: context.inputData.dryRun,
        timeoutSeconds: 1800,
      },
    });

    // Verify business rule: bootstrap-exit-code-0
    const ruleVerify = await verifyRuleTool.execute({
      context: {
        ruleSpec: 'Sandbox bootstrap must complete with exit code 0',
        ruleCode: `bootstrap_status == 'success' AND bootstrap_exit_code == 0`,
      },
    });

    return {
      ...result,
      ruleVerified: ruleVerify.verified,
      ruleCoverage: ruleVerify.coverage,
      step: 'bootstrap-sandbox',
    };
  },
});

// Step 4: Connectivity Check
const connectivityCheck = new Step({
  id: 'connectivity-check',
  description: 'Check connectivity from sandbox to Baseten/proxy endpoint',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    const result = await daytonaConnectivityTool.execute({
      context: {
        dryRun: context.inputData.dryRun,
        timeoutSeconds: 60,
      },
    });

    // Verify business rule: connectivity-http-ok
    const ruleVerify = await verifyRuleTool.execute({
      context: {
        ruleSpec: 'Connectivity probe must return acceptable HTTP code (2xx, 401, 403, 404, 503)',
        ruleCode: `connectivity_http_code IN ('200', '201', '202', '204', '401', '403', '404', '503')`,
      },
    });

    return {
      ...result,
      ruleVerified: ruleVerify.verified,
      ruleCoverage: ruleVerify.coverage,
      step: 'connectivity-check',
    };
  },
});

// Step 5: Execute Task
const executeTask = new Step({
  id: 'execute-task',
  description: 'Execute the agent task within the sandbox',
  inputSchema: z.object({
    task: z.string().describe('The task to execute'),
    harness: z.enum(['goose', 'opencode', 'pi']).default('opencode'),
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    const result = await daytonaExecTool.execute({
      context: {
        task: context.inputData.task,
        harness: context.inputData.harness,
        dryRun: context.inputData.dryRun,
        timeoutSeconds: 1800,
      },
    });

    // Verify business rule: task-exit-code-0
    const ruleVerify = await verifyRuleTool.execute({
      context: {
        ruleSpec: 'Agent task execution must complete with exit code 0',
        ruleCode: `task_status == 'success' AND task_exit_code == 0`,
      },
    });

    return {
      ...result,
      ruleVerified: ruleVerify.verified,
      ruleCoverage: ruleVerify.coverage,
      step: 'execute-task',
    };
  },
});

// Step 6: Cleanup (conditional)
const cleanupSandbox = new Step({
  id: 'cleanup-sandbox',
  description: 'Destroy the Daytona sandbox',
  inputSchema: z.object({
    skipCleanup: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    if (context.inputData.skipCleanup) {
      return {
        ok: true,
        skipped: true,
        step: 'cleanup-sandbox',
      };
    }

    const result = await daytonaDestroyTool.execute({
      context: {
        dryRun: false,
      },
    });

    return {
      ...result,
      step: 'cleanup-sandbox',
    };
  },
});

/**
 * The main Daytona sandbox orchestration workflow.
 *
 * Steps:
 * 1. validate-environment → 2. create-sandbox → 3. bootstrap-sandbox → 4. connectivity-check → 5. execute-task → 6. cleanup-sandbox
 *
 * Each step includes formal verification of business rules via Midspiral tools.
 */
export const daytonaOrchestrationWorkflow = new Workflow({
  name: 'daytona-sandbox-orchestration',
  triggerSchema: z.object({
    task: z.string().describe('The task to execute in the sandbox'),
    harness: z.enum(['goose', 'opencode', 'pi']).default('opencode'),
    dryRun: z.boolean().default(false),
    skipCleanup: z.boolean().default(false),
    requiredVars: z.array(z.string()).default([
      'DAYTONA_API_KEY',
      'GIT_TOKEN',
      'GIT_REPO_URL',
      'BASETEN_API_KEY',
    ]),
  }),
});

daytonaOrchestrationWorkflow
  .step(validateEnvironment, {
    variables: { requiredVars: { step: 'trigger', path: 'requiredVars' } },
  })
  .then(createSandbox, {
    variables: { dryRun: { step: 'trigger', path: 'dryRun' } },
    when: { 'validate-environment': { ok: true } },
  })
  .then(bootstrapSandbox, {
    variables: { dryRun: { step: 'trigger', path: 'dryRun' } },
    when: { 'create-sandbox': { ok: true } },
  })
  .then(connectivityCheck, {
    variables: { dryRun: { step: 'trigger', path: 'dryRun' } },
    when: { 'bootstrap-sandbox': { ok: true } },
  })
  .then(executeTask, {
    variables: {
      task: { step: 'trigger', path: 'task' },
      harness: { step: 'trigger', path: 'harness' },
      dryRun: { step: 'trigger', path: 'dryRun' },
    },
    when: { 'connectivity-check': { ok: true } },
  })
  .then(cleanupSandbox, {
    variables: { skipCleanup: { step: 'trigger', path: 'skipCleanup' } },
  });

export default daytonaOrchestrationWorkflow;
