/**
 * Daytona signed preview token mint/refresh bookkeeping.
 * Pure helpers are unit-tested; live mint uses getSignedPreviewUrl on an active sandbox.
 */
import fs from 'fs';
import path from 'path';
import {
  ASSISTANT_UI_WEB_PORT,
  FLEET_UI_PORT,
  ONTOLOGY_UI_PORT,
  OPENCODE_SERVE_PORT,
  SHACL_PORT,
} from './types.js';

/** Default formal + product ports we keep tokens fresh for. */
export const PREVIEW_TOKEN_PORTS = [
  ASSISTANT_UI_WEB_PORT, // 3010
  ONTOLOGY_UI_PORT, // 7005
  FLEET_UI_PORT, // 7006
  SHACL_PORT, // 7004
  OPENCODE_SERVE_PORT, // 4096 opencode serve (local agent)
] as const;

export type PreviewPort = (typeof PREVIEW_TOKEN_PORTS)[number];

export interface PreviewPortMint {
  port: number;
  url: string;
  token: string | null;
  label: string;
  /** Primary path to fetch for health (/, /health) */
  primaryPath: string;
  /** Extra host paths that must also succeed (e.g. /verifier-fleet on 3010) */
  extraPaths: string[];
  skipped?: boolean;
  skipReason?: string;
}

export interface PreviewTokenSet {
  version: 1;
  sandboxId: string;
  mintedAt: string;
  generation: number;
  expiresInSeconds: number;
  note: string;
  ports: PreviewPortMint[];
}

export interface PreviewFetchResult {
  port: number;
  path: string;
  url: string;
  status: number;
  ok: boolean;
  sample?: string;
  error?: string;
}

export function labelForPort(port: number): string {
  switch (port) {
    case ASSISTANT_UI_WEB_PORT:
      return 'assistant-ui-web';
    case ONTOLOGY_UI_PORT:
      return 'formal-ontology';
    case FLEET_UI_PORT:
      return 'formal-fleet-lite';
    case SHACL_PORT:
      return 'shacl-validate';
    case OPENCODE_SERVE_PORT:
      return 'opencode-serve';
    default:
      return `port-${port}`;
  }
}

export function primaryPathForPort(port: number): string {
  if (port === ASSISTANT_UI_WEB_PORT) return '/';
  if (port === OPENCODE_SERVE_PORT) return '/global/health';
  return '/health';
}

export function extraPathsForPort(port: number): string[] {
  if (port === ASSISTANT_UI_WEB_PORT) return ['/verifier-fleet'];
  return [];
}

/**
 * Extract signed token from Daytona preview hostnames:
 *   https://3010-<token>.daytonaproxy01.net
 *   https://7005-<token>.proxy.daytona.work
 */
export function extractTokenFromPreviewUrl(url: string): string | null {
  try {
    const host = new URL(url).hostname;
    // port-token.domain
    const m = host.match(/^(\d+)-([a-z0-9_-]+)\./i);
    if (m) return m[2];
    return null;
  } catch {
    return null;
  }
}

export function buildPreviewPortMint(opts: {
  port: number;
  url: string;
  token?: string | null;
  skipped?: boolean;
  skipReason?: string;
}): PreviewPortMint {
  const token =
    opts.token !== undefined && opts.token !== null
      ? opts.token
      : extractTokenFromPreviewUrl(opts.url);
  return {
    port: opts.port,
    url: opts.url.replace(/\/$/, ''),
    token,
    label: labelForPort(opts.port),
    primaryPath: primaryPathForPort(opts.port),
    extraPaths: extraPathsForPort(opts.port),
    skipped: opts.skipped,
    skipReason: opts.skipReason,
  };
}

export function buildPreviewTokenSet(opts: {
  sandboxId: string;
  mints: Array<{
    port: number;
    url: string;
    token?: string | null;
    skipped?: boolean;
    skipReason?: string;
  }>;
  generation?: number;
  expiresInSeconds?: number;
  mintedAt?: string;
}): PreviewTokenSet {
  const generation = opts.generation ?? 1;
  const expiresInSeconds = opts.expiresInSeconds ?? 3600;
  return {
    version: 1,
    sandboxId: opts.sandboxId,
    mintedAt: opts.mintedAt || new Date().toISOString(),
    generation,
    expiresInSeconds,
    note:
      'Daytona signed preview tokens expire quickly. Always read the latest open-urls / JSON; 404 /callback usually means expired token, not a dead sandbox.',
    ports: opts.mints.map((m) => buildPreviewPortMint(m)),
  };
}

/** True if refresh produced a meaningfully new set (new generation and at least one token/url change). */
export function didTokensRotate(prev: PreviewTokenSet, next: PreviewTokenSet): boolean {
  if (prev.sandboxId !== next.sandboxId) return false;
  if (next.generation <= prev.generation) return false;
  const prevByPort = new Map(prev.ports.map((p) => [p.port, p]));
  for (const p of next.ports) {
    if (p.skipped) continue;
    const old = prevByPort.get(p.port);
    if (!old || old.skipped) continue;
    if (old.url !== p.url || old.token !== p.token) return true;
  }
  // generation advanced but URLs identical — still a refresh attempt; treat as rotated only if generation increased
  // Prefer requiring URL/token change for "rotation"
  return false;
}

export function nextGeneration(prev: PreviewTokenSet | null | undefined): number {
  return (prev?.generation ?? 0) + 1;
}

