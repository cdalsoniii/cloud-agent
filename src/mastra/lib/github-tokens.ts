/**
 * Dual-account GitHub token resolution (SDK/API — no shell).
 * Mirrors pybatch/src/sdlc_batch/tokens.py
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import yaml from 'yaml';

const BRIGHTFOREST_OWNERS = new Set(['brightforestx', 'brightforest']);
const PERSONAL_OWNERS = new Set(['cdalsoniii']);

const BRIGHTFOREST_ENV_KEYS = [
  'GITHUB_TOKEN_BRIGHTFOREST_ORG_PX_CLOUD_AGENT',
  'GITHUB_TOKEN_BRIGHTFOREST',
  'GH_TOKEN_BRIGHTFOREST',
];

const PERSONAL_ENV_KEYS = [
  'GITHUB_TOKEN_PERSONAL',
  'GIT_TOKEN_PERSONAL',
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GIT_TOKEN',
];

export interface ResolvedToken {
  token: string;
  source: string;
  owner: string;
}

export function parseOwnerRepo(repoUrl: string): { owner: string; repo: string } {
  const cleaned = repoUrl.replace(/\.git$/, '').replace(/\/$/, '');
  const parts = cleaned.split('/');
  if (parts.length < 2) {
    throw new Error(`Invalid GitHub repo URL: ${repoUrl}`);
  }
  return { owner: parts[parts.length - 2], repo: parts[parts.length - 1] };
}

export function readGhOauthToken(preferredUser?: string): string {
  const hostsPath = path.join(os.homedir(), '.config', 'gh', 'hosts.yml');
  if (!fs.existsSync(hostsPath)) return '';
  try {
    const data = yaml.parse(fs.readFileSync(hostsPath, 'utf-8')) || {};
    const githubHost = data['github.com'] || {};
    const users = githubHost.users || {};
    const active = preferredUser || githubHost.user || '';
    if (active && users[active]?.oauth_token) {
      return String(users[active].oauth_token);
    }
    for (const udata of Object.values(users) as Array<{ oauth_token?: string }>) {
      if (udata?.oauth_token) return String(udata.oauth_token);
    }
    return githubHost.oauth_token ? String(githubHost.oauth_token) : '';
  } catch {
    return '';
  }
}

function firstEnv(...keys: string[]): { token: string; key: string } {
  for (const key of keys) {
    const val = (process.env[key] || '').trim();
    if (val) return { token: val, key };
  }
  return { token: '', key: '' };
}

export function resolveGithubToken(owner: string): ResolvedToken {
  const ownerNorm = (owner || '').trim();
  if (!ownerNorm) throw new Error('owner is required');
  const ownerL = ownerNorm.toLowerCase();

  if (BRIGHTFOREST_OWNERS.has(ownerL)) {
    const oauth = readGhOauthToken('cdalsoniii');
    if (oauth) {
      return { token: oauth, source: 'gh-oauth-hosts.yml', owner: ownerNorm };
    }
    const env = firstEnv(...BRIGHTFOREST_ENV_KEYS);
    if (env.token) return { token: env.token, source: env.key, owner: ownerNorm };
    const fallback = firstEnv(...PERSONAL_ENV_KEYS);
    if (fallback.token) {
      return { token: fallback.token, source: `${fallback.key}(fallback)`, owner: ownerNorm };
    }
    throw new Error(
      `No GitHub token for ${ownerNorm}. Set gh auth or GITHUB_TOKEN_BRIGHTFOREST_ORG_PX_CLOUD_AGENT.`,
    );
  }

  if (PERSONAL_OWNERS.has(ownerL)) {
    const personal = firstEnv('GITHUB_TOKEN_PERSONAL', 'GIT_TOKEN_PERSONAL');
    if (personal.token) {
      return { token: personal.token, source: personal.key, owner: ownerNorm };
    }
    const oauth = readGhOauthToken('cdalsoniii');
    if (oauth) {
      return { token: oauth, source: 'gh-oauth-hosts.yml', owner: ownerNorm };
    }
    const env = firstEnv('GITHUB_TOKEN', 'GH_TOKEN', 'GIT_TOKEN');
    if (env.token) return { token: env.token, source: env.key, owner: ownerNorm };
    throw new Error(`No GitHub token for ${ownerNorm}. Set GITHUB_TOKEN_PERSONAL or gh auth.`);
  }

  const oauth = readGhOauthToken();
  if (oauth) return { token: oauth, source: 'gh-oauth-hosts.yml', owner: ownerNorm };
  const env = firstEnv(...PERSONAL_ENV_KEYS, ...BRIGHTFOREST_ENV_KEYS);
  if (env.token) return { token: env.token, source: env.key, owner: ownerNorm };
  throw new Error(`No GitHub token available for owner ${ownerNorm}`);
}

export async function preflightRepoAccess(
  repoUrl: string,
  token?: string,
): Promise<{
  ok: true;
  owner: string;
  repo: string;
  full_name?: string;
  token_source: string;
}> {
  const { owner, repo } = parseOwnerRepo(repoUrl);
  const resolved = token
    ? { token, source: 'explicit', owner }
    : resolveGithubToken(owner);
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, {
    headers: {
      Authorization: `Bearer ${resolved.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `GitHub preflight failed for ${owner}/${repo}: HTTP ${res.status} (source=${resolved.source})`,
    );
  }
  if (res.status === 404) {
    throw new Error(
      `GitHub preflight failed for ${owner}/${repo}: HTTP 404 (source=${resolved.source})`,
    );
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub preflight failed for ${owner}/${repo}: HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { full_name?: string };
  return {
    ok: true,
    owner,
    repo,
    full_name: data.full_name,
    token_source: resolved.source,
  };
}
