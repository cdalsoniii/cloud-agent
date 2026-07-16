/**
 * Shared types and utilities for cloud agent handoff and chain-sandbox communication
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface AgentHandoffRequest {
  /** Unique task identifier */
  id: string;
  /** Task description */
  task: string;
  /** Target repository or project */
  target: string;
  /** Handoff priority */
  priority: 'low' | 'normal' | 'high' | 'critical';
  /** Execution context (repo state, files, etc.) */
  context?: Record<string, unknown>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Preferred sandbox provider */
  sandboxProvider?: 'daytona' | 'northflank';
  /** Whether to use Baseten chain for planning */
  useChain?: boolean;
  /** Chain specialty to use */
  chainSpecialty?: string;
  /** Git branch prefix for PRs */
  branchPrefix?: string;
  /** Tags for categorization */
  tags?: string[];
}

export interface AgentHandoffResult {
  /** Whether the handoff succeeded */
  ok: boolean;
  /** Handoff ID */
  id: string;
  /** Sandbox provider used */
  sandboxProvider: string;
  /** Sandbox ID if created/used */
  sandboxId?: string;
  /** Chain execution ID if used */
  chainExecutionId?: string;
  /** Plan files generated */
  planFiles?: string[];
  /** Execution results */
  executeResults?: Array<{
    segment: string;
    status: 'ok' | 'error' | 'pending';
    branch?: string;
    details?: string;
  }>;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  timestamp: string;
}

export interface SandboxChainRequest {
  /** Chain specialty to use */
  specialty: string;
  /** Target sandbox ID */
  sandboxId: string;
  /** Operation type */
  operation: 'query' | 'execute' | 'monitor' | 'health' | 'logs' | 'pause' | 'resume';
  /** Request payload */
  payload: Record<string, unknown>;
  /** Request timeout in milliseconds */
  timeout?: number;
  /** Chain portfolio ID */
  portfolioId?: string;
}

export interface SandboxChainResponse {
  /** Whether the operation succeeded */
  ok: boolean;
  /** Chain execution ID */
  executionId?: string;
  /** Sandbox state */
  sandboxState?: {
    id: string;
    status: 'running' | 'paused' | 'stopped' | 'error';
    url?: string;
    lastActivity?: string;
  };
  /** Response data */
  data?: Record<string, unknown>;
  /** Error message if failed */
  error?: string;
  /** Timestamp */
  timestamp: string;
}

export interface OrchestratorConfig {
  /** Router mode */
  mode: 'handoff' | 'chain-sandbox' | 'full' | 'waterfall';
  /** Default sandbox provider */
  defaultSandboxProvider: 'daytona' | 'northflank';
  /** Default chain specialty */
  defaultChainSpecialty: string;
  /** Chain portfolio ID */
  chainPortfolioId: string;
  /** Baseten API key */
  basetenApiKey: string;
  /** Daytona API key */
  daytonaApiKey?: string;
  /** Northflank API token */
  northflankApiToken?: string;
  /** Chain timeout in milliseconds */
  chainTimeoutMs: number;
  /** Sync timeout in milliseconds */
  syncTimeoutMs: number;
  /** Whether to enable dry run mode */
  dryRun: boolean;
  /** Verbose logging */
  verbose: boolean;
}

export interface SandboxProvider {
  /** Provider name */
  name: 'daytona' | 'northflank';
  /** Create a new sandbox */
  create(options: SandboxCreateOptions): Promise<SandboxInfo>;
  /** Get sandbox by ID */
  get(id: string): Promise<SandboxInfo>;
  /** Execute command in sandbox */
  execute(id: string, command: string, env?: Record<string, string>): Promise<SandboxExecuteResult>;
  /** Pause sandbox */
  pause(id: string): Promise<void>;
  /** Resume sandbox */
  resume(id: string): Promise<void>;
  /** Delete sandbox */
  delete(id: string): Promise<void>;
  /** List running sandboxes */
  list(): Promise<SandboxInfo[]>;
}

export interface SandboxCreateOptions {
  /** Sandbox name */
  name?: string;
  /** Target repository */
  repo?: string;
  /** Branch to checkout */
  branch?: string;
  /** Environment variables */
  env?: Record<string, string>;
  /** CPU cores */
  cpu?: number;
  /** Memory in MB */
  memory?: number;
  /** Disk size in GB */
  disk?: number;
  /** Timeout in seconds */
  timeout?: number;
}

