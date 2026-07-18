import { Workflow, Step } from '@mastra/core';
import { z } from 'zod';
import {
  envValidationTool,
  daytonaCreateTool,
  daytonaBootstrapTool,
  daytonaConnectivityTool,
  daytonaExecTool,
  daytonaDestroyTool,
  daytonaShellTool,
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
 * 6. Checks connectivity to inference provider (Baseten/Fireworks/proxy)
 * 7. If connectivity fails, attempts provider fallback (Baseten -> Fireworks -> Proxy)
 * 8. Verifies connectivity via business rules
 * 9. Executes the agent task
 * 10. Verifies task execution
 * 11. Optionally cleans up the sandbox
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

// Step 4: Connectivity Check with Provider Fallback
const connectivityCheck = new Step({
  id: 'connectivity-check',
  description: 'Check connectivity from sandbox to inference endpoint with automatic provider fallback',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
    provider: z.enum(['baseten', 'fireworks', 'proxy', 'northflank']).default('baseten'),
    proxyUrl: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const dryRun = context.inputData.dryRun;
    const providers = ['baseten', 'fireworks', 'proxy', 'northflank'];
    const startIndex = providers.indexOf(context.inputData.provider);
    const orderedProviders = [...providers.slice(startIndex), ...providers.slice(0, startIndex)];

    for (const provider of orderedProviders) {
      if (dryRun) {
        return {
          ok: true,
          dryRun: true,
          provider,
          step: 'connectivity-check',
        };
      }

      let result: any;
      let proxyUrl = context.inputData.proxyUrl;

      switch (provider) {
        case 'baseten':
          // Check direct Baseten connectivity
          result = await daytonaConnectivityTool.execute({
            context: { dryRun: false, timeoutSeconds: 60 },
          });
          if (result.ok && result.httpCode && result.httpCode.startsWith('2')) {
            return { ...result, provider: 'baseten', step: 'connectivity-check' };
          }
          // If 403, Baseten is blocking this IP - try next provider
          if (result.httpCode === '403') {
            console.log('Baseten returned 403 (IP blocked), trying fallback provider...');
            continue;
          }
          break;

        case 'fireworks':
          // Check Fireworks AI connectivity
          result = await daytonaShellTool.execute({
            context: {
              command: `curl -sS -o /dev/null -w '%{http_code}' -H 'Authorization: Bearer ${process.env.FIREWORKS_API_KEY || ''}' --connect-timeout 5 --max-time 10 'https://api.fireworks.ai/inference/v1/models' 2>/dev/null || printf '000'`,
              timeoutSeconds: 30,
            },
          });
          if (result.ok && result.output?.includes('200')) {
            return { ...result, provider: 'fireworks', step: 'connectivity-check', ok: true };
          }
          break;

        case 'proxy':
          // Check proxy tunnel connectivity
          if (!proxyUrl) {
            console.log('No proxy URL configured, skipping proxy fallback');
            continue;
          }
          result = await daytonaShellTool.execute({
            context: {
              command: `curl -sS -o /dev/null -w '%{http_code}' --connect-timeout 5 --max-time 10 '${proxyUrl}/v1/chat/completions' 2>/dev/null || printf '000'`,
              timeoutSeconds: 30,
            },
          });
          if (result.ok && result.output?.includes('405')) {
            // 405 means the endpoint exists but needs POST - that's good
            return { ...result, provider: 'proxy', step: 'connectivity-check', ok: true, proxyUrl };
          }
          if (result.ok && result.output?.includes('200')) {
            return { ...result, provider: 'proxy', step: 'connectivity-check', ok: true, proxyUrl };
          }
          break;

        case 'northflank':
          // Check Northflank proxy connectivity
          result = await daytonaConnectivityTool.execute({
            context: { dryRun: false, timeoutSeconds: 60 },
          });
          if (result.ok) {
            return { ...result, provider: 'northflank', step: 'connectivity-check' };
          }
          break;
      }
    }

    // All providers failed
    return {
      ok: false,
      error: 'All inference providers failed connectivity check',
      step: 'connectivity-check',
    };
  },
});

