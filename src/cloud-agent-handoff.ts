/**
 * Production-Grade Cloud Agent Handoff
 * 
 * Integrates with chain-daytona-opencode-prd.ts for real implementation:
 * 1. Baseten chain generates plan
 * 2. Daytona creates sandbox
 * 3. Bootstrap starts opencode serve
 * 4. Agent executes PRD inside sandbox
 * 5. Git commits on branch + runs tests + makes PR
 * 
 * Usage:
 *   npx tsx src/cloud-agent-handoff.ts --task "implement feature X" --target assistant-ui --execute
 *   npx tsx src/cloud-agent-handoff.ts --plan-file plan.md --execute-only
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  AgentHandoffRequest,
  AgentHandoffResult,
  createLogger,
  generateId,
  loadEnv,
  parseArgs,
  sleep,
  retry,
  getDefaultConfig,
  type OrchestratorConfig,
} from './types.js';
import { BasetenChainSandbox } from './baseten-chain-sandbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
// Point to the gpu-inference-stack for real scripts
const STACK_DIR = process.env.GPU_INFERENCE_STACK_DIR || 
  path.resolve(ROOT_DIR, '..', 'gpu-inference-stack');
const STATE_FILE = process.env.SANDBOX_STATE_FILE || '/tmp/cloud-agent-handoff-state.json';

const log = createLogger('cloud-agent-handoff', process.env.VERBOSE === '1');

interface HandoffOptions {
  task: string;
  target: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  sandboxProvider: 'daytona' | 'northflank';
  planOnly: boolean;
  executeOnly: boolean;
  full: boolean;
  dryRun: boolean;
  useChain: boolean;
  chainSpecialty: string;
  branchPrefix: string;
  sandboxId?: string;
  planFile?: string;
  timeout: number;
  keepSandbox: boolean;
  destroy: boolean;
  verbose: boolean;
}

function parseHandoffArgs(argv: string[]): HandoffOptions {
  const defaults = {
    task: '',
    target: 'assistant-ui',
    priority: 'normal' as const,
    sandboxProvider: (process.env.SANDBOX_PROVIDER || 'daytona') as 'daytona' | 'northflank',
    planOnly: false,
    executeOnly: false,
    full: false,
    dryRun: false,
    useChain: true,
    chainSpecialty: process.env.SMART_ROUTER_CHAIN_SPECIALTY || 'prd-daytona-execute',
    branchPrefix: 'feat/cloud-agent',
    sandboxId: '',
    planFile: '',
    timeout: parseInt(process.env.CHAIN_DAYTONA_TIMEOUT_SEC || '1800', 10),
    keepSandbox: false,
    destroy: false,
    verbose: false,
  };

  return parseArgs(argv, defaults) as HandoffOptions;
}

function validateConfig(opts: HandoffOptions, config: OrchestratorConfig): void {
  if (!opts.task && !opts.executeOnly) {
    throw new Error('Task required unless --execute-only is set');
  }
  if (!config.basetenApiKey && opts.useChain) {
    log.warn('BASETEN_API_KEY not set, using local plan only');
    opts.useChain = false;
  }
  if (opts.sandboxProvider === 'daytona' && !config.daytonaApiKey) {
    log.warn('DAYTONA_API_KEY not set, forcing dry-run');
    opts.dryRun = true;
  }
  if (!opts.dryRun && opts.sandboxProvider === 'daytona' && !config.daytonaApiKey) {
    throw new Error('DAYTONA_API_KEY required for live Daytona execution. Set or use --dry-run');
  }
}

function ensureGitEnv(): void {
  if (!process.env.GIT_REPO_URL) {
    const origin = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: ROOT_DIR,
      encoding: 'utf8',
    });
    let url = (origin.stdout || '').trim();
    if (url.startsWith('git@')) {
      url = url.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '') + '.git';
    }
    url = url.replace(/https:\/\/[^@]+@/, 'https://');
    if (url) process.env.GIT_REPO_URL = url;
  }
  if (!process.env.GIT_TOKEN) {
    process.env.GIT_TOKEN = 
      process.env.GH_TOKEN || process.env.DAYTONA_GITHUB_TOKEN || process.env.GITHUB_TOKEN || '';
  }
  if (!process.env.GIT_REPO_URL) {
    // Fallback to stack repo
    const stackOrigin = spawnSync('git', ['remote', 'get-url', 'origin'], {
      cwd: STACK_DIR,
      encoding: 'utf8',
    });
    let url = (stackOrigin.stdout || '').trim();
    if (url.startsWith('git@')) {
      url = url.replace(/^git@([^:]+):/, 'https://$1/').replace(/\.git$/, '') + '.git';
    }
    url = url.replace(/https:\/\/[^@]+@/, 'https://');
    if (url) process.env.GIT_REPO_URL = url;
  }
}

function run(
  cmd: string,
  args: string[],
  extraEnv?: NodeJS.ProcessEnv,
): { status: number; stdout: string; stderr: string } {
  const r = spawnSync(cmd, args, {
    cwd: STACK_DIR,
    encoding: 'utf8',
    env: { ...process.env, ...extraEnv, SANDBOX_STATE_FILE: STATE_FILE },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout || '',
    stderr: r.stderr || '',
  };
}

function daytona(args: string[], dryRun: boolean): { status: number; stdout: string } {
  const extra = dryRun ? ['--dry-run'] : [];
  const r = run('bash', [path.join(STACK_DIR, 'scripts/sandbox-daytona.sh'), ...extra, ...args], {
    AGENT_RUNTIME: 'opencode-sdk',
    SANDBOX_PROVIDER: 'daytona',
    DAYTONA_SDK_READY: '1',
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.stderr) process.stderr.write(r.stderr);
  return { status: r.status, stdout: `${r.stdout}${r.stderr}` };
}

function runChain(opts: HandoffOptions, planText: string): { status: number; stdout: string } {
  const isNorthflank = opts.sandboxProvider === 'northflank';
  const script = isNorthflank
    ? path.join(STACK_DIR, 'scripts/chain-sandbox-bridge.ts')
    : path.join(STACK_DIR, 'scripts/chain-daytona-opencode-prd.ts');
  if (!fs.existsSync(script)) {
    log.error('Chain script not found at', script);
    return { status: 1, stdout: '' };
  }

  const args = [
    'npx', '--yes', 'tsx', script,
    '--prd', planText.slice(0, 12000),
    '--branch', `${opts.branchPrefix}-${Date.now().toString(36)}`,
    '--specialty', opts.chainSpecialty,
    '--timeout', String(opts.timeout),
  ];

  if (opts.dryRun) args.push('--dry-run');
  if (opts.executeOnly) args.push('--execute-only');
  if (opts.keepSandbox) args.push('--keep-sandbox');
  if (opts.destroy) args.push('--destroy');
  if (isNorthflank) {
    args.push('--sandbox-provider', 'northflank');
  }

  log.info(`Running ${path.basename(script)}`, { args: args.slice(4) });

  const env: Record<string, string> = {
    AGENT_RUNTIME: 'opencode-sdk',
    SANDBOX_PROVIDER: opts.sandboxProvider,
    CHAIN_DAYTONA_TIMEOUT_SEC: String(opts.timeout),
  };
  if (!isNorthflank) {
    env.DAYTONA_SDK_READY = '1';
  }

  const r = run(args[0], args.slice(1), env);

  return { status: r.status, stdout: r.stdout };
}

async function generatePlanViaChain(
  request: AgentHandoffRequest,
  opts: HandoffOptions,
  config: OrchestratorConfig
): Promise<{ planText: string; planPath: string }> {
  const planDir = path.join(ROOT_DIR, 'tmp', 'plans');
  fs.mkdirSync(planDir, { recursive: true });
  const planPath = path.join(planDir, `${request.id}-plan.md`);

  if (opts.dryRun) {
    const planText = `# Cloud Agent Handoff Plan

## Task: ${request.task}

## Target: ${request.target}

## Priority: ${request.priority}

## Implementation Plan

### 1. Analyze Requirements
- [ ] Understand task: ${request.task}
- [ ] Review existing codebase in ${request.target}

### 2. Design Implementation
- [ ] Plan architecture and changes
- [ ] Identify files to modify

### 3. Implement Changes
- [ ] Write code in sandbox environment
- [ ] Follow project conventions

### 4. Test and Validate
- [ ] Run existing tests: \`npm test\`
- [ ] Add new tests for the feature
- [ ] Verify all tests pass
- [ ] Run linting and type checking

### 5. Commit and Create PR
- [ ] Create branch: feat/dry-run-${Date.now().toString(36)}
- [ ] Commit with descriptive message
- [ ] Push to remote
- [ ] Create PR with description

## Done When
- [ ] Feature fully implemented
- [ ] All tests passing
- [ ] Code committed on feature branch
- [ ] PR created
- [ ] Print OPENCODE_SDK_OK when finished

---

*Generated by cloud-agent-handoff (dry-run)*
`;
    fs.writeFileSync(planPath, planText);
    return { planText, planPath };
  }

  if (!config.basetenApiKey) {
    log.info('No BASETEN_API_KEY, using local plan');
    const planText = generateLocalPlan(request);
    fs.writeFileSync(planPath, planText);
    return { planText, planPath };
  }

  // Use portfolio chain for planning
  const chain = new BasetenChainSandbox(config);
  const result = await retry(
    () => chain.executeChain({
      specialty: opts.chainSpecialty,
      input: {
        task: request.task,
        target: request.target,
        priority: request.priority,
        context: request.context,
        operation: 'plan',
      },
      timeout: 60000,
    }),
    { attempts: 2, delay: 2000 }
  );

  if (result.ok && result.plan) {
    fs.writeFileSync(planPath, result.plan);
    log.info('Plan generated via chain', { planPath, executionId: result.executionId });
    return { planText: result.plan, planPath };
  }

  log.warn('Chain planning failed, using local fallback', result.error);
  const planText = generateLocalPlan(request);
  fs.writeFileSync(planPath, planText);
  return { planText, planPath };
}

function generateLocalPlan(request: AgentHandoffRequest): string {
  const branch = `${request.branchPrefix || 'feat/cloud-agent'}-${Date.now().toString(36)}`;
  return `# Cloud Agent Handoff: ${request.task}

## Request Details

- **ID**: ${request.id}
- **Target**: ${request.target}
- **Priority**: ${request.priority}
- **Branch**: ${branch}
- **Timestamp**: ${new Date().toISOString()}

## Implementation Plan

### 1. Analyze Requirements
- [ ] Understand task: ${request.task}
- [ ] Review existing codebase in ${request.target}
- [ ] Identify dependencies and constraints

### 2. Design Implementation
- [ ] Plan architecture and changes
- [ ] Identify files to modify
- [ ] Design API/interfaces if needed

### 3. Implement Changes
- [ ] Write code in sandbox environment
- [ ] Follow project conventions and style guides
- [ ] Add error handling and edge cases

### 4. Test and Validate
- [ ] Run existing tests: \`npm test\` or equivalent
- [ ] Add new tests for the new feature
- [ ] Verify all tests pass
- [ ] Check code coverage
- [ ] Run linting and type checking
- [ ] Validate against requirements

### 5. Commit and Create PR
- [ ] Create branch: ${branch}
- [ ] Commit with descriptive message
- [ ] Push to remote
- [ ] Create PR with description
- [ ] Link to requirements/ticket

## Context

${request.context ? JSON.stringify(request.context, null, 2) : 'No additional context provided.'}

## Done When

- [ ] Feature fully implemented according to requirements
- [ ] All tests passing (existing + new)
- [ ] Code reviewed and linted
- [ ] Committed on feature branch: ${branch}
- [ ] PR created with description
- [ ] Print OPENCODE_SDK_OK when finished

---

*Generated by cloud-agent handoff*
`;
}

async function executeInSandbox(
  request: AgentHandoffRequest,
  planText: string,
  opts: HandoffOptions
): Promise<{ ok: boolean; steps: Array<{ step: string; ok: boolean; detail?: string }>; sandboxId?: string; branch?: string }> {
  const steps: Array<{ step: string; ok: boolean; detail?: string }> = [];
  
  if (opts.dryRun) {
    log.info('dry-run: simulating sandbox execution');
    steps.push(
      { step: 'daytona_create', ok: true, detail: 'dry-run: simulated sandbox creation' },
      { step: 'daytona_bootstrap', ok: true, detail: 'dry-run: simulated bootstrap' },
      { step: 'agent_execute', ok: true, detail: 'dry-run: simulated agent execution' },
      { step: 'tests_run', ok: true, detail: 'dry-run: simulated test run' },
      { step: 'git_commit', ok: true, detail: 'dry-run: simulated git commit' }
    );
    return { ok: true, steps, sandboxId: 'dry-run-sandbox-123', branch: 'feat/dry-run-test' };
  }

  if (opts.sandboxProvider !== 'daytona' && opts.sandboxProvider !== 'northflank') {
    throw new Error(`Sandbox provider ${opts.sandboxProvider} not yet implemented. Use daytona or northflank.`);
  }

  // Use the real chain-daytona-opencode-prd.ts script
  log.info(`Executing in ${opts.sandboxProvider} sandbox via chain script`);
  const result = runChain(opts, planText);
  
  // Parse result for steps
  try {
    const resultJson = JSON.parse(result.stdout.trim().split('\n').pop() || '{}');
    if (resultJson.ok) {
      steps.push({ step: 'chain_daytona_prd', ok: true, detail: 'Executed via chain-daytona-opencode-prd' });
      
      // Read sandbox state if available
      let sandboxId: string | undefined;
      try {
        if (fs.existsSync(STATE_FILE)) {
          const state = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as { sandbox_id?: string };
          sandboxId = state.sandbox_id;
        }
      } catch { /* ignore */ }
      
      return { 
        ok: true, 
        steps, 
        sandboxId,
        branch: resultJson.branch 
      };
    } else {
      steps.push({ step: 'chain_daytona_prd', ok: false, detail: result.stdout.slice(0, 500) });
      return { ok: false, steps };
    }
  } catch {
    steps.push({ step: 'chain_daytona_prd', ok: result.status === 0, detail: result.stdout.slice(0, 500) });
    return { ok: result.status === 0, steps };
  }
}

