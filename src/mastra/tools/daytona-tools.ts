import { createTool } from './tool-shim.js';
import { z } from 'zod';
import { execSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import dotenv from 'dotenv';
import {
  getDaytonaClient,
  releaseDaytonaClient,
  readSandboxState,
  writeSandboxState,
  clearSandboxState,
  getActiveSandbox,
  defaultSandboxEnvs,
  execInSandbox,
  STATE_FILE,
} from './daytona-client.js';
import {
  resolveGithubToken,
  parseOwnerRepo,
  preflightRepoAccess,
} from '../lib/github-tokens.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLOUD_AGENT_ROOT = path.resolve(__dirname, '../../..');
dotenv.config({ path: path.join(CLOUD_AGENT_ROOT, '.env') });
dotenv.config({ path: path.join(CLOUD_AGENT_ROOT, '../.env') });

const STACK_DIR =
  process.env.GPU_INFERENCE_STACK_DIR ||
  path.resolve(CLOUD_AGENT_ROOT, '../gpu-inference-stack');
if (!process.env.GPU_INFERENCE_STACK_DIR) {
  process.env.GPU_INFERENCE_STACK_DIR = STACK_DIR;
}

/**
 * Daytona sandbox creation via @daytona/sdk (no provider.sh).
 */
export const daytonaCreateTool = createTool({
  id: 'daytona-create',
  description:
    'Create a Daytona sandbox via the Node @daytona/sdk (no shell provider scripts)',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
    timeoutSeconds: z.number().default(300),
    snapshot: z.string().default('daytona-large'),
  }),
  execute: async ({ context }) => {
    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: 'Daytona.create({ snapshot, language: python, envVars })',
        provider: 'daytona-sdk',
        stateFile: STATE_FILE,
      };
    }

    try {
      const daytona = getDaytonaClient();
      const envVars = defaultSandboxEnvs();
      const sandbox = await daytona.create(
        {
          language: 'python',
          snapshot: context.snapshot || process.env.DAYTONA_SNAPSHOT || 'daytona-large',
          envVars,
          autoStopInterval: 0,
          public: false,
          domainAllowList: process.env.DOMAIN_ALLOW || undefined,
        },
        { timeout: context.timeoutSeconds },
      );

      writeSandboxState({
        sandboxId: sandbox.id,
        createdAt: new Date().toISOString(),
      });

      return {
        ok: true,
        sandboxId: sandbox.id,
        provider: 'daytona-sdk',
        stateFile: STATE_FILE,
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        provider: 'daytona-sdk',
      };
    }
  },
});

/**
 * Bootstrap: clone repo via Daytona SDK git API + optional harness install.
 */
export const daytonaBootstrapTool = createTool({
  id: 'daytona-bootstrap',
  description:
    'Bootstrap a Daytona sandbox: clone GIT_REPO_URL via SDK git (credential from dual-account token resolver)',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
    timeoutSeconds: z.number().default(1800),
    repoUrl: z.string().default(''),
    branch: z.string().default('main'),
    targetPath: z.string().default('repo'),
  }),
  execute: async ({ context }) => {
    const repoUrl = context.repoUrl || process.env.GIT_REPO_URL || '';
    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `sandbox.git.clone(${repoUrl || '<GIT_REPO_URL>'}, ${context.targetPath})`,
        provider: 'daytona-sdk',
      };
    }

    if (!repoUrl) {
      return { ok: false, error: 'GIT_REPO_URL or repoUrl is required', provider: 'daytona-sdk' };
    }

    try {
      const { owner } = parseOwnerRepo(repoUrl);
      const resolved = resolveGithubToken(owner);
      await preflightRepoAccess(repoUrl, resolved.token);

      const { sandbox, state } = await getActiveSandbox();
      await sandbox.git.clone(
        repoUrl,
        context.targetPath,
        context.branch,
        undefined,
        resolved.token,
        'x-oauth-basic',
        undefined,
        1,
      );

      writeSandboxState({
        ...state,
        repoPath: context.targetPath,
      });

      return {
        ok: true,
        bootstrapped: true,
        repoUrl,
        branch: context.branch,
        targetPath: context.targetPath,
        tokenSource: resolved.source,
        provider: 'daytona-sdk',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        provider: 'daytona-sdk',
      };
    }
  },
});

/**
 * Connectivity check from inside the sandbox via SDK process.executeCommand.
 */
