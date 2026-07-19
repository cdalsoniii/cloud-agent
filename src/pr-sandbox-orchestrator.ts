/**
 * PR Sandbox Orchestrator
 * 
 * Creates a sandbox, merges PR changes, runs all tests, starts the app,
 * and creates a Cloudflare tunnel for external access.
 * 
 * Usage:
 *   npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr all
 *   npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr 123,456
 *   npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr all --dry-run
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, execSync } from 'node:child_process';
import fetch from 'node-fetch';
import {
  createLogger,
  generateId,
  loadEnv,
  parseArgs,
  sleep,
  retry,
  getDefaultConfig,
} from './types.js';
import { sessionTracker } from './session-tracker.js';
import { prSandboxIntegration } from './session-integration-examples.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const STACK_DIR = process.env.GPU_INFERENCE_STACK_DIR || path.resolve(ROOT_DIR, '..', 'gpu-inference-stack');

const log = createLogger('pr-sandbox', process.env.VERBOSE === '1');

interface PROptions {
  repo: string;
  pr: string; // 'all' or comma-separated PR numbers
  provider: 'daytona' | 'northflank';
  dryRun: boolean;
  timeout: number;
  verbose: boolean;
  keepSandbox: boolean;
  skipTests: boolean;
  skipTunnel: boolean;
  branch: string;
  githubToken: string;
}

function parsePROptions(argv: string[]): PROptions {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
PR Sandbox Orchestrator

Creates a sandbox, merges PR changes, runs all tests, starts the app,
and creates a Cloudflare tunnel for external access.

Usage:
  npx tsx src/pr-sandbox-orchestrator.ts [options]

Options:
  --repo <url>         Target repository URL (required)
  --pr <value>         PR strategy: 'all' or comma-separated numbers (default: all)
  --provider <name>    Sandbox provider: daytona|northflank (default: daytona)
  --branch <name>      Base branch to merge PRs into (default: main)
  --dry-run            Simulate execution without creating real resources
  --skip-tests         Skip running tests
  --skip-tunnel        Skip creating Cloudflare tunnel
  --keep-sandbox       Don't destroy sandbox after execution
  --timeout <seconds>  Execution timeout (default: 3600)
  --verbose            Enable verbose logging
  --help               Show this help message

Examples:
  # Merge all open PRs and create tunnel
  npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr all

  # Merge specific PRs
  npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr 123,456

  # Dry run to test without creating resources
  npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr 123 --dry-run

  # Skip tests and keep sandbox alive
  npx tsx src/pr-sandbox-orchestrator.ts --repo https://github.com/owner/repo --pr all --skip-tests --keep-sandbox

Environment Variables:
  GITHUB_TOKEN          GitHub personal access token (for fetching PRs)
  DAYTONA_API_KEY       Daytona API key (for sandbox creation)
  CLOUDFLARE_API_TOKEN  Cloudflare API token (for tunnel creation)
  CLOUDFLARE_ACCOUNT_ID Cloudflare account ID (for tunnel creation)
`);
    process.exit(0);
  }

  const defaults: Record<string, string | boolean | string[]> = {
    repo: '',
    pr: 'all',
    provider: (process.env.SANDBOX_PROVIDER || 'daytona') as string,
    dryRun: false,
    timeout: process.env.CHAIN_DAYTONA_TIMEOUT_SEC || '3600',
    verbose: false,
    keepSandbox: false,
    skipTests: false,
    skipTunnel: false,
    branch: 'main',
    githubToken: process.env.GITHUB_TOKEN || process.env.GH_TOKEN || process.env.GIT_TOKEN || '',
  };
  const parsed = parseArgs(argv, defaults);
  return {
    repo: parsed.repo as string,
    pr: parsed.pr as string,
    provider: parsed.provider as 'daytona' | 'northflank',
    dryRun: parsed.dryRun as boolean,
    timeout: parseInt(parsed.timeout as string, 10),
    verbose: parsed.verbose as boolean,
    keepSandbox: parsed.keepSandbox as boolean,
    skipTests: parsed.skipTests as boolean,
    skipTunnel: parsed.skipTunnel as boolean,
    branch: parsed.branch as string,
    githubToken: parsed.githubToken as string,
  };
}

interface GitHubPR {
  number: number;
  title: string;
  state: string;
  head: {
    ref: string;
    sha: string;
  };
  base: {
    ref: string;
  };
}

interface SandboxInfo {
  id: string;
  provider: string;
  status: string;
}

interface ExecutionResult {
  ok: boolean;
  step: string;
  output?: string;
  error?: string;
  tunnelUrl?: string;
}

class PRSandboxOrchestrator {
  private config: ReturnType<typeof getDefaultConfig>;
  private opts: PROptions;
  private sandboxId: string | null = null;
  private executionId: string;
  private results: ExecutionResult[] = [];

  constructor(opts: PROptions) {
    this.opts = opts;
    this.config = getDefaultConfig();
    this.executionId = `pr-sandbox-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  async execute(): Promise<void> {
    log.info('Starting PR sandbox orchestrator', {
      id: this.executionId,
      repo: this.opts.repo,
      pr: this.opts.pr,
      provider: this.opts.provider,
    });

    let sessionId: string | null = null;

    try {
      // Start session tracking
      const session = await prSandboxIntegration.startPRSandboxSession(
        this.opts.repo,
        this.opts.pr === 'all' ? [] : this.opts.pr.split(',').map(n => parseInt(n.trim()))
      );
      sessionId = session.sessionId;

      await prSandboxIntegration.logPRSandboxEvent(sessionId, 'execution_started', {
        executionId: this.executionId,
        options: this.opts
      });

      // Step 1: Validate environment
      await this.validateEnvironment();
      await prSandboxIntegration.logPRSandboxEvent(sessionId, 'environment_validated', {});

      // Step 2: Fetch PR information
      const prs = await this.fetchPRs();
      if (prs.length === 0) {
        throw new Error('No PRs found to merge');
      }
      await prSandboxIntegration.logPRSandboxEvent(sessionId, 'prs_fetched', {
        prCount: prs.length,
        prNumbers: prs.map(p => p.number)
      });

      // Step 3: Create sandbox
      await this.createSandbox();
      await prSandboxIntegration.logPRSandboxEvent(sessionId, 'sandbox_created', {
        sandboxId: this.sandboxId
      });

      // Step 4: Clone repo
      await this.cloneRepo();
      await prSandboxIntegration.logPRSandboxEvent(sessionId, 'repo_cloned', {});

      // Step 5: Merge PRs
      await this.mergePRs(prs);
      await prSandboxIntegration.logPRSandboxEvent(sessionId, 'prs_merged', {
        prCount: prs.length
      });

      // Step 6: Install dependencies
      await this.installDependencies();
      await prSandboxIntegration.logPRSandboxEvent(sessionId, 'dependencies_installed', {});

      // Step 7: Run tests (if not skipped)
      if (!this.opts.skipTests) {
        await this.runTests();
        await prSandboxIntegration.logPRSandboxEvent(sessionId, 'tests_completed', {});
      }

      // Step 8: Start application
      const appPort = await this.startApplication();
      await prSandboxIntegration.logPRSandboxEvent(sessionId, 'application_started', {
        port: appPort
      });

      // Step 9: Create Cloudflare tunnel (if not skipped)
      let tunnelUrl: string | undefined;
      if (!this.opts.skipTunnel && appPort) {
        tunnelUrl = await this.createTunnel(appPort);
        await prSandboxIntegration.logPRSandboxEvent(sessionId, 'tunnel_created', {
          tunnelUrl
        });
      }

      // Step 10: Report results
      await this.reportResults(tunnelUrl);

      // Complete session successfully
      await prSandboxIntegration.completePRSandboxSession(sessionId, {
        testsRun: !this.opts.skipTests,
        testsPassed: !this.opts.skipTests,
        testsFailed: 0,
        artifacts: [`${this.executionId}.json`],
        metadata: {
          executionId: this.executionId,
          repo: this.opts.repo,
          prCount: prs.length,
          provider: this.opts.provider,
          tunnelCreated: !!tunnelUrl
        }
      });

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error('PR sandbox execution failed', errorMessage);
      this.results.push({
        ok: false,
        step: 'orchestrator',
        error: errorMessage,
      });

      // Log failure to session tracker
      if (sessionId) {
        await prSandboxIntegration.failPRSandboxSession(sessionId, error instanceof Error ? error : new Error(errorMessage), {
          executionId: this.executionId,
          step: this.results[this.results.length - 1]?.step
        });
      }

      await this.reportResults();
      throw error;
    } finally {
      // Cleanup (unless keepSandbox is true)
      if (!this.opts.keepSandbox && this.sandboxId) {
        await this.destroySandbox();
        if (sessionId) {
          await prSandboxIntegration.logPRSandboxEvent(sessionId!, 'sandbox_destroyed', {
            sandboxId: this.sandboxId
          });
        }
      }
    }
  }

  private async validateEnvironment(): Promise<void> {
    this.results.push({ ok: true, step: 'validate-environment' });
    
    // Check required environment variables
    const requiredVars = ['DAYTONA_API_KEY', 'GIT_TOKEN'];
    if (!this.opts.skipTunnel) {
      requiredVars.push('CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID');
    }

    const missing = requiredVars.filter(v => !process.env[v]);
    if (missing.length > 0) {
      throw new Error(`Missing environment variables: ${missing.join(', ')}`);
    }

    if (!this.opts.repo) {
      throw new Error('Repository URL required (--repo)');
    }
  }

  private async fetchPRs(): Promise<GitHubPR[]> {
    const result: ExecutionResult = { ok: true, step: 'fetch-prs' };
    
    try {
      if (this.opts.pr === 'all') {
        if (this.opts.dryRun) {
          // Simulate PR fetching in dry-run mode
          const mockPRs: GitHubPR[] = [
            {
              number: 123,
              title: "Test PR 1",
              state: "open",
              head: { ref: "pr-123", sha: "abc123" },
              base: { ref: this.opts.branch }
            },
            {
              number: 456,
              title: "Test PR 2", 
              state: "open",
              head: { ref: "pr-456", sha: "def456" },
              base: { ref: this.opts.branch }
            }
          ];
          result.output = "dry-run: simulated PR fetching - found 2 open PRs";
          this.results.push(result);
          return mockPRs;
        }

        // Fetch all open PRs from GitHub API
        const repoUrl = new URL(this.opts.repo);
        const [, owner, repo] = repoUrl.pathname.split('/');
        
        if (!owner || !repo) {
          throw new Error(`Invalid repository URL: ${this.opts.repo}`);
        }

        if (!this.opts.githubToken) {
          throw new Error('GitHub token required for fetching PRs. Set GITHUB_TOKEN, GH_TOKEN, or GIT_TOKEN environment variable.');
        }

        const response = await fetch(
          `https://api.github.com/repos/${owner}/${repo}/pulls?state=open`,
          {
            headers: {
              'Authorization': `Bearer ${this.opts.githubToken}`,
              'Accept': 'application/vnd.github.v3+json',
            },
          }
        );

        if (!response.ok) {
          if (response.status === 401) {
            throw new Error(`GitHub API authentication failed. Token may be invalid or expired. Status: ${response.status}`);
          } else if (response.status === 404) {
            throw new Error(`Repository not found: ${owner}/${repo}. Status: ${response.status}`);
          } else {
            throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
          }
        }

        const prs: GitHubPR[] = await response.json();
        result.output = `Found ${prs.length} open PRs`;
        this.results.push(result);
        return prs;
      } else {
        // Parse specific PR numbers
        const prNumbers = this.opts.pr.split(',').map(num => parseInt(num.trim())).filter(num => !isNaN(num));
        
        if (prNumbers.length === 0) {
          throw new Error('No valid PR numbers specified. Use --pr all or --pr 123,456');
        }
        
        const prs: GitHubPR[] = prNumbers.map(number => ({
          number,
          title: `PR #${number}`,
          state: 'open',
          head: { ref: `pr-${number}`, sha: '' },
          base: { ref: this.opts.branch },
        }));
        
        result.output = `Using specified PRs: ${prNumbers.join(', ')}`;
        this.results.push(result);
        return prs;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Provide helpful error message for GitHub API failures
      if (errorMessage.includes('GitHub API') && this.opts.pr === 'all') {
        result.error = `${errorMessage}. Use --pr <numbers> to specify PRs directly instead of fetching from GitHub.`;
      } else {
        result.error = errorMessage;
      }
      
      result.ok = false;
      this.results.push(result);
      throw error;
    }
  }

  private async createSandbox(): Promise<void> {
    const result: ExecutionResult = { ok: true, step: 'create-sandbox' };
    
    try {
      if (this.opts.dryRun) {
        result.output = 'dry-run: simulated sandbox creation';
        this.sandboxId = 'dry-run-sandbox';
        this.results.push(result);
        return;
      }

      const providerScript = path.join(STACK_DIR, 'scripts', 'sandbox', 'provider.sh');
      if (!fs.existsSync(providerScript)) {
        throw new Error(`Provider script not found: ${providerScript}`);
      }

      const env = { ...process.env, SANDBOX_PROVIDER: this.opts.provider };
      const output = execSync(`${providerScript} create`, {
        env,
        encoding: 'utf-8',
        cwd: STACK_DIR,
        timeout: this.opts.timeout * 1000,
      });

      // Parse sandbox ID from output
      try {
        const jsonOutput = JSON.parse(output.trim());
        this.sandboxId = jsonOutput.sandbox_id || jsonOutput.id;
      } catch {
        // Try to extract from state file
        const stateFile = process.env.SANDBOX_STATE_FILE || '/tmp/gpu-orchestrator-sandbox.json';
        if (fs.existsSync(stateFile)) {
          const state = JSON.parse(fs.readFileSync(stateFile, 'utf-8'));
          this.sandboxId = state.sandbox_id;
        }
      }

      if (!this.sandboxId) {
        throw new Error('Failed to extract sandbox ID from creation output');
      }

      result.output = `Sandbox created: ${this.sandboxId}`;
      this.results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.ok = false;
      result.error = errorMessage;
      this.results.push(result);
      throw error;
    }
  }

  private async runSandboxCommand(command: string, timeoutMs = 300000): Promise<{ok: boolean; output: string}> {
    if (this.opts.dryRun) {
      return { ok: true, output: `dry-run: ${command}` };
    }

    if (!this.sandboxId) {
      throw new Error('No sandbox available');
    }

    const pythonScript = path.join(STACK_DIR, 'scripts', 'sandbox_daytona.py');
    if (!fs.existsSync(pythonScript)) {
      throw new Error(`Sandbox script not found: ${pythonScript}`);
    }

    try {
      const output = execSync(`python3 ${pythonScript} shell --command "${command.replace(/"/g, '\\"')}"`, {
        env: { ...process.env, SANDBOX_PROVIDER: this.opts.provider },
        encoding: 'utf-8',
        cwd: STACK_DIR,
        timeout: timeoutMs,
      });

      // Parse JSON output
      try {
        const lines = output.trim().split('\n');
        const jsonLine = lines.find(line => line.startsWith('{'));
        if (jsonLine) {
          const result = JSON.parse(jsonLine);
          return { ok: result.ok === true || result.exit_code === 0, output: result.output || output };
        }
      } catch {
        // Fallback to raw output
      }

      return { ok: true, output };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return { ok: false, output: errorMessage };
    }
  }

  private async cloneRepo(): Promise<void> {
    const result: ExecutionResult = { ok: true, step: 'clone-repo' };
    
    try {
      const cloneCmd = `
        rm -rf /tmp/repo &&
        git clone ${this.opts.repo} /tmp/repo &&
        cd /tmp/repo &&
        git config user.name "sandbox-agent" &&
        git config user.email "sandbox-agent@users.noreply.github.com"
      `;

      const { ok, output } = await this.runSandboxCommand(cloneCmd);
      if (!ok) {
        throw new Error(`Clone failed: ${output}`);
      }

      result.output = 'Repository cloned successfully';
      this.results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.ok = false;
      result.error = errorMessage;
      this.results.push(result);
      throw error;
    }
  }

  private async mergePRs(prs: GitHubPR[]): Promise<void> {
    const result: ExecutionResult = { ok: true, step: 'merge-prs' };
    
    try {
      let mergeCommands = 'cd /tmp/repo && ';
      
      for (const pr of prs) {
        mergeCommands += `
          git fetch origin pull/${pr.number}/head:pr-${pr.number} &&
          git checkout ${this.opts.branch} &&
          git merge --no-ff pr-${pr.number} -m "Merge PR #${pr.number}: ${pr.title}" &&
        `;
      }

      mergeCommands += 'echo "PRs merged successfully"';

      const { ok, output } = await this.runSandboxCommand(mergeCommands);
      if (!ok) {
        throw new Error(`PR merge failed: ${output}`);
      }

      result.output = `Merged ${prs.length} PRs: ${prs.map(p => `#${p.number}`).join(', ')}`;
      this.results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.ok = false;
      result.error = errorMessage;
      this.results.push(result);
      throw error;
    }
  }

  private async installDependencies(): Promise<void> {
    const result: ExecutionResult = { ok: true, step: 'install-dependencies' };
    
    try {
      // Try npm install, pnpm install, yarn install
      const installCmd = 'cd /tmp/repo && (npm install || pnpm install || yarn install)';
      
      const { ok, output } = await this.runSandboxCommand(installCmd);
      if (!ok) {
        throw new Error(`Dependency installation failed: ${output}`);
      }

      result.output = 'Dependencies installed successfully';
      this.results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.ok = false;
      result.error = errorMessage;
      this.results.push(result);
      throw error;
    }
  }

  private async runTests(): Promise<void> {
    const result: ExecutionResult = { ok: true, step: 'run-tests' };
    
    try {
      // Read package.json to detect test scripts
      const readPkgCmd = 'cd /tmp/repo && cat package.json';
      const { ok: readOk, output: pkgJson } = await this.runSandboxCommand(readPkgCmd);
      
      if (!readOk) {
        throw new Error('Failed to read package.json');
      }

      let testCommands = 'cd /tmp/repo && ';
      
      try {
        const pkg = JSON.parse(pkgJson);
        const scripts = pkg.scripts || {};
        
        // Run test scripts in order
        if (scripts.test) {
          testCommands += `npm run test && `;
        }
        if (scripts['test:unit']) {
          testCommands += `npm run test:unit && `;
        }
        if (scripts['test:integration']) {
          testCommands += `npm run test:integration && `;
        }
        if (scripts['test:e2e']) {
          testCommands += `npm run test:e2e && `;
        }
        
        // Check for Playwright
        if (fs.existsSync(path.join(STACK_DIR, 'node_modules', '.bin', 'playwright'))) {
          testCommands += `npx playwright test && `;
        }
      } catch {
        // Fallback to basic npm test
        testCommands += 'npm test && ';
      }

      testCommands += 'echo "All tests completed successfully"';

      const { ok, output } = await this.runSandboxCommand(testCommands);
      if (!ok) {
        throw new Error(`Tests failed: ${output}`);
      }

      result.output = 'All tests passed successfully';
      this.results.push(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.ok = false;
      result.error = errorMessage;
      this.results.push(result);
      throw error;
    }
  }

  private async startApplication(): Promise<number | undefined> {
    const result: ExecutionResult = { ok: true, step: 'start-application' };
    
    try {
      // Read package.json to detect start script
      const readPkgCmd = 'cd /tmp/repo && cat package.json';
      const { ok: readOk, output: pkgJson } = await this.runSandboxCommand(readPkgCmd);
      
      if (!readOk) {
        throw new Error('Failed to read package.json');
      }

      let startCommand = '';
      let detectedPort = 3000; // Default port
      
      try {
        const pkg = JSON.parse(pkgJson);
        const scripts = pkg.scripts || {};
        
        if (scripts.start) {
          startCommand = `npm start`;
        } else if (scripts.dev) {
          startCommand = `npm run dev`;
        } else if (scripts.serve) {
          startCommand = `npm run serve`;
        } else {
          throw new Error('No start script found');
        }

        // Try to detect port from package.json or common patterns
        if (pkg.port) {
          detectedPort = parseInt(pkg.port);
        }
      } catch {
        startCommand = 'npm start';
      }

      // Start app in background
      const startCmd = `cd /tmp/repo && nohup ${startCommand} > /tmp/app.log 2>&1 & sleep 5`;
      
      const { ok, output } = await this.runSandboxCommand(startCmd);
      if (!ok) {
        throw new Error(`Application start failed: ${output}`);
      }

      // Verify app is running
      const verifyCmd = `curl -sf http://localhost:${detectedPort}/health || curl -sf http://localhost:${detectedPort} || echo "App verification failed"`;
      const { ok: verifyOk } = await this.runSandboxCommand(verifyCmd);
      
      if (!verifyOk) {
        throw new Error('Application failed to start or health check failed');
      }

      result.output = `Application started on port ${detectedPort}`;
      this.results.push(result);
      return detectedPort;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.ok = false;
      result.error = errorMessage;
      this.results.push(result);
      throw error;
    }
  }

  private async createTunnel(port: number): Promise<string> {
    const result: ExecutionResult = { ok: true, step: 'create-tunnel' };
    
    try {
      // Install cloudflared if not present
      const installCmd = 'which cloudflared || (curl -L https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o /usr/local/bin/cloudflared && chmod +x /usr/local/bin/cloudflared)';
      await this.runSandboxCommand(installCmd);

      // Start cloudflared tunnel in background
      const tunnelCmd = `nohup cloudflared tunnel --url http://localhost:${port} > /tmp/cloudflared.log 2>&1 & sleep 10`;
      const { ok } = await this.runSandboxCommand(tunnelCmd);
      
      if (!ok) {
        throw new Error('Failed to start Cloudflare tunnel');
      }

      // Extract tunnel URL from logs
      const extractUrlCmd = 'grep -o "https://[^ ]*\\.trycloudflare\\.com" /tmp/cloudflared.log | tail -1';
      const { ok: extractOk, output: tunnelUrl } = await this.runSandboxCommand(extractUrlCmd);
      
      if (!extractOk || !tunnelUrl.trim()) {
        throw new Error('Failed to extract tunnel URL from logs');
      }

      result.tunnelUrl = tunnelUrl.trim();
      result.output = `Cloudflare tunnel created: ${tunnelUrl.trim()}`;
      this.results.push(result);
      return tunnelUrl.trim();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.ok = false;
      result.error = errorMessage;
      this.results.push(result);
      throw error;
    }
  }

  private async destroySandbox(): Promise<void> {
    const result: ExecutionResult = { ok: true, step: 'destroy-sandbox' };
    
    try {
      if (this.opts.dryRun || !this.sandboxId) {
        result.output = 'dry-run: simulated sandbox destruction';
        this.results.push(result);
        return;
      }

      const providerScript = path.join(STACK_DIR, 'scripts', 'sandbox', 'provider.sh');
      const env = { ...process.env, SANDBOX_PROVIDER: this.opts.provider };
      
      execSync(`${providerScript} destroy`, {
        env,
        encoding: 'utf-8',
        cwd: STACK_DIR,
        timeout: 30000,
      });

      result.output = `Sandbox destroyed: ${this.sandboxId}`;
      this.results.push(result);
      this.sandboxId = null;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      result.ok = false;
      result.error = errorMessage;
      this.results.push(result);
      // Don't throw error during cleanup
    }
  }

  private async reportResults(tunnelUrl?: string): Promise<void> {
    const resultsDir = path.join(ROOT_DIR, 'tmp', 'results');
    fs.mkdirSync(resultsDir, { recursive: true });
    
    const resultFile = path.join(resultsDir, `${this.executionId}.json`);
    
    const finalResult = {
      id: this.executionId,
      ok: this.results.every(r => r.ok),
      repo: this.opts.repo,
      pr: this.opts.pr,
      provider: this.opts.provider,
      sandboxId: this.sandboxId,
      tunnelUrl,
      steps: this.results,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(resultFile, JSON.stringify(finalResult, null, 2));
    
    console.log(JSON.stringify(finalResult, null, 2));
    
    if (tunnelUrl) {
      console.log(`\n🌐 Cloudflare Tunnel URL: ${tunnelUrl}`);
      console.log('Use this URL for external access and Playwright testing');
    }

    log.info('PR sandbox execution completed', {
      id: this.executionId,
      ok: finalResult.ok,
      tunnelUrl: tunnelUrl ? 'yes' : 'no',
    });
  }
}

async function main(): Promise<void> {
  loadEnv(ROOT_DIR);
  loadEnv(STACK_DIR);
  
  const opts = parsePROptions(process.argv.slice(2));
  
  if (opts.verbose) {
    process.env.VERBOSE = '1';
  }

  const orchestrator = new PRSandboxOrchestrator(opts);
  await orchestrator.execute();
}

// Only run main if this is the entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    log.error('Fatal error', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}

export default PRSandboxOrchestrator;