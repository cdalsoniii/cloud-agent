/**
 * Mint or refresh Daytona signed preview URLs for formal + assistant-ui ports.
 *
 *   eval "$(python3 scripts/export-daytona-env.py)"
 *   SCRATCH=... npx tsx scripts/mint-formal-previews.ts
 *   SCRATCH=... npx tsx scripts/mint-formal-previews.ts --refresh
 *   SCRATCH=... npx tsx scripts/mint-formal-previews.ts --watch --interval 60 --ticks 2
 *
 * Always overwrites open-urls.txt + preview-tokens-latest.json under SCRATCH.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  liveMintPreviewTokens,
  liveRefreshPreviewTokens,
  runPreviewTokenRefreshLoop,
} from '../src/verification-sandbox/preview-token-live.js';
import { didTokensRotate } from '../src/verification-sandbox/preview-tokens.js';

const SCRATCH =
  process.env.SCRATCH ||
  process.env.GOAL_SCRATCH ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../.gsd/evidence/preview-tokens');

function parseArgs(argv: string[]) {
  const out = {
    refresh: false,
    watch: false,
    intervalSec: 45,
    ticks: 2,
    sandboxId: process.env.FORMAL_SANDBOX_ID || process.env.DAYTONA_SANDBOX_ID || '',
    expiresInSeconds: 3600,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--refresh') out.refresh = true;
    else if (a === '--watch') out.watch = true;
    else if (a === '--interval' && argv[i + 1]) out.intervalSec = parseInt(argv[++i], 10) || 45;
    else if (a === '--ticks' && argv[i + 1]) out.ticks = parseInt(argv[++i], 10) || 2;
    else if (a === '--sandbox' && argv[i + 1]) out.sandboxId = argv[++i];
    else if (a === '--ttl' && argv[i + 1]) out.expiresInSeconds = parseInt(argv[++i], 10) || 3600;
  }
  return out;
}

function wj(name: string, data: unknown) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, name), JSON.stringify(data, null, 2));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  fs.mkdirSync(SCRATCH, { recursive: true });

  if (!process.env.DAYTONA_API_KEY) {
    console.error('DAYTONA_API_KEY required');
    process.exit(2);
  }

  if (args.watch) {
    const results = await runPreviewTokenRefreshLoop({
      sandboxId: args.sandboxId || undefined,
      outDir: SCRATCH,
      intervalMs: Math.max(1000, args.intervalSec * 1000),
      ticks: Math.max(2, args.ticks),
      expiresInSeconds: args.expiresInSeconds,
      onTick: (r, tick) => {
        console.log(
          `tick ${tick} gen=${r.set.generation} fetchesOk=${r.fetchesOk} urls=${r.set.ports.filter((p) => !p.skipped).length}`,
        );
        wj(tick === 0 ? 'preview-tokens-mint.json' : `preview-tokens-refresh-tick-${tick}.json`, r.set);
        wj(tick === 0 ? 'preview-tokens-fetch-1.json' : `preview-tokens-fetch-${tick + 1}.json`, r.fetches);
      },
    });
    const first = results[0];
    const last = results[results.length - 1];
    const rotated = first && last ? didTokensRotate(first.set, last.set) : false;
    wj('preview-tokens-meta.json', {
      sandboxId: last?.set.sandboxId,
      ticks: results.length,
      rotated,
      firstMintedAt: first?.set.mintedAt,
      lastMintedAt: last?.set.mintedAt,
      allFetchesOk: results.every((r) => r.fetchesOk),
    });
    // alias last refresh
    if (last) {
      wj('preview-tokens-refresh.json', last.set);
      wj('preview-tokens-fetch-2.json', last.fetches);
    }
    if (!results.every((r) => r.fetchesOk)) {
      console.error('FAIL: one or more host fetches not 2xx');
      process.exitCode = 1;
      return;
    }
    console.log('WATCH PASS', {
      sandboxId: last?.set.sandboxId,
      rotated,
      generations: results.map((r) => r.set.generation),
    });
    console.log(fs.readFileSync(path.join(SCRATCH, 'open-urls.txt'), 'utf8'));
    return;
  }

  const mint = args.refresh
    ? await liveRefreshPreviewTokens({
        sandboxId: args.sandboxId || undefined,
        outDir: SCRATCH,
        expiresInSeconds: args.expiresInSeconds,
      })
    : await liveMintPreviewTokens({
        sandboxId: args.sandboxId || undefined,
        outDir: SCRATCH,
        expiresInSeconds: args.expiresInSeconds,
        generation: 1,
      });

  wj(args.refresh ? 'preview-tokens-refresh.json' : 'preview-tokens-mint.json', mint.set);
  wj(args.refresh ? 'preview-tokens-fetch-2.json' : 'preview-tokens-fetch-1.json', mint.fetches);

  // On plain mint, also run one refresh immediately to prove rotation path
  if (!args.refresh) {
    const refreshed = await liveMintPreviewTokens({
      sandboxId: mint.set.sandboxId,
      outDir: SCRATCH,
      expiresInSeconds: args.expiresInSeconds,
      previous: mint.set,
    });
    wj('preview-tokens-refresh.json', refreshed.set);
    wj('preview-tokens-fetch-2.json', refreshed.fetches);
    const rotated = didTokensRotate(mint.set, refreshed.set);
    wj('preview-tokens-meta.json', {
      sandboxId: mint.set.sandboxId,
      firstMintedAt: mint.set.mintedAt,
      refreshMintedAt: refreshed.set.mintedAt,
      generation1: mint.set.generation,
      generation2: refreshed.set.generation,
      rotated,
      mintFetchesOk: mint.fetchesOk,
      refreshFetchesOk: refreshed.fetchesOk,
      note: 'Default CLI: mint then immediate refresh without sandbox recreate',
    });

    // Optional: prove stale first token fails while refreshed succeeds (best-effort)
    try {
      const oldUrl = mint.set.ports.find((p) => p.port === 3010 && !p.skipped)?.url;
      const newUrl = refreshed.set.ports.find((p) => p.port === 3010 && !p.skipped)?.url;
      if (oldUrl && newUrl && oldUrl !== newUrl) {
        // Don't require old to fail immediately (TTL may still be valid); record both
        const oldRes = await fetch(oldUrl + '/', { redirect: 'follow' });
        const newRes = await fetch(newUrl + '/', { redirect: 'follow' });
        wj('preview-tokens-stale-vs-fresh.json', {
          oldUrl,
          oldStatus: oldRes.status,
          newUrl,
          newStatus: newRes.status,
        });
      }
    } catch {
      /* optional */
    }

    if (!mint.fetchesOk || !refreshed.fetchesOk) {
      console.error('FAIL host fetch', {
        mint: mint.fetches,
        refresh: refreshed.fetches,
      });
      process.exitCode = 1;
      return;
    }
    console.log('MINT+REFRESH PASS', {
      sandboxId: mint.set.sandboxId,
      rotated,
      openUrls: path.join(SCRATCH, 'open-urls.txt'),
    });
  } else {
    wj('preview-tokens-meta.json', {
      sandboxId: mint.set.sandboxId,
      mintedAt: mint.set.mintedAt,
      generation: mint.set.generation,
      fetchesOk: mint.fetchesOk,
      mode: 'refresh-only',
    });
    if (!mint.fetchesOk) {
      console.error('FAIL host fetch', mint.fetches);
      process.exitCode = 1;
      return;
    }
    console.log('REFRESH PASS', { sandboxId: mint.set.sandboxId, generation: mint.set.generation });
  }

  console.log(fs.readFileSync(path.join(SCRATCH, 'open-urls.txt'), 'utf8'));
}

main().catch((e) => {
  console.error(e);
  try {
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(
      path.join(SCRATCH, 'preview-tokens-fatal.txt'),
      e instanceof Error ? e.stack || e.message : String(e),
    );
  } catch {
    /* */
  }
  process.exit(1);
});