export const daytonaConnectivityTool = createTool({
  id: 'daytona-connectivity',
  description:
    'Check connectivity from Daytona sandbox to proxy/Baseten via SDK process.executeCommand',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
    timeoutSeconds: z.number().default(60),
  }),
  execute: async ({ context }) => {
    const probeUrl =
      process.env.BASETEN_PROXY_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      'https://inference.baseten.co/v1/models';

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `curl -s -o /dev/null -w '%{http_code}' ${probeUrl}`,
        provider: 'daytona-sdk',
      };
    }

    try {
      const { sandbox } = await getActiveSandbox();
      const cmd = `curl -s -o /dev/null -w '%{http_code}' --max-time 20 '${probeUrl}' || echo '000'`;
      const result = await execInSandbox(sandbox, cmd, {
        timeoutSeconds: context.timeoutSeconds,
      });
      const httpCode = (result.stdout || '').trim().slice(-3) || '000';
      const ok = httpCode.startsWith('2') || httpCode === '401' || httpCode === '403';

      return {
        ok,
        httpCode,
        url: probeUrl,
        mode: 'sdk-exec',
        provider: 'daytona-sdk',
        stdout: result.stdout.slice(0, 500),
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        provider: 'daytona-sdk',
      };
    }
  },
});

/**
 * Execute a shell task inside the sandbox via SDK (not provider.sh).
 */
export const daytonaExecTool = createTool({
  id: 'daytona-exec',
  description:
    'Execute a command or task in a Daytona sandbox via @daytona/sdk process.executeCommand',
  inputSchema: z.object({
    task: z.string().describe('The task or command to execute'),
    harness: z.enum(['goose', 'opencode', 'pi']).default('opencode'),
    runtime: z.string().default(''),
    timeoutSeconds: z.number().default(1800),
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: context.task,
        harness: context.harness,
        provider: 'daytona-sdk',
      };
    }

    try {
      const { sandbox } = await getActiveSandbox();
      // Prefer running the raw task as a shell command; harness metadata is advisory.
      const result = await execInSandbox(sandbox, context.task, {
        timeoutSeconds: context.timeoutSeconds,
      });
      return {
        ok: result.ok,
        exitCode: result.exitCode,
        output: result.stdout.slice(0, 8000),
        harness: context.harness,
        provider: 'daytona-sdk',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        provider: 'daytona-sdk',
      };
    }
  },
});

/**
 * Arbitrary shell command in sandbox via SDK.
 */
export const daytonaShellTool = createTool({
  id: 'daytona-shell',
  description:
    'Run an arbitrary shell command in a Daytona sandbox via @daytona/sdk (debug)',
  inputSchema: z.object({
    command: z.string().describe('Shell command to execute'),
    timeoutSeconds: z.number().default(120),
    dryRun: z.boolean().default(false),
  }),
  execute: async ({ context }) => {
    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: context.command,
        provider: 'daytona-sdk',
      };
    }

    try {
      const { sandbox } = await getActiveSandbox();
      const result = await execInSandbox(sandbox, context.command, {
        timeoutSeconds: context.timeoutSeconds,
      });
      return {
        ok: result.ok,
        exitCode: result.exitCode,
        output: result.stdout.slice(0, 8000),
        provider: 'daytona-sdk',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        provider: 'daytona-sdk',
      };
    }
  },
});

/**
 * Destroy active sandbox via SDK.
 */
export const daytonaDestroyTool = createTool({
  id: 'daytona-destroy',
  description: 'Destroy the active Daytona sandbox via @daytona/sdk delete',
  inputSchema: z.object({
    dryRun: z.boolean().default(false),
    sandboxId: z.string().default(''),
  }),
  execute: async ({ context }) => {
    const state = readSandboxState();
    const sandboxId = context.sandboxId || state?.sandboxId || '';

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `daytona.delete(${sandboxId || '<active>'})`,
        provider: 'daytona-sdk',
      };
    }

    if (!sandboxId) {
      return { ok: false, error: 'No sandboxId to destroy', provider: 'daytona-sdk' };
    }

    try {
      const daytona = getDaytonaClient();
      const sandbox = await daytona.get(sandboxId);
      await daytona.delete(sandbox, 60, true);
      clearSandboxState();
      releaseDaytonaClient();
      return {
        ok: true,
        destroyed: true,
        sandboxId,
        provider: 'daytona-sdk',
      };
    } catch (error: any) {
      clearSandboxState();
      releaseDaytonaClient();
      return {
        ok: false,
        error: error.message,
        sandboxId,
        provider: 'daytona-sdk',
      };
    }
  },
});

/**
 * Environment validation tool.
 */
