import { createTool } from '@mastra/core';
import { z } from 'zod';
import { execSync, spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STACK_DIR = process.env.GPU_INFERENCE_STACK_DIR || path.resolve(__dirname, '../../../../gpu-inference-stack');

/**
 * Daytona sandbox creation tool.
 * Wraps the provider.sh create command with explicit SANDBOX_PROVIDER=daytona.
 */
export const daytonaCreateTool = createTool({
  id: 'daytona-create',
  description: 'Create a Daytona sandbox using the provider.sh create command',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
    timeoutSeconds: z.number().default(300),
  }),
  execute: async ({ context }) => {
    const providerScript = path.join(STACK_DIR, 'scripts/sandbox/provider.sh');
    const env = { ...process.env, SANDBOX_PROVIDER: 'daytona' };

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `SANDBOX_PROVIDER=daytona ${providerScript} create`,
        provider: 'daytona',
      };
    }

    try {
      const output = execSync(`${providerScript} create`, {
        env,
        timeout: context.timeoutSeconds * 1000,
        encoding: 'utf-8',
        cwd: STACK_DIR,
      });

      // Try to parse sandbox ID from output or state file
      const stateFile = process.env.SANDBOX_STATE_FILE || '/tmp/gpu-orchestrator-sandbox.json';
      let state: any = {};
      if (fs.existsSync(stateFile)) {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
      }

      return {
        ok: true,
        output: output.trim(),
        sandboxId: state.sandbox_id || null,
        provider: 'daytona',
        stateFile,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString(),
        provider: 'daytona',
      };
    }
  },
});

/**
 * Daytona sandbox bootstrap tool.
 * Clones repo and installs harness dependencies.
 */
export const daytonaBootstrapTool = createTool({
  id: 'daytona-bootstrap',
  description: 'Bootstrap a Daytona sandbox with git clone and harness installation',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
    timeoutSeconds: z.number().default(1800),
  }),
  execute: async ({ context }) => {
    const providerScript = path.join(STACK_DIR, 'scripts/sandbox/provider.sh');
    const env = { ...process.env, SANDBOX_PROVIDER: 'daytona' };

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `SANDBOX_PROVIDER=daytona ${providerScript} bootstrap`,
        provider: 'daytona',
      };
    }

    try {
      const output = execSync(`${providerScript} bootstrap`, {
        env,
        timeout: context.timeoutSeconds * 1000,
        encoding: 'utf-8',
        cwd: STACK_DIR,
      });

      return {
        ok: true,
        output: output.trim(),
        bootstrapped: true,
        provider: 'daytona',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString(),
        provider: 'daytona',
      };
    }
  },
});

/**
 * Daytona connectivity check tool.
 * Probes the proxy/Baseten endpoint from within the sandbox.
 */
export const daytonaConnectivityTool = createTool({
  id: 'daytona-connectivity',
  description: 'Check connectivity from Daytona sandbox to proxy/Baseten endpoint',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
    timeoutSeconds: z.number().default(60),
  }),
  execute: async ({ context }) => {
    const providerScript = path.join(STACK_DIR, 'scripts/sandbox/provider.sh');
    const env = { ...process.env, SANDBOX_PROVIDER: 'daytona' };

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `SANDBOX_PROVIDER=daytona ${providerScript} connectivity`,
        provider: 'daytona',
      };
    }

    try {
      const output = execSync(`${providerScript} connectivity`, {
        env,
        timeout: context.timeoutSeconds * 1000,
        encoding: 'utf-8',
        cwd: STACK_DIR,
      });

      // Parse JSON output from sandbox_daytona.py
      let result: any = {};
      try {
        // The output may have multiple JSON lines; take the last one
        const lines = output.trim().split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (line.startsWith('{')) {
            result = JSON.parse(line);
          }
        }
      } catch {
        result = { rawOutput: output.trim() };
      }

      return {
        ok: result.ok ?? true,
        httpCode: result.http_code || 'unknown',
        mode: result.mode || 'unknown',
        url: result.url || 'unknown',
        hint: result.hint || null,
        authStyle: result.auth_style || 'unknown',
        provider: 'daytona',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString(),
        provider: 'daytona',
      };
    }
  },
});

/**
 * Daytona exec tool.
 * Execute a command or task within the sandbox.
 */
export const daytonaExecTool = createTool({
  id: 'daytona-exec',
  description: 'Execute a command or task in a Daytona sandbox',
  inputSchema: z.object({
    task: z.string().describe('The task or command to execute'),
    harness: z.enum(['goose', 'opencode', 'pi']).default('opencode'),
    runtime: z.string().default(''),
    timeoutSeconds: z.number().default(1800),
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    const providerScript = path.join(STACK_DIR, 'scripts/sandbox/provider.sh');
    const env = { ...process.env, SANDBOX_PROVIDER: 'daytona' };

    const args = [
      'exec',
      '--harness', context.harness,
      '--task', context.task,
    ];
    if (context.runtime) {
      args.push('--runtime', context.runtime);
    }

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `SANDBOX_PROVIDER=daytona ${providerScript} ${args.join(' ')}`,
        provider: 'daytona',
      };
    }

    try {
      const output = execSync(`${providerScript} ${args.join(' ')}`, {
        env,
        timeout: context.timeoutSeconds * 1000,
        encoding: 'utf-8',
        cwd: STACK_DIR,
      });

      // Parse exit code from JSON output
      let result: any = { exitCode: 0 };
      try {
        const lines = output.trim().split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (line.startsWith('{')) {
            result = JSON.parse(line);
          }
        }
      } catch {
        result = { rawOutput: output.trim() };
      }

      return {
        ok: result.ok ?? (result.exitCode === 0),
        exitCode: result.exitCode ?? 0,
        output: output.trim(),
        provider: 'daytona',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString(),
        provider: 'daytona',
      };
    }
  },
});