async function main(): Promise<void> {
  loadEnv(ROOT_DIR);
  loadEnv(STACK_DIR);
  ensureGitEnv();
  
  const opts = parseHandoffArgs(process.argv.slice(2));
  const config = getDefaultConfig();
  
  if (opts.verbose) config.verbose = true;
  
  log.info('Starting cloud agent handoff', {
    task: opts.task,
    target: opts.target,
    provider: opts.sandboxProvider,
    executeOnly: opts.executeOnly,
    dryRun: opts.dryRun,
  });

  validateConfig(opts, config);

  const handoffId = generateId();
  const request: AgentHandoffRequest = {
    id: handoffId,
    task: opts.task,
    target: opts.target,
    priority: opts.priority,
    sandboxProvider: opts.sandboxProvider,
    useChain: opts.useChain,
    chainSpecialty: opts.chainSpecialty,
    branchPrefix: opts.branchPrefix,
    timeout: opts.timeout,
    tags: ['cloud-agent-handoff', opts.target, opts.chainSpecialty],
  };

  let planText = '';
  let planPath = opts.planFile || '';

  // Plan phase
  if (!opts.executeOnly) {
    if (opts.planFile) {
      if (!fs.existsSync(opts.planFile)) {
        throw new Error(`Plan file not found: ${opts.planFile}`);
      }
      planText = fs.readFileSync(opts.planFile, 'utf8');
      planPath = opts.planFile;
    } else {
      const planResult = await generatePlanViaChain(request, opts, config);
      planText = planResult.planText;
      planPath = planResult.planPath;
    }
  }

  // Execute phase
  let executeResult: AgentHandoffResult['executeResults'] = [];
  let sandboxId: string | undefined;
  let branch: string | undefined;
  
  if (!opts.planOnly) {
    if (!planText) {
      throw new Error('No plan available for execution. Provide --plan-file or --task');
    }
    
    const execResult = await executeInSandbox(request, planText, opts);
    executeResult = execResult.steps.map(step => ({
      segment: '01',
      status: step.ok ? 'ok' : 'error' as const,
      details: step.detail,
    }));
    sandboxId = execResult.sandboxId;
    branch = execResult.branch;
  }

  // Build result
  const result: AgentHandoffResult = {
    ok: !executeResult.length || executeResult.every(r => r.status === 'ok'),
    id: handoffId,
    sandboxProvider: opts.sandboxProvider,
    sandboxId,
    planFiles: planPath ? [planPath] : undefined,
    executeResults: executeResult,
    timestamp: new Date().toISOString(),
  };

  // Save result
  const resultsDir = path.join(ROOT_DIR, 'tmp', 'results');
  fs.mkdirSync(resultsDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultsDir, `${handoffId}.json`),
    JSON.stringify(result, null, 2)
  );

  log.info('Handoff complete', { id: handoffId, ok: result.ok, branch, sandboxId });
  console.log(JSON.stringify({ ...result, branch }, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    log.error('Fatal error', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export default {};
