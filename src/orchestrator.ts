/**
 * Cloud Agent Orchestrator
 * 
 * Combines cloud agent handoff via OpenCode skills with Baseten chain sandbox communication.
 * Supports multiple modes: waterfall (chain soft-try → sync), handoff-only, chain-sandbox-only, and full.
 * 
 * Usage:
 *   npx tsx src/orchestrator.ts --mode handoff --task "implement feature" --target assistant-ui
 *   npx tsx src/orchestrator.ts --mode chain-sandbox --sandbox-id <id> --operation query
 *   npx tsx src/orchestrator.ts --mode full --task "implement feature" --target assistant-ui
 *   npx tsx src/orchestrator.ts --mode waterfall --task "implement feature" --target assistant-ui
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  AgentHandoffRequest,
  AgentHandoffResult,
  SandboxChainRequest,
  SandboxChainResponse,
  OrchestratorConfig,
  ChainExecutionResult,
  createLogger,
  generateId,
  loadEnv,
  parseArgs,
  sleep,
  retry,
  getDefaultConfig,
} from './types.js';
import { BasetenChainSandbox } from './baseten-chain-sandbox.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');

const log = createLogger('orchestrator', process.env.VERBOSE === '1');

interface OrchestratorOptions {
  mode: 'handoff' | 'chain-sandbox' | 'full' | 'waterfall';
  task: string;
  target: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  sandboxProvider: 'daytona' | 'northflank';
  sandboxId: string;
  operation: SandboxChainRequest['operation'];
  planFile: string;
  planOnly: boolean;
  executeOnly: boolean;
  dryRun: boolean;
  useChain: boolean;
  chainSpecialty: string;
  branchPrefix: string;
  timeout: number;
  verbose: boolean;
  outputFormat: 'json' | 'yaml' | 'markdown';
}

function parseOrchestratorArgs(argv: string[]): OrchestratorOptions {
  const defaults = {
    mode: 'waterfall' as const,
    task: '',
    target: 'assistant-ui',
    priority: 'normal' as const,
    sandboxProvider: (process.env.SANDBOX_PROVIDER || 'daytona') as 'daytona' | 'northflank',
    sandboxId: '',
    operation: 'query' as SandboxChainRequest['operation'],
    planFile: '',
    planOnly: false,
    executeOnly: false,
    dryRun: false,
    useChain: true,
    chainSpecialty: process.env.SMART_ROUTER_CHAIN_SPECIALTY || 'opencode-agent-wiring',
    branchPrefix: 'feat/cloud-agent',
    timeout: parseInt(process.env.SMART_ROUTER_WATERFALL_CHAIN_TIMEOUT_MS || '60000', 10),
    verbose: false,
    outputFormat: 'json' as const,
  };

  return parseArgs(argv, defaults) as OrchestratorOptions;
}

/** Cloud Agent Orchestrator - main orchestration class */
export class CloudAgentOrchestrator {
  private config: OrchestratorConfig;
  private chainClient: BasetenChainSandbox;
  private logger: ReturnType<typeof createLogger>;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.chainClient = new BasetenChainSandbox(config);
    this.logger = createLogger('orchestrator', config.verbose);
  }

  /** Execute handoff + chain + sandbox in waterfall mode */
  async waterfall(request: AgentHandoffRequest): Promise<AgentHandoffResult> {
    this.logger.info('Waterfall mode: chain soft-try → sync fallback');
    
    const handoffId = request.id || generateId();
    request.id = handoffId;
    
    let planFiles: string[] = [];
    let chainResult: ChainExecutionResult | undefined;
    let executeResults: AgentHandoffResult['executeResults'];

    // Phase 1: Try chain planning (soft-try with timeout)
    if (request.useChain) {
      this.logger.info('Phase 1: Chain soft-try');
      try {
        const chainPromise = this.planViaChain(request);
        const timeoutPromise = new Promise<ChainExecutionResult>((_, reject) => {
          setTimeout(() => reject(new Error('Chain timeout')), this.config.chainTimeoutMs);
        });
        
        chainResult = await Promise.race([chainPromise, timeoutPromise]);
        
        if (chainResult.ok && chainResult.plan) {
          const planFile = this.savePlan(handoffId, chainResult.plan, 'chain');
          planFiles = [planFile];
          this.logger.info('Chain planning succeeded');
        } else {
          this.logger.warn('Chain planning failed or no plan, falling back to sync', chainResult?.error);
        }
      } catch (err) {
        this.logger.warn('Chain soft-try failed (timeout or error), falling back to sync', 
          err instanceof Error ? err.message : String(err));
      }
    }

    // Phase 2: Sync fallback if chain failed
    if (!planFiles.length) {
      this.logger.info('Phase 2: Sync fallback');
      const plan = this.generateSyncPlan(request);
      const planFile = this.savePlan(handoffId, plan, 'sync');
      planFiles = [planFile];
    }

    // Phase 3: Execute in sandbox (via chain or direct)
    if (!request.planOnly) {
      this.logger.info('Phase 3: Execution');
      executeResults = await this.executeInSandbox(request, planFiles);
    }

    return this.buildResult(request, planFiles, executeResults, chainResult);
  }

  /** Handoff only mode - no chain, direct sandbox execution */
  async handoff(request: AgentHandoffRequest): Promise<AgentHandoffResult> {
    this.logger.info('Handoff mode: direct sandbox execution');
    
    const handoffId = request.id || generateId();
    request.id = handoffId;
    
    // Generate plan locally
    const plan = this.generateSyncPlan(request);
    const planFile = this.savePlan(handoffId, plan, 'handoff');
    
    // Execute directly
    let executeResults: AgentHandoffResult['executeResults'];
    if (!request.planOnly) {
      executeResults = await this.executeInSandbox(request, [planFile]);
    }

    return this.buildResult(request, [planFile], executeResults);
  }

  /** Chain-sandbox only mode - only chain communication with running sandbox */
  async chainSandbox(request: SandboxChainRequest): Promise<SandboxChainResponse> {
    this.logger.info('Chain-sandbox mode: direct chain communication');
    
    return this.chainClient.communicateWithSandbox(request);
  }

  /** Full mode - chain + sandbox with full orchestration */
  async full(request: AgentHandoffRequest): Promise<AgentHandoffResult> {
    this.logger.info('Full mode: chain + sandbox full orchestration');
    
    const handoffId = request.id || generateId();
    request.id = handoffId;
    
    // Plan via chain
    const chainResult = await this.planViaChain(request);
    let planFiles: string[] = [];
    
    if (chainResult.ok && chainResult.plan) {
      const planFile = this.savePlan(handoffId, chainResult.plan, 'chain');
      planFiles = [planFile];
    } else {
      this.logger.warn('Chain planning failed, using fallback', chainResult?.error);
      const plan = this.generateSyncPlan(request);
      const planFile = this.savePlan(handoffId, plan, 'fallback');
      planFiles = [planFile];
    }

    // Execute
    let executeResults: AgentHandoffResult['executeResults'];
    if (!request.planOnly) {
      executeResults = await this.executeInSandbox(request, planFiles);
    }

    return this.buildResult(request, planFiles, executeResults, chainResult);
  }

  /** Plan via Baseten chain */
  private async planViaChain(request: AgentHandoffRequest): Promise<ChainExecutionResult> {
    return this.chainClient.executeChain({
      specialty: request.chainSpecialty || this.config.defaultChainSpecialty,
      input: {
        task: request.task,
        target: request.target,
        priority: request.priority,
        context: request.context,
        operation: 'plan',
      },
      timeout: request.timeout || this.config.chainTimeoutMs,
    });
  }

  /** Generate a sync plan locally */
  private generateSyncPlan(request: AgentHandoffRequest): string {
    const branch = `${request.branchPrefix || 'feat/cloud-agent'}-${Date.now().toString(36)}`;
    return `# Cloud Agent Orchestrator: ${request.task}

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

*Generated by cloud-agent orchestrator (sync mode)*
`;
  }

  /** Save plan to tmp directory */
  private savePlan(handoffId: string, plan: string, source: string): string {
    const planDir = path.join(ROOT_DIR, 'tmp', 'plans');
    fs.mkdirSync(planDir, { recursive: true });
    
    const planFile = path.join(planDir, `${handoffId}-${source}.md`);
    fs.writeFileSync(planFile, plan);
    
    this.logger.info('Plan saved', { planFile, source });
    return planFile;
  }

  /** Execute in sandbox */
  private async executeInSandbox(
    request: AgentHandoffRequest,
    planFiles: string[]
  ): Promise<AgentHandoffResult['executeResults']> {
    const results: AgentHandoffResult['executeResults'] = [];
    
    if (this.config.dryRun) {
      this.logger.info('Dry-run: simulating sandbox execution');
      for (let i = 0; i < planFiles.length; i++) {
        results.push({
          segment: String(i + 1).padStart(2, '0'),
          status: 'ok',
          details: 'Dry-run execution (no actual sandbox interaction)',
        });
      }
      return results;
    }

    for (let i = 0; i < planFiles.length; i++) {
      const planFile = planFiles[i];
      const segment = String(i + 1).padStart(2, '0');
      const branch = `${request.branchPrefix || 'feat/cloud-agent'}-seg-${segment}`;
      
      this.logger.info(`Executing segment ${segment}`, { planFile, branch });

      try {
        if (request.sandboxId) {
          // Communicate with existing sandbox
          const response = await this.chainClient.communicateWithSandbox({
            specialty: request.chainSpecialty || this.config.defaultChainSpecialty,
            sandboxId: request.sandboxId,
            operation: 'execute',
            payload: {
              planFile,
              branch,
              task: request.task,
              target: request.target,
            },
          });

          results.push({
            segment,
            status: response.ok ? 'ok' : 'error',
            branch,
            details: response.ok
              ? `Executed in sandbox ${request.sandboxId}`
              : `Failed: ${response.error}`,
          });
        } else {
          // Create new sandbox via chain
          const response = await this.chainClient.executeChain({
            specialty: 'prd-daytona-execute',
            input: {
              planFile,
              branch,
              task: request.task,
              target: request.target,
              provider: request.sandboxProvider || this.config.defaultSandboxProvider,
              operation: 'execute',
            },
          });

          results.push({
            segment,
            status: response.ok ? 'ok' : 'error',
            branch,
            details: response.ok
              ? `Executed via chain (${response.executionId})`
              : `Failed: ${response.error}`,
          });
        }
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        this.logger.error(`Segment ${segment} failed`, error);
        results.push({
          segment,
          status: 'error',
          branch,
          details: error,
        });
      }
    }

    return results;
  }

  /** Build final result */
  private buildResult(
    request: AgentHandoffRequest,
    planFiles: string[],
    executeResults?: AgentHandoffResult['executeResults'],
    chainResult?: ChainExecutionResult
  ): AgentHandoffResult {
    const result: AgentHandoffResult = {
      ok: !executeResults || executeResults.every(r => r.status === 'ok'),
      id: request.id,
      sandboxProvider: request.sandboxProvider || this.config.defaultSandboxProvider,
      chainExecutionId: chainResult?.executionId,
      planFiles,
      executeResults,
      timestamp: new Date().toISOString(),
    };

    // Save result
    const resultsDir = path.join(ROOT_DIR, 'tmp', 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    fs.writeFileSync(
      path.join(resultsDir, `${request.id}.json`),
      JSON.stringify(result, null, 2)
    );

    return result;
  }

  /** Monitor a running sandbox */
  async monitorSandbox(sandboxId: string, interval = 10000): Promise<void> {
    await this.chainClient.monitorSandbox(sandboxId, interval);
  }

  /** Query sandbox status */
  async querySandbox(sandboxId: string): Promise<SandboxChainResponse> {
    return this.chainClient.querySandboxStatus(sandboxId);
  }

  /** Get sandbox logs */
  async getSandboxLogs(sandboxId: string, lines = 100): Promise<SandboxChainResponse> {
    return this.chainClient.getSandboxLogs(sandboxId, lines);
  }

  /** Pause sandbox */
  async pauseSandbox(sandboxId: string): Promise<SandboxChainResponse> {
    return this.chainClient.pauseSandbox(sandboxId);
  }

  /** Resume sandbox */
  async resumeSandbox(sandboxId: string): Promise<SandboxChainResponse> {
    return this.chainClient.resumeSandbox(sandboxId);
  }
}