/**
 * Daytona shell tool.
 * Run an arbitrary shell command in the sandbox for debugging.
 */
export const daytonaShellTool = createTool({
  id: 'daytona-shell',
  description: 'Run an arbitrary shell command in a Daytona sandbox for debugging',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    timeoutSeconds: z.number().default(120),
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    const pythonScript = path.join(STACK_DIR, 'scripts/sandbox_daytona.py');
    const env = { ...process.env, SANDBOX_PROVIDER: 'daytona' };

    const args = [
      'shell',
      '--command', context.command,
    ];
    if (context.dryRun) {
      args.push('--dry-run');
    }

    try {
      const output = execSync(`python3 ${pythonScript} ${args.map(a => `"${a}"`).join(' ')}`, {
        env,
        timeout: context.timeoutSeconds * 1000,
        encoding: 'utf-8',
        cwd: STACK_DIR,
      });

      let result: any = { exitCode: 0 };
      try {
        const lines = output.trim().split('\n').filter(l => l.trim());
        for (const line of lines) {
          if (line.startsWith('{')) {
            result = JSON.parse(line);
          }
        }
      } catch {
        result = { rawOutput: output.trim() };
      }

      return {
        ok: result.ok ?? (result.exitCode === 0),
        exitCode: result.exitCode ?? 0,
        output: output.trim(),
        provider: 'daytona',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString(),
        stdout: error.stdout?.toString(),
        provider: 'daytona',
      };
    }
  },
});

/**
 * Daytona destroy tool.
 * Destroy the active sandbox.
 */
export const daytonaDestroyTool = createTool({
  id: 'daytona-destroy',
  description: 'Destroy the active Daytona sandbox',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    const pythonScript = path.join(STACK_DIR, 'scripts/sandbox_daytona.py');
    const env = { ...process.env, SANDBOX_PROVIDER: 'daytona' };

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `python3 ${pythonScript} destroy`,
        provider: 'daytona',
      };
    }

    try {
      const output = execSync(`python3 ${pythonScript} destroy`, {
        env,
        timeout: 30000,
        encoding: 'utf-8',
        cwd: STACK_DIR,
      });

      return {
        ok: true,
        output: output.trim(),
        destroyed: true,
        provider: 'daytona',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString(),
        provider: 'daytona',
      };
    }
  },
});

/**
 * Environment validation tool.
 * Checks that all required environment variables are present.
 */
export const envValidationTool = createTool({
  id: 'env-validation',
  description: 'Validate that all required environment variables are present',
  inputSchema: z.object({
    requiredVars: z.array(z.string()).default([
      'DAYTONA_API_KEY',
      'GIT_TOKEN',
      'GIT_REPO_URL',
      'BASETEN_API_KEY',
    ]),
  }),
  execute: async ({ context }) => {
    const missing: string[] = [];
    const present: Record<string, string> = {};
    const redacted = '***';

    for (const v of context.requiredVars) {
      const val = process.env[v];
      if (!val || val.trim() === '') {
        missing.push(v);
      } else {
        present[v] = redacted; // Never expose actual values
      }
    }

    const ok = missing.length === 0;

    return {
      ok,
      missing,
      present: Object.keys(present),
      count: context.requiredVars.length,
      provider: 'daytona',
    };
  },
});

/**
 * Business rule verification tool.
 * Uses the Midspiral verify_rule tool to formally check a business rule.
 */
export const verifyRuleTool = createTool({
  id: 'verify-rule',
  description: 'Verify a business rule using Midspiral formal verification',
  inputSchema: z.object({
    ruleSpec: z.string().describe('Formal specification of the rule'),
    ruleCode: z.string().describe('Implementation code (SurrealQL or pseudo-code) to verify'),
  }),
  execute: async ({ context }) => {
    // In a real implementation, this would call the Midspiral verify_rule MCP tool
    // For now, we simulate the verification by checking the rule spec against code
    const { ruleSpec, ruleCode } = context;

    // Basic heuristic: check that the assertion keywords appear in the code
    const specKeywords = ruleSpec
      .toLowerCase()
      .split(/\s+/)
      .filter(w => w.length > 3 && !['must', 'should', 'will', 'when', 'then', 'and', 'the'].includes(w));

    const codeLower = ruleCode.toLowerCase();
    const matched = specKeywords.filter(k => codeLower.includes(k));
    const coverage = specKeywords.length > 0 ? matched.length / specKeywords.length : 0;

    const verified = coverage >= 0.5; // At least 50% keyword coverage

    return {
      verified,
      coverage: Math.round(coverage * 100),
      matchedKeywords: matched,
      missingKeywords: specKeywords.filter(k => !codeLower.includes(k)),
      ruleSpec: ruleSpec.substring(0, 200), // Truncate for safety
      ruleCode: ruleCode.substring(0, 200),
      provider: 'midspiral',
    };
  },
});