/** Human-readable open-urls body always overwritten on mint/refresh. */
export function formatOpenUrlsText(set: PreviewTokenSet): string {
  const lines = [
    `# Daytona signed previews (generation ${set.generation})`,
    `# sandbox: ${set.sandboxId}`,
    `# minted:  ${set.mintedAt}`,
    `# expiresInSeconds (requested): ${set.expiresInSeconds}`,
    `# ${set.note}`,
    '',
  ];
  for (const p of set.ports) {
    if (p.skipped) {
      lines.push(`${p.label} (${p.port}): SKIPPED — ${p.skipReason || 'down'}`);
      continue;
    }
    lines.push(`${p.label} (${p.port}): ${p.url}`);
    if (p.port === ASSISTANT_UI_WEB_PORT) {
      lines.push(`${p.label} /verifier-fleet: ${p.url}/verifier-fleet`);
    }
    if (p.port === OPENCODE_SERVE_PORT) {
      lines.push(`OPENCODE_BASE_URL=${p.url}`);
    }
  }
  lines.push('');
  return lines.join('\n');
}

export function writePreviewTokenArtifacts(
  outDir: string,
  set: PreviewTokenSet,
  opts?: { mintJsonName?: string; openUrlsName?: string },
): { mintJson: string; openUrls: string } {
  fs.mkdirSync(outDir, { recursive: true });
  const mintJson = path.join(outDir, opts?.mintJsonName || 'preview-tokens-mint.json');
  const openUrls = path.join(outDir, opts?.openUrlsName || 'open-urls.txt');
  fs.writeFileSync(mintJson, JSON.stringify(set, null, 2));
  fs.writeFileSync(openUrls, formatOpenUrlsText(set));
  // Always also write "latest" aliases for consumers
  fs.writeFileSync(path.join(outDir, 'preview-tokens-latest.json'), JSON.stringify(set, null, 2));
  fs.writeFileSync(path.join(outDir, 'open-urls-latest.txt'), formatOpenUrlsText(set));
  return { mintJson, openUrls };
}

/** Absolute URLs that must host-fetch successfully for a token set. */
export function hostFetchTargets(set: PreviewTokenSet): Array<{ port: number; path: string; url: string }> {
  const out: Array<{ port: number; path: string; url: string }> = [];
  for (const p of set.ports) {
    if (p.skipped || !p.url) continue;
    out.push({ port: p.port, path: p.primaryPath, url: p.url + p.primaryPath });
    for (const ep of p.extraPaths) {
      out.push({ port: p.port, path: ep, url: p.url + ep });
    }
  }
  return out;
}

export async function hostFetchPreviewTargets(
  set: PreviewTokenSet,
  fetchImpl: typeof fetch = fetch,
): Promise<PreviewFetchResult[]> {
  const results: PreviewFetchResult[] = [];
  for (const t of hostFetchTargets(set)) {
    try {
      const res = await fetchImpl(t.url, { redirect: 'follow' });
      const text = await res.text();
      const ok = res.status >= 200 && res.status < 300;
      results.push({
        port: t.port,
        path: t.path,
        url: t.url,
        status: res.status,
        ok,
        sample: text.slice(0, 200),
      });
    } catch (e) {
      results.push({
        port: t.port,
        path: t.path,
        url: t.url,
        status: 0,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return results;
}

export function allFetchesOk(results: PreviewFetchResult[]): boolean {
  return results.length > 0 && results.every((r) => r.ok);
}

/**
 * Mint signed previews for all standard ports from a sandbox-like object.
 * `mintPort` is injected so unit tests can supply fakes without Daytona.
 */
export async function mintAllPreviewPorts(opts: {
  sandboxId: string;
  ports?: readonly number[];
  generation?: number;
  expiresInSeconds?: number;
  /** Return url+token for a port, or null to skip */
  mintPort: (port: number) => Promise<{ url: string; token?: string | null } | null>;
  /** Optional: check if service is up; false → skip with reason */
  isPortReady?: (port: number) => Promise<boolean>;
}): Promise<PreviewTokenSet> {
  const ports = opts.ports ?? PREVIEW_TOKEN_PORTS;
  const list: Array<{
    port: number;
    url: string;
    token?: string | null;
    skipped?: boolean;
    skipReason?: string;
  }> = [];

  for (const port of ports) {
    if (opts.isPortReady) {
      const ready = await opts.isPortReady(port);
      if (!ready) {
        list.push({
          port,
          url: '',
          skipped: true,
          skipReason: 'service not ready on sandbox',
        });
        continue;
      }
    }
    const minted = await opts.mintPort(port);
    if (!minted?.url) {
      list.push({
        port,
        url: '',
        skipped: true,
        skipReason: 'getSignedPreviewUrl returned empty',
      });
      continue;
    }
    list.push({
      port,
      url: minted.url,
      token: minted.token ?? extractTokenFromPreviewUrl(minted.url),
    });
  }

  return buildPreviewTokenSet({
    sandboxId: opts.sandboxId,
    mints: list,
    generation: opts.generation ?? 1,
    expiresInSeconds: opts.expiresInSeconds ?? 3600,
  });
}

/**
 * Refresh = re-mint with incremented generation.
 * Does not destroy sandbox; only new signed URLs.
 */
export async function refreshPreviewTokenSet(
  previous: PreviewTokenSet,
  mintPort: (port: number) => Promise<{ url: string; token?: string | null } | null>,
  opts?: {
    ports?: readonly number[];
    expiresInSeconds?: number;
    isPortReady?: (port: number) => Promise<boolean>;
  },
): Promise<PreviewTokenSet> {
  return mintAllPreviewPorts({
    sandboxId: previous.sandboxId,
    ports: opts?.ports ?? previous.ports.map((p) => p.port),
    generation: nextGeneration(previous),
    expiresInSeconds: opts?.expiresInSeconds ?? previous.expiresInSeconds,
    mintPort,
    isPortReady: opts?.isPortReady,
  });
}
