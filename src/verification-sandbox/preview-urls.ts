/**
 * Friendly domain minting for sandbox-served apps (7004 validate, 7005 ontology UI).
 */
import type { SandboxRole } from './types-registry.js';
import {
  mintPreviewUrl,
  type MintedPreviewUrl,
  domainTemplateFor,
  getSandboxType,
} from './types-registry.js';
import type { ShaclPreviewUrl } from './types.js';

export type PreviewApp = 'ontology' | 'validate' | 'fleet' | 'agent' | 'edit';

/**
 * Mint a user-facing preview URL for a sandbox app.
 * - editor + public mint → throws
 * - formal ontology → friendly host or localhost
 * - raw Daytona URL optional passthrough when PREVIEW_MODE=raw
 */
export function mintSandboxAppUrl(opts: {
  role: SandboxRole;
  app: PreviewApp;
  raw?: ShaclPreviewUrl | null;
  sessionId?: string;
  expiresInSeconds?: number;
}): MintedPreviewUrl {
  const spec = getSandboxType(opts.role);
  const tpl = domainTemplateFor(opts.role, opts.app);

  if (!tpl) {
    throw new Error(`No domain template: role=${opts.role} app=${opts.app}`);
  }

  // Hard rule: never public-mint editor surfaces
  if (opts.role === 'editor') {
    throw new Error(
      'IP policy: refusing public domain mint for editor sandbox (S1). Use host-mediated access only.',
    );
  }

  if (!tpl.public && opts.app === 'ontology') {
    // ontology UI is public on formal — if misconfigured, fail closed for non-public ontology on wrong role
  }

  const rawUrl = opts.raw?.url || null;
  return mintPreviewUrl({
    role: opts.role,
    app: opts.app,
    rawSignedUrl: rawUrl,
    localhostFallback: !rawUrl,
    expiresInSeconds: opts.expiresInSeconds ?? opts.raw?.expiresInSeconds,
    sessionId: opts.sessionId,
  });
}

export function describeDomainMatrix(): string {
  const lines = [
    '# Sandbox domain matrix',
    '',
    '| Role | App | Public | Host template | Port |',
    '|------|-----|--------|---------------|------|',
  ];
  for (const role of ['editor', 'formal', 'agent', 'legacy-packed'] as SandboxRole[]) {
    const s = getSandboxType(role);
    if (s.domains.length === 0) {
      lines.push(`| ${role} | — | no | (none) | — |`);
      continue;
    }
    for (const d of s.domains) {
      lines.push(
        `| ${role} | ${d.app} | ${d.public ? 'yes' : 'no'} | ${d.hostTemplate} | ${d.port} |`,
      );
    }
  }
  return lines.join('\n');
}
