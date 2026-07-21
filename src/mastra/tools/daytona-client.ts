/**
 * Shared Daytona Node SDK client + sandbox state for Mastra tools.
 * No shell wrappers — uses @daytona/sdk directly.
 */

import fs from 'fs';
import path from 'path';
import { Daytona, type Sandbox } from '@daytona/sdk';
import { resolveGithubToken, parseOwnerRepo } from '../lib/github-tokens.js';

const STATE_FILE =
  process.env.CLOUD_AGENT_DAYTONA_STATE_FILE ||
  '/tmp/cloud-agent-daytona-sandbox.json';

export interface SandboxState {
  sandboxId: string;
  createdAt: string;
  repoPath?: string;
  previewUrl?: string;
}

let cachedClient: Daytona | null = null;

export function getDaytonaClient(): Daytona {
  if (cachedClient) return cachedClient;
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is required');
  }
  cachedClient = new Daytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL || 'https://app.daytona.io/api',
    target: process.env.DAYTONA_TARGET,
  });
  return cachedClient;
}

/**
 * Drop the cached SDK client after sandbox destroy so Node does not retain
 * stale HTTP/agent state across batch runs. Sync SDK has no async close().
 */
export function releaseDaytonaClient(): void {
  cachedClient = null;
}

export function readSandboxState(): SandboxState | null {
  try {
    if (!fs.existsSync(STATE_FILE)) return null;
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8')) as SandboxState;
  } catch {
    return null;
  }
}

export function writeSandboxState(state: SandboxState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

export function clearSandboxState(): void {
  try {
    if (fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
  } catch {
    /* ignore */
  }
}

export async function getActiveSandbox(): Promise<{ sandbox: Sandbox; state: SandboxState }> {
  const state = readSandboxState();
  if (!state?.sandboxId) {
    throw new Error('No active Daytona sandbox. Call daytona-create first.');
  }
  const daytona = getDaytonaClient();
  const sandbox = await daytona.get(state.sandboxId);
  return { sandbox, state };
}

export function defaultSandboxEnvs(): Record<string, string> {
  const baseUrl =
    process.env.BASETEN_PROXY_BASE_URL ||
    process.env.OPENAI_BASE_URL ||
    'https://inference.baseten.co/v1';
  const envs: Record<string, string> = {
    OPENAI_BASE_URL: baseUrl,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY || process.env.PROXY_API_KEY || 'sk-proxy',
    HARNESS_SANDBOX: '1',
    DAYTONA_SDK_READY: '1',
  };
  const repoUrl = process.env.GIT_REPO_URL || '';
  if (repoUrl) {
    envs.GIT_REPO_URL = repoUrl;
    try {
      const { owner } = parseOwnerRepo(repoUrl);
      const resolved = resolveGithubToken(owner);
      envs.GIT_TOKEN = resolved.token;
      envs.GITHUB_TOKEN = resolved.token;
    } catch {
      const tok =
        process.env.GIT_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
      if (tok) {
        envs.GIT_TOKEN = tok;
        envs.GITHUB_TOKEN = tok;
      }
    }
  } else {
    const tok =
      process.env.GIT_TOKEN || process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '';
    if (tok) {
      envs.GIT_TOKEN = tok;
      envs.GITHUB_TOKEN = tok;
    }
  }
  return envs;
}

export async function execInSandbox(
  sandbox: Sandbox,
  command: string,
  opts?: { cwd?: string; env?: Record<string, string>; timeoutSeconds?: number },
): Promise<{ ok: boolean; exitCode: number; stdout: string; stderr: string }> {
  const result = await sandbox.process.executeCommand(
    command,
    opts?.cwd,
    opts?.env,
    opts?.timeoutSeconds ?? 120,
  );
  const exitCode = result.exitCode ?? 1;
  const stdout = result.result || result.artifacts?.stdout || '';
  return {
    ok: exitCode === 0,
    exitCode,
    stdout: String(stdout),
    stderr: '',
  };
}

export { STATE_FILE };
