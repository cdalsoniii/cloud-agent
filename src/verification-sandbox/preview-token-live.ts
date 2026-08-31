/**
 * Live Daytona mint/refresh for formal preview tokens.
 */
import fs from 'fs';
import path from 'path';
import { Daytona } from '@daytona/sdk';
import {
  allFetchesOk,
  hostFetchPreviewTargets,
  mintAllPreviewPorts,
  PREVIEW_TOKEN_PORTS,
  refreshPreviewTokenSet,
  writePreviewTokenArtifacts,
  type PreviewTokenSet,
  type PreviewFetchResult,
} from './preview-tokens.js';

export interface LiveMintResult {
  set: PreviewTokenSet;
  fetches: PreviewFetchResult[];
  fetchesOk: boolean;
  outDir: string;
  paths: { mintJson: string; openUrls: string };
}

function getDaytona(): Daytona {
  const apiKey = process.env.DAYTONA_API_KEY;
  if (!apiKey) throw new Error('DAYTONA_API_KEY is required');
  return new Daytona({
    apiKey,
    organizationId: process.env.DAYTONA_ORGANIZATION_ID || undefined,
    apiUrl: process.env.DAYTONA_API_URL || 'https://app.daytona.io/api',
    target: process.env.DAYTONA_TARGET || 'us',
  });
}

export async function resolveStartedSandbox(opts?: {
  sandboxId?: string;
}): Promise<{ sandbox: Awaited<ReturnType<Daytona['get']>>; sandboxId: string }> {
  const d = getDaytona();
  const preferred =
    opts?.sandboxId ||
    process.env.FORMAL_SANDBOX_ID ||
    process.env.DAYTONA_SANDBOX_ID ||
    '';

  if (preferred) {
    const sb = await d.get(preferred);
    const st = String(sb.state || (sb as { status?: string }).status || '').toLowerCase();
    if (st && st !== 'started' && st !== 'running') {
      throw new Error(`sandbox ${preferred} state=${st} (need started)`);
    }
    return { sandbox: sb, sandboxId: preferred };
  }

  let n = 0;
  for await (const s of d.list()) {
    n++;
    const st = String(s.state || s.status || '').toLowerCase();
    if (st === 'started' || st === 'running') {
      const sb = await d.get(s.id);
      // Prefer one that has formal ports responding
      try {
        const r = await sb.process.executeCommand(
          'curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:7005/health 2>/dev/null || echo 0',
          undefined,
          undefined,
          15,
        );
        const code = String(r.result || r.artifacts?.stdout || '').trim();
        if (code === '200' || code === '000' || code) {
          // accept first started; prefer 200 if we find one
          if (code === '200') return { sandbox: sb, sandboxId: s.id };
        }
      } catch {
        /* try next */
      }
      // fallback keep first started
      return { sandbox: sb, sandboxId: s.id };
    }
    if (n >= 25) break;
  }
  throw new Error('No started Daytona sandbox found; run formal create first');
}

function mintPortFromSandbox(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  expiresInSeconds: number,
): (port: number) => Promise<{ url: string; token?: string | null } | null> {
  return async (port: number) => {
    try {
      let signed: { url?: string; token?: string } | string | null = null;
      if (typeof sandbox.getSignedPreviewUrl === 'function') {
        // SDK may accept optional TTL as 2nd arg on some versions
        try {
          signed = await sandbox.getSignedPreviewUrl(port, expiresInSeconds);
        } catch {
          signed = await sandbox.getSignedPreviewUrl(port);
        }
      } else if (typeof sandbox.createSignedPreviewUrl === 'function') {
        signed = await sandbox.createSignedPreviewUrl(port, expiresInSeconds);
      }
      if (!signed) return null;
      if (typeof signed === 'string') return { url: signed };
      return { url: signed.url || String(signed), token: signed.token };
    } catch {
      return null;
    }
  };
}

function isPortReadyFromSandbox(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
): (port: number) => Promise<boolean> {
  return async (port: number) => {
    try {
      const path =
        port === 3010 ? '/' : port === 4096 ? '/global/health' : '/health';
      const r = await sandbox.process.executeCommand(
        `code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://127.0.0.1:${port}${path} 2>/dev/null || echo 000); ` +
          (port === 4096
            ? `if [ "$code" = "000" ] || [ "$code" = "404" ]; then code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 4 http://127.0.0.1:${port}/health 2>/dev/null || echo 000); fi; `
            : '') +
          `echo $code`,
        undefined,
        undefined,
        20,
      );
      const code = String(r.result || r.artifacts?.stdout || '').trim();
      const n = parseInt(code, 10);
      return n >= 200 && n < 500;
    } catch {
      return false;
    }
  };
}