/** CLI entry point */
async function main(): Promise<void> {
  loadEnv(ROOT_DIR);
  const opts = parseOrchestratorArgs(process.argv.slice(2));
  const config = getDefaultConfig();
  
  if (opts.verbose) config.verbose = true;
  if (opts.dryRun) config.dryRun = true;
  
  config.mode = opts.mode;

  const orchestrator = new CloudAgentOrchestrator(config);

  log.info('Starting orchestrator', {
    mode: opts.mode,
    task: opts.task,
    target: opts.target,
    sandboxProvider: opts.sandboxProvider,
  });

  let result: AgentHandoffResult | SandboxChainResponse | undefined;

  switch (opts.mode) {
    case 'waterfall': {
      if (!opts.task) {
        log.error('Task required for waterfall mode');
        process.exit(1);
      }
      const request: AgentHandoffRequest = {
        id: generateId(),
        task: opts.task,
        target: opts.target,
        priority: opts.priority,
        sandboxProvider: opts.sandboxProvider,
        planOnly: opts.planOnly,
        useChain: opts.useChain,
        chainSpecialty: opts.chainSpecialty,
        branchPrefix: opts.branchPrefix,
        timeout: opts.timeout,
      };
      result = await orchestrator.waterfall(request);
      break;
    }

    case 'handoff': {
      if (!opts.task) {
        log.error('Task required for handoff mode');
        process.exit(1);
      }
      const request: AgentHandoffRequest = {
        id: generateId(),
        task: opts.task,
        target: opts.target,
        priority: opts.priority,
        sandboxProvider: opts.sandboxProvider,
        planOnly: opts.planOnly,
        useChain: false, // Handoff mode doesn't use chain
        chainSpecialty: opts.chainSpecialty,
        branchPrefix: opts.branchPrefix,
      };
      result = await orchestrator.handoff(request);
      break;
    }

    case 'chain-sandbox': {
      if (!opts.sandboxId) {
        log.error('sandbox-id required for chain-sandbox mode');
        process.exit(1);
      }
      const request: SandboxChainRequest = {
        specialty: opts.chainSpecialty,
        sandboxId: opts.sandboxId,
        operation: opts.operation,
        payload: {},
      };
      result = await orchestrator.chainSandbox(request);
      break;
    }

    case 'full': {
      if (!opts.task) {
        log.error('Task required for full mode');
        process.exit(1);
      }
      const request: AgentHandoffRequest = {
        id: generateId(),
        task: opts.task,
        target: opts.target,
        priority: opts.priority,
        sandboxProvider: opts.sandboxProvider,
        planOnly: opts.planOnly,
        useChain: opts.useChain,
        chainSpecialty: opts.chainSpecialty,
        branchPrefix: opts.branchPrefix,
        timeout: opts.timeout,
      };
      result = await orchestrator.full(request);
      break;
    }

    default: {
      log.error('Unknown mode', opts.mode);
      process.exit(1);
    }
  }

  // Output result
  if (opts.outputFormat === 'json') {
    console.log(JSON.stringify(result, null, 2));
  } else if (opts.outputFormat === 'yaml') {
    // Simple YAML output
    console.log('---');
    console.log(JSON.stringify(result, null, 2).replace(/"/g, '').replace(/:/g, ':').replace(/,/g, ''));
  } else {
    console.log('# Result\n');
    console.log(JSON.stringify(result, null, 2));
  }

  // Determine exit code
  if ('ok' in result && !result.ok) {
    process.exit(1);
  }
  process.exit(0);
}

// Only run main if this is the entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    log.error('Fatal error', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export default CloudAgentOrchestrator;