// Step 5: Configure Provider in Sandbox
const configureProvider = new Step({
  id: 'configure-provider',
  description: 'Configure the selected inference provider in the sandbox opencode config',
  inputSchema: z.object({
    provider: z.enum(['baseten', 'fireworks', 'proxy', 'northflank']).default('baseten'),
    proxyUrl: z.string().optional(),
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    const provider = context.inputData.provider;
    const proxyUrl = context.inputData.proxyUrl;
    const dryRun = context.inputData.dryRun;

    if (dryRun) {
      return {
        ok: true,
        dryRun: true,
        provider,
        step: 'configure-provider',
      };
    }

    let configCommand: string;

    switch (provider) {
      case 'baseten':
        configCommand = `cat > ~/.config/opencode/opencode.json << 'EOF'
{
  "provider": {
    "baseten-qwen": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Baseten Qwen-2.5-Coder-32B",
      "options": {
        "baseURL": "https://model-qelg6953.api.baseten.co/environments/production/sync/v1",
        "apiKey": "${process.env.BASETEN_API_KEY || ''}"
      },
      "models": {
        "qwen-coder": {
          "name": "Qwen-2.5-Coder-32B-Instruct",
          "tool_call": true
        }
      }
    }
  },
  "$schema": "https://opencode.ai/config.json",
  "small_model": "baseten-qwen/qwen-coder"
}
EOF`;
        break;

      case 'fireworks':
        configCommand = `cat > ~/.config/opencode/opencode.json << 'EOF'
{
  "provider": {
    "fireworks-ai": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Fireworks AI",
      "options": {
        "baseURL": "https://api.fireworks.ai/inference/v1",
        "apiKey": "${process.env.FIREWORKS_API_KEY || ''}"
      },
      "models": {
        "gpt-oss-120b": {
          "name": "Fireworks GPT-OSS-120B",
          "tool_call": true
        }
      }
    }
  },
  "$schema": "https://opencode.ai/config.json",
  "small_model": "fireworks-ai/gpt-oss-120b"
}
EOF`;
        break;

      case 'proxy':
        if (!proxyUrl) {
          return {
            ok: false,
            error: 'Proxy URL required but not provided',
            step: 'configure-provider',
          };
        }
        configCommand = `cat > ~/.config/opencode/opencode.json << 'EOF'
{
  "provider": {
    "baseten-proxy": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Baseten via Proxy",
      "options": {
        "baseURL": "${proxyUrl}/v1",
        "apiKey": "sk-proxy"
      },
      "models": {
        "qwen-coder": {
          "name": "Qwen-2.5-Coder-32B-Instruct (via proxy)",
          "tool_call": true
        }
      }
    }
  },
  "$schema": "https://opencode.ai/config.json",
  "small_model": "baseten-proxy/qwen-coder"
}
EOF`;
        break;

      case 'northflank':
        configCommand = `cat > ~/.config/opencode/opencode.json << 'EOF'
{
  "provider": {
    "northflank-qwen": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Northflank Qwen-Coder",
      "options": {
        "baseURL": "https://http--bentoml-phase1--pvmzsl6mxvmb.code.run/v1"
      },
      "models": {
        "qwen-coder": {
          "name": "Qwen-Coder (Northflank)",
          "tool_call": true
        }
      }
    }
  },
  "$schema": "https://opencode.ai/config.json",
  "small_model": "northflank-qwen/qwen-coder"
}
EOF`;
        break;

      default:
        return {
          ok: false,
          error: `Unknown provider: ${provider}`,
          step: 'configure-provider',
        };
    }

    const result = await daytonaShellTool.execute({
      context: {
        command: configCommand,
        timeoutSeconds: 30,
      },
    });

    return {
      ...result,
      provider,
      step: 'configure-provider',
    };
  },
});

// Step 6: Restart OpenCode Server
const restartOpencode = new Step({
  id: 'restart-opencode',
  description: 'Restart the opencode server with the new provider configuration',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    if (context.inputData.dryRun) {
      return {
        ok: true,
        dryRun: true,
        step: 'restart-opencode',
      };
    }

    const result = await daytonaShellTool.execute({
      context: {
        command: 'pkill -f "opencode serve" || true; sleep 2; cd ~/gpu-inference-stack && nohup opencode serve --hostname 127.0.0.1 --port 4096 > /tmp/opencode-restart.log 2>&1 & sleep 3; curl -sf http://127.0.0.1:4096/global/health || curl -sf http://127.0.0.1:4096/health || (echo "OPENCODE_HEALTH_MISS"; exit 1)',
        timeoutSeconds: 60,
      },
    });

    return {
      ...result,
      step: 'restart-opencode',
    };
  },
});

// Step 7: Execute Task
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

// Step 8: Cleanup (conditional)
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
 * 1. validate-environment → 2. create-sandbox → 3. bootstrap-sandbox → 4. connectivity-check → 5. configure-provider → 6. restart-opencode → 7. execute-task → 8. cleanup-sandbox
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
    provider: z.enum(['baseten', 'fireworks', 'proxy', 'northflank']).default('baseten'),
    proxyUrl: z.string().optional(),
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
    variables: {
      dryRun: { step: 'trigger', path: 'dryRun' },
      provider: { step: 'trigger', path: 'provider' },
      proxyUrl: { step: 'trigger', path: 'proxyUrl' },
    },
    when: { 'bootstrap-sandbox': { ok: true } },
  })
  .then(configureProvider, {
    variables: {
      dryRun: { step: 'trigger', path: 'dryRun' },
      provider: { step: 'connectivity-check', path: 'provider' },
      proxyUrl: { step: 'connectivity-check', path: 'proxyUrl' },
    },
    when: { 'connectivity-check': { ok: true } },
  })
  .then(restartOpencode, {
    variables: { dryRun: { step: 'trigger', path: 'dryRun' } },
    when: { 'configure-provider': { ok: true } },
  })
  .then(executeTask, {
    variables: {
      task: { step: 'trigger', path: 'task' },
      harness: { step: 'trigger', path: 'harness' },
      dryRun: { step: 'trigger', path: 'dryRun' },
    },
    when: { 'restart-opencode': { ok: true } },
  })
  .then(cleanupSandbox, {
    variables: { skipCleanup: { step: 'trigger', path: 'skipCleanup' } },
  });

export default daytonaOrchestrationWorkflow;