export async function liveMintPreviewTokens(opts?: {
  sandboxId?: string;
  outDir?: string;
  expiresInSeconds?: number;
  generation?: number;
  previous?: PreviewTokenSet | null;
}): Promise<LiveMintResult> {
  const { sandbox, sandboxId } = await resolveStartedSandbox({ sandboxId: opts?.sandboxId });
  const expiresInSeconds = opts?.expiresInSeconds ?? 3600;
  const outDir =
    opts?.outDir ||
    process.env.SCRATCH ||
    process.env.GOAL_SCRATCH ||
    path.join(process.cwd(), '.gsd/evidence/preview-tokens');

  const mintPort = mintPortFromSandbox(sandbox, expiresInSeconds);
  const isPortReady = isPortReadyFromSandbox(sandbox);

  let set: PreviewTokenSet;
  if (opts?.previous) {
    set = await refreshPreviewTokenSet(opts.previous, mintPort, {
      ports: PREVIEW_TOKEN_PORTS,
      expiresInSeconds,
      isPortReady,
    });
  } else {
    set = await mintAllPreviewPorts({
      sandboxId,
      ports: PREVIEW_TOKEN_PORTS,
      generation: opts?.generation ?? 1,
      expiresInSeconds,
      mintPort,
      isPortReady,
    });
  }

  const paths = writePreviewTokenArtifacts(outDir, set, {
    mintJsonName: opts?.previous ? 'preview-tokens-refresh.json' : 'preview-tokens-mint.json',
  });

  // Also durable under in-repo evidence latest
  try {
    const evidence = path.join(process.cwd(), '.gsd/evidence');
    fs.mkdirSync(evidence, { recursive: true });
    fs.writeFileSync(path.join(evidence, 'LATEST-open-urls.txt'), fs.readFileSync(paths.openUrls));
    fs.writeFileSync(
      path.join(evidence, 'LATEST-preview-tokens.json'),
      JSON.stringify(set, null, 2),
    );
  } catch {
    /* non-fatal */
  }

  const fetches = await hostFetchPreviewTargets(set);
  return {
    set,
    fetches,
    fetchesOk: allFetchesOk(fetches),
    outDir,
    paths,
  };
}

export async function liveRefreshPreviewTokens(opts?: {
  sandboxId?: string;
  outDir?: string;
  expiresInSeconds?: number;
  previousPath?: string;
}): Promise<LiveMintResult> {
  const outDir =
    opts?.outDir ||
    process.env.SCRATCH ||
    process.env.GOAL_SCRATCH ||
    path.join(process.cwd(), '.gsd/evidence/preview-tokens');

  let previous: PreviewTokenSet | null = null;
  const candidates = [
    opts?.previousPath,
    path.join(outDir, 'preview-tokens-latest.json'),
    path.join(outDir, 'preview-tokens-mint.json'),
    path.join(process.cwd(), '.gsd/evidence/LATEST-preview-tokens.json'),
  ].filter(Boolean) as string[];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try {
        previous = JSON.parse(fs.readFileSync(p, 'utf8')) as PreviewTokenSet;
        break;
      } catch {
        /* */
      }
    }
  }

  if (!previous) {
    // first mint if nothing to refresh
    return liveMintPreviewTokens({
      sandboxId: opts?.sandboxId,
      outDir,
      expiresInSeconds: opts?.expiresInSeconds,
      generation: 1,
    });
  }

  return liveMintPreviewTokens({
    sandboxId: opts?.sandboxId || previous.sandboxId,
    outDir,
    expiresInSeconds: opts?.expiresInSeconds ?? previous.expiresInSeconds,
    previous,
  });
}

/**
 * Interval refresh loop — re-mints without destroying sandbox.
 * Returns after `ticks` refreshes (including optional initial mint).
 */
export async function runPreviewTokenRefreshLoop(opts: {
  sandboxId?: string;
  outDir: string;
  intervalMs: number;
  ticks: number;
  expiresInSeconds?: number;
  onTick?: (result: LiveMintResult, tick: number) => void;
}): Promise<LiveMintResult[]> {
  const results: LiveMintResult[] = [];
  let previous: PreviewTokenSet | null = null;

  for (let i = 0; i < opts.ticks; i++) {
    const r =
      i === 0 && !previous
        ? await liveMintPreviewTokens({
            sandboxId: opts.sandboxId,
            outDir: opts.outDir,
            expiresInSeconds: opts.expiresInSeconds,
            generation: 1,
          })
        : await liveMintPreviewTokens({
            sandboxId: opts.sandboxId || previous?.sandboxId,
            outDir: opts.outDir,
            expiresInSeconds: opts.expiresInSeconds,
            previous: previous!,
          });
    results.push(r);
    previous = r.set;
    opts.onTick?.(r, i);
    if (i < opts.ticks - 1 && opts.intervalMs > 0) {
      await new Promise((res) => setTimeout(res, opts.intervalMs));
    }
  }
  return results;
}