export interface SandboxInfo {
  /** Sandbox ID */
  id: string;
  /** Sandbox name */
  name: string;
  /** Provider */
  provider: string;
  /** Status */
  status: 'creating' | 'running' | 'paused' | 'stopped' | 'error';
  /** URL if available */
  url?: string;
  /** Created timestamp */
  createdAt: string;
  /** Last activity */
  lastActivity?: string;
  /** Metadata */
  metadata?: Record<string, unknown>;
}

export interface SandboxExecuteResult {
  /** Exit code */
  exitCode: number;
  /** stdout */
  stdout: string;
  /** stderr */
  stderr: string;
  /** Duration in milliseconds */
  durationMs: number;
}

export interface ChainExecutionOptions {
  /** Chain specialty */
  specialty: string;
  /** Input data */
  input: Record<string, unknown>;
  /** Portfolio ID */
  portfolioId?: string;
  /** Timeout in milliseconds */
  timeout?: number;
  /** Dry run */
  dryRun?: boolean;
}

export interface ChainExecutionResult {
  /** Success flag */
  ok: boolean;
  /** Execution ID */
  executionId?: string;
  /** Response data */
  data?: Record<string, unknown>;
  /** Plan content if available */
  plan?: string;
  /** Error if failed */
  error?: string;
}

/** Logger utility */
export function createLogger(prefix: string, verbose = false) {
  return {
    log: (...args: unknown[]) => console.error(`[${prefix}]`, ...args),
    info: (...args: unknown[]) => console.log(`[${prefix}]`, ...args),
    verbose: (...args: unknown[]) => verbose && console.error(`[${prefix}|verbose]`, ...args),
    warn: (...args: unknown[]) => console.warn(`[${prefix}|warn]`, ...args),
    error: (...args: unknown[]) => console.error(`[${prefix}|error]`, ...args),
  };
}

/** Generate unique ID */
export function generateId(): string {
  return `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

/** Load environment variables from .env file */
export function loadEnv(dir: string): void {
  const files = ['.env', '.env.local', '.env-cloud-sandboxes'];
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (!fs.existsSync(filePath)) continue;
    
    const content = fs.readFileSync(filePath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq < 0) continue;
      
      const key = trimmed.slice(0, eq).trim();
      let val = trimmed.slice(eq + 1).trim();
      
      // Remove quotes
      if ((val.startsWith('"') && val.endsWith('"')) || 
          (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

/** Parse CLI arguments into structured options */
export function parseArgs<T extends Record<string, string | boolean | string[]>>(
  argv: string[],
  defaults: T
): T {
  const result = { ...defaults };
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      console.log('Usage: see SKILL.md for documentation');
      process.exit(0);
    }
    
    for (const key of Object.keys(defaults)) {
      const flag = `--${key.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
      if (arg === flag) {
        const value = argv[++i];
        if (value === undefined) continue;
        
        if (Array.isArray(defaults[key])) {
          (result[key] as string[]) = value.split(',').map(s => s.trim());
        } else if (typeof defaults[key] === 'boolean') {
          (result[key] as boolean) = value === 'true' || value === '1' || true;
        } else {
          (result[key] as string) = value;
        }
      }
    }
  }
  
  return result;
}

/** Sleep utility */
export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Retry utility */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; delay?: number; backoff?: number }
): Promise<T> {
  const { attempts = 3, delay = 1000, backoff = 2 } = options;
  let lastError: Error | undefined;
  
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (i < attempts - 1) {
        await sleep(delay * Math.pow(backoff, i));
      }
    }
  }
  
  throw lastError;
}

/** Default configuration from environment */
export function getDefaultConfig(): OrchestratorConfig {
  return {
    mode: (process.env.SMART_ROUTER_MODE as OrchestratorConfig['mode']) || 'waterfall',
    defaultSandboxProvider: (process.env.SANDBOX_PROVIDER as 'daytona' | 'northflank') || 'daytona',
    defaultChainSpecialty: process.env.SMART_ROUTER_CHAIN_SPECIALTY || 'opencode-agent-wiring',
    chainPortfolioId: process.env.BASETEN_CHAIN_PORTFOLIO_ID || 'nwxlx5wy',
    basetenApiKey: process.env.BASETEN_API_KEY || '',
    daytonaApiKey: process.env.DAYTONA_API_KEY,
    northflankApiToken: process.env.NORTHFLANK_API_TOKEN,
    chainTimeoutMs: parseInt(process.env.SMART_ROUTER_WATERFALL_CHAIN_TIMEOUT_MS || '60000', 10),
    syncTimeoutMs: parseInt(process.env.SMART_ROUTER_WATERFALL_SYNC_TIMEOUT_MS || '120000', 10),
    dryRun: process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true',
    verbose: process.env.VERBOSE === '1' || process.env.VERBOSE === 'true',
  };
}
