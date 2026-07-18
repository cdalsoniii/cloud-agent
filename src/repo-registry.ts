/**
 * Repo Registry Resolver
 * Loads repos.yaml and resolves --target / --repo flags to RepoContext
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { RepoRegistry, RepoEntry, RepoContext, ChainConfig } from './sdlc-types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let _registry: RepoRegistry | null = null;

function parseYamlInline(content: string): RepoRegistry {
  const result: RepoRegistry = { repos: {}, global_rules: [], chains: {} };
  let section: 'repos' | 'global_rules' | 'chains' | null = null;
  let sectionIndent = 0;
  let currentRepo: string | null = null;

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Section headers (0 indent)
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      if (trimmed === 'repos:') { section = 'repos'; sectionIndent = 0; continue; }
      if (trimmed === 'global_rules:') { section = 'global_rules'; sectionIndent = 0; continue; }
      if (trimmed === 'chains:') { section = 'chains'; sectionIndent = 0; continue; }
    }

    if (section === 'repos') {
      // First entry under repos: sets the base indent for repo names
      if (sectionIndent === 0 && indent > 0 && trimmed.endsWith(':')) {
        sectionIndent = indent;
      }
      if (trimmed.endsWith(':') && indent === sectionIndent && sectionIndent > 0) {
        currentRepo = trimmed.slice(0, -1);
        result.repos[currentRepo] = {
          url: '', provider: 'github', token_env: 'GIT_TOKEN', default_branch: 'main',
          verify_rules: [], sandbox: { provider: 'northflank' }
        };
        continue;
      }
      if (currentRepo && trimmed.startsWith('url:')) {
        result.repos[currentRepo].url = trimmed.split('url:')[1].trim();
      }
      if (currentRepo && trimmed.startsWith('provider:')) {
        const p = trimmed.split('provider:')[1].trim() as RepoEntry['provider'];
        result.repos[currentRepo].provider = p;
      }
      if (currentRepo && trimmed.startsWith('token_env:')) {
        result.repos[currentRepo].token_env = trimmed.split('token_env:')[1].trim();
      }
      if (currentRepo && trimmed.startsWith('default_branch:')) {
        result.repos[currentRepo].default_branch = trimmed.split('default_branch:')[1].trim();
      }
      if (currentRepo && trimmed.startsWith('- rule:')) {
        result.repos[currentRepo].verify_rules.push({ rule: trimmed.split('rule:')[1].trim() });
      }
    }

    if (section === 'global_rules' && trimmed.startsWith('- rule:')) {
      result.global_rules.push({ rule: trimmed.split('rule:')[1].trim() });
    }

    if (section === 'chains') {
      const chainIndent = indent > 0 ? indent : 2; // default to 2 for chains entries
      if (trimmed.endsWith(':') && indent === chainIndent) {
        const name = trimmed.slice(0, -1);
        result.chains[name] = { id: '', description: '' };
      }
      if (trimmed.startsWith('id:')) {
        const chainName = Object.keys(result.chains).pop();
        if (chainName) result.chains[chainName].id = trimmed.split('id:')[1].trim();
      }
    }
  }

  return result;
}

function loadRegistry(): RepoRegistry {
  if (_registry) return _registry;
  const yamlPath = path.resolve(__dirname, '..', 'repos.yaml');
  const content = fs.readFileSync(yamlPath, 'utf-8');
  _registry = parseYamlInline(content);
  return _registry;
}

export async function resolveRepo(
  target: string,
  opts?: { repoUrl?: string; tokenEnv?: string }
): Promise<RepoContext> {
  const reg = loadRegistry();

  // Ad-hoc mode: direct repo URL
  if (opts?.repoUrl) {
    const token = opts.tokenEnv ? (process.env[opts.tokenEnv] || '') : '';
    return {
      target: target || 'ad-hoc',
      repoUrl: opts.repoUrl,
      provider: 'github',
      token,
      branch: 'main',
      verifyRules: reg.global_rules.map(r => r.rule),
      sandboxProvider: 'northflank',
    };
  }

  // Registry lookup
  const entry = reg.repos[target];
  if (!entry) throw new Error(`Unknown target "${target}". Available: ${Object.keys(reg.repos).join(', ')}`);

  const token = entry.token_env ? (process.env[entry.token_env] || '') : '';
  const verifyRules = [
    ...reg.global_rules.map(r => r.rule),
    ...entry.verify_rules.map(r => r.rule),
  ];

  return {
    target,
    repoUrl: entry.url,
    provider: entry.provider,
    token,
    branch: entry.default_branch,
    verifyRules,
    sandboxProvider: entry.sandbox.provider,
    sandboxPlan: entry.sandbox.plan,
  };
}

export function listTargets(): string[] {
  return Object.keys(loadRegistry().repos);
}

export function getChainConfig(specialty: string): ChainConfig | undefined {
  return loadRegistry().chains[specialty];
}