export const envValidationTool = createTool({
  id: 'env-validation',
  description: 'Validate that required environment variables are present (secrets redacted)',
  inputSchema: z.object({
    requiredVars: z.array(z.string()).default([
      'DAYTONA_API_KEY',
      'BASETEN_API_KEY',
    ]),
  }),
  execute: async ({ context }) => {
    const missing: string[] = [];
    const present: string[] = [];

    for (const v of context.requiredVars) {
      const val = process.env[v];
      if (!val || val.trim() === '') {
        missing.push(v);
      } else {
        present.push(v);
      }
    }

    // Soft-check: dual-account resolver can supply GIT_TOKEN at bootstrap time
    let tokenResolverOk = false;
    try {
      const repoUrl = process.env.GIT_REPO_URL;
      if (repoUrl) {
        const { owner } = parseOwnerRepo(repoUrl);
        resolveGithubToken(owner);
        tokenResolverOk = true;
      } else {
        resolveGithubToken('BrightforestX');
        tokenResolverOk = true;
      }
    } catch {
      tokenResolverOk = false;
    }

    return {
      ok: missing.length === 0,
      missing,
      present,
      tokenResolverOk,
      count: context.requiredVars.length,
      provider: 'daytona-sdk',
    };
  },
});

/**
 * Business rule verification — prefers validationCmdExitCode over keyword theater.
 */
export const verifyRuleTool = createTool({
  id: 'verify-rule',
  description:
    'Verify a business rule. Prefer validationCmdExitCode/stdout as source of truth; keyword coverage is fallback only.',
  inputSchema: z.object({
    ruleSpec: z.string().describe('Formal specification of the rule'),
    ruleCode: z.string().describe('Implementation code or command output to verify'),
    validationCmdExitCode: z
      .number()
      .optional()
      .describe('Exit code from validation_cmd (0 = pass). When set, this is authoritative.'),
    validationCmdStdout: z.string().optional(),
  }),
  execute: async ({ context }) => {
    const { ruleSpec, ruleCode, validationCmdExitCode, validationCmdStdout } = context;

    if (typeof validationCmdExitCode === 'number') {
      const verified = validationCmdExitCode === 0;
      return {
        verified,
        coverage: verified ? 100 : 0,
        sourceOfTruth: 'validation_cmd',
        exitCode: validationCmdExitCode,
        stdout: (validationCmdStdout || '').slice(0, 500),
        ruleSpec: ruleSpec.substring(0, 200),
        provider: 'validation-cmd',
      };
    }

    const specKeywords = ruleSpec
      .toLowerCase()
      .split(/\s+/)
      .filter(
        (w) =>
          w.length > 3 &&
          !['must', 'should', 'will', 'when', 'then', 'and', 'the'].includes(w),
      );

    const codeLower = ruleCode.toLowerCase();
    const matched = specKeywords.filter((k) => codeLower.includes(k));
    const coverage = specKeywords.length > 0 ? matched.length / specKeywords.length : 0;
    const verified = coverage >= 0.5;

    return {
      verified,
      coverage: Math.round(coverage * 100),
      matchedKeywords: matched,
      missingKeywords: specKeywords.filter((k) => !codeLower.includes(k)),
      sourceOfTruth: 'keyword-fallback',
      ruleSpec: ruleSpec.substring(0, 200),
      ruleCode: ruleCode.substring(0, 200),
      provider: 'midspiral-heuristic',
    };
  },
});

/**
 * OpenCode loop — orchestration entrypoint (tsx script; not a sandbox provider).
 */
export const opencodeLoopTool = createTool({
  id: 'opencode-loop',
  description:
    'Run factory-opencode-loop.ts against sandbox OpenCode serve URLs (orchestration entrypoint; sandboxes must be created via daytona-sdk tools).',
  inputSchema: z.object({
    workItem: z.string().default('factory-item-02').describe('Work item id or YAML path'),
    batchFile: z.string().default('').describe('Optional batch YAML path'),
    opencodeBaseUrls: z
      .string()
      .default('')
      .describe('Comma-separated OpenCode serve URLs (sandbox preview URLs)'),
    dryRun: z.boolean().default(false),
    timeoutSeconds: z.number().default(1800),
  }),
  execute: async ({ context }) => {
    const loopScript = path.join(STACK_DIR, 'scripts/factory-opencode-loop.ts');
    if (!fs.existsSync(loopScript)) {
      return {
        ok: false,
        error: `factory-opencode-loop.ts not found at ${loopScript}`,
        stackDir: STACK_DIR,
      };
    }

    const args = ['tsx', loopScript, '--work-item', context.workItem];
    if (context.batchFile) {
      args.push('--batch-file', context.batchFile);
    }
    if (context.dryRun) {
      args.push('--dry-run');
    }

    const env = {
      ...process.env,
      SANDBOX_PROVIDER: 'daytona',
      ...(context.dryRun ? { DRY_RUN: '1' } : {}),
      ...(context.opencodeBaseUrls
        ? { OPENCODE_BASE_URLS: context.opencodeBaseUrls }
        : {}),
    };

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `npx ${args.join(' ')}`,
        cwd: STACK_DIR,
        envHints: {
          OPENCODE_BASE_URLS: context.opencodeBaseUrls || process.env.OPENCODE_BASE_URLS || '',
          DRY_RUN: '1',
        },
      };
    }

    try {
      const output = execSync(`npx ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
        env,
        timeout: context.timeoutSeconds * 1000,
        encoding: 'utf-8',
        cwd: STACK_DIR,
        maxBuffer: 8 * 1024 * 1024,
      });
      return {
        ok: true,
        output: output.trim().slice(-8000),
        workItem: context.workItem,
        provider: 'opencode-loop',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString()?.slice(-4000),
        stdout: error.stdout?.toString()?.slice(-4000),
        provider: 'opencode-loop',
      };
    }
  },
});

/**
 * SDLC batch — orchestration entrypoint into pybatch (Daytona Python SDK + dual-token).
 */
export const sdlcBatchTool = createTool({
  id: 'sdlc-batch',
  description:
    'Run pybatch SDLC loop: Daytona Python SDK sandboxes, dual-account GitHub token resolver, validation_cmd, PRs. Set jobsFile e.g. jobs-brightforest-meta.json.',
  inputSchema: z.object({
    jobsFile: z
      .string()
      .default('jobs-1-test.json')
      .describe('Jobs JSON filename under pybatch/ or absolute path'),
    dryRun: z.boolean().default(false),
    timeoutSeconds: z.number().default(3600),
  }),
  execute: async ({ context }) => {
    const cloudAgentRoot = path.resolve(__dirname, '../../..');
    const pybatchDir = path.join(cloudAgentRoot, 'pybatch');
    const runner = path.join(pybatchDir, 'run_test_batch.py');
    const jobsPath = path.isAbsolute(context.jobsFile)
      ? context.jobsFile
      : path.join(pybatchDir, context.jobsFile);

    if (!fs.existsSync(runner)) {
      return { ok: false, error: `Runner not found: ${runner}` };
    }
    if (!fs.existsSync(jobsPath)) {
      return { ok: false, error: `Jobs file not found: ${jobsPath}` };
    }

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `python3 ${runner}`,
        jobsFile: jobsPath,
        note: 'Dry-run validates paths; live run uses Daytona Python SDK + dual-token resolver.',
      };
    }

    try {
      const venvPython = path.join(pybatchDir, '.venv/bin/python');
      const pythonBin = fs.existsSync(venvPython) ? venvPython : 'python3';
      const output = execSync(`${JSON.stringify(pythonBin)} ${JSON.stringify(runner)}`, {
        env: {
          ...process.env,
          SDLC_JOBS_FILE: jobsPath,
          SANDBOX_PROVIDER: 'daytona',
        },
        timeout: context.timeoutSeconds * 1000,
        encoding: 'utf-8',
        cwd: pybatchDir,
        maxBuffer: 16 * 1024 * 1024,
      });
      return {
        ok: true,
        output: output.trim().slice(-10000),
        jobsFile: jobsPath,
        provider: 'sdlc-batch',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString()?.slice(-5000),
        stdout: error.stdout?.toString()?.slice(-5000),
        provider: 'sdlc-batch',
      };
    }
  },
});

/**
 * Mastra orchestrate — orchestration CLI entrypoint.
 */
export const mastraOrchestrateTool = createTool({
  id: 'mastra-orchestrate',
  description:
    'Run local Mastra Daytona orchestration workflow CLI (uses SDK-backed tools under the hood).',
  inputSchema: z.object({
    task: z.string().describe('Task for the sandbox agent'),
    harness: z.enum(['goose', 'opencode', 'pi']).default('opencode'),
    dryRun: z.boolean().default(false),
    skipCleanup: z.boolean().default(false),
    timeoutSeconds: z.number().default(3600),
  }),
  execute: async ({ context }) => {
    const cloudAgentRoot = path.resolve(__dirname, '../../..');
    const entry = path.join(cloudAgentRoot, 'src/mastra/index.ts');
    const args = [
      'tsx',
      entry,
      '--task',
      context.task,
      '--harness',
      context.harness,
    ];
    if (context.dryRun) args.push('--dry-run');
    if (context.skipCleanup) args.push('--skip-cleanup');

    if (context.dryRun) {
      return {
        ok: true,
        dryRun: true,
        command: `npx ${args.join(' ')}`,
        cwd: cloudAgentRoot,
      };
    }

    try {
      const output = execSync(`npx ${args.map((a) => JSON.stringify(a)).join(' ')}`, {
        env: { ...process.env, SANDBOX_PROVIDER: 'daytona' },
        timeout: context.timeoutSeconds * 1000,
        encoding: 'utf-8',
        cwd: cloudAgentRoot,
        maxBuffer: 8 * 1024 * 1024,
      });
      return {
        ok: true,
        output: output.trim().slice(-8000),
        provider: 'mastra',
      };
    } catch (error: any) {
      return {
        ok: false,
        error: error.message,
        stderr: error.stderr?.toString()?.slice(-4000),
        stdout: error.stdout?.toString()?.slice(-4000),
        provider: 'mastra',
      };
    }
  },
});
