/**
 * Ensure OpenCode serve + process board on formal Daytona sandbox; mint 4096 preview.
 *
 *   eval "$(python3 scripts/export-daytona-env.py)"
 *   SCRATCH=... KEEP_FORMAL_SANDBOX=1 npx tsx scripts/demo-formal-opencode.ts
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Daytona } from '@daytona/sdk';
import {
  ensureOpenCodeServeRunning,
  probeSandboxProcesses,
  hostFetchOpenCodeHealth,
} from '../src/verification-sandbox/opencode-serve.js';
import { liveMintPreviewTokens } from '../src/verification-sandbox/preview-token-live.js';
import { OPENCODE_SERVE_PORT } from '../src/verification-sandbox/types.js';

const SCRATCH =
  process.env.SCRATCH ||
  process.env.GOAL_SCRATCH ||
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../.gsd/evidence/formal-opencode');

function wj(name: string, data: unknown) {
  fs.mkdirSync(SCRATCH, { recursive: true });
  fs.writeFileSync(path.join(SCRATCH, name), JSON.stringify(data, null, 2));
}

async function main() {
  fs.mkdirSync(SCRATCH, { recursive: true });
  if (!process.env.DAYTONA_API_KEY) {
    console.error('DAYTONA_API_KEY required');
    process.exit(2);
  }

  const d = new Daytona({
    apiKey: process.env.DAYTONA_API_KEY,
    organizationId: process.env.DAYTONA_ORGANIZATION_ID || undefined,
    target: process.env.DAYTONA_TARGET || 'us',
  });

  const preferred = process.env.FORMAL_SANDBOX_ID || process.env.DAYTONA_SANDBOX_ID || '';
  let sandbox: Awaited<ReturnType<Daytona['get']>>;
  let sandboxId: string;

  if (preferred) {
    sandbox = await d.get(preferred);
    sandboxId = preferred;
  } else {
    // first started
    let found: { id: string } | null = null;
    for await (const s of d.list()) {
      const st = String(s.state || s.status || '').toLowerCase();
      if (st === 'started' || st === 'running') {
        found = s;
        break;
      }
    }
    if (!found) {
      // create minimal formal path via handlePxFormalCreate would be heavy;
      // create bare box and bootstrap opencode only for smoke
      sandbox = await d.create(
        {
          language: 'python',
          snapshot: process.env.DAYTONA_SNAPSHOT || 'daytona-large',
          envVars: {
            ...(process.env.OPENROUTER_API_KEY
              ? { OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY }
              : {}),
            ...(process.env.BASETEN_API_KEY ? { BASETEN_API_KEY: process.env.BASETEN_API_KEY } : {}),
            OPENCODE_SERVE_PORT: String(OPENCODE_SERVE_PORT),
          },
          autoStopInterval: Math.min(
            5,
            Math.max(1, Number(process.env.DAYTONA_AUTO_STOP_MINUTES || 5) || 5),
          ),
          public: false,
        } as Parameters<typeof d.create>[0],
        { timeout: 120 },
      );
      sandboxId = sandbox.id;
    } else {
      sandbox = await d.get(found.id);
      sandboxId = found.id;
    }
  }

  console.log('sandbox', sandboxId);

  const oc = await ensureOpenCodeServeRunning(sandbox, {
    sandboxId,
    port: OPENCODE_SERVE_PORT,
  });
  wj('opencode-health-in-sandbox.json', oc);

  const board = await probeSandboxProcesses(sandbox, {
    sandboxId,
    includeAssistantUi: true,
    includeOpencode: true,
  });
  wj('sandbox-process-board.json', board);

  // mint previews (includes 4096)
  const mint = await liveMintPreviewTokens({
    sandboxId,
    outDir: SCRATCH,
    expiresInSeconds: 3600,
    generation: 1,
  });
  wj('opencode-preview-fetch.json', {
    setPorts: mint.set.ports.map((p) => ({
      port: p.port,
      skipped: p.skipped,
      url: p.url,
    })),
    fetches: mint.fetches,
    fetchesOk: mint.fetchesOk,
  });

  const ocPort = mint.set.ports.find((p) => p.port === OPENCODE_SERVE_PORT && !p.skipped);
  let hostHealth = null as Awaited<ReturnType<typeof hostFetchOpenCodeHealth>> | null;
  if (ocPort?.url) {
    hostHealth = await hostFetchOpenCodeHealth(ocPort.url);
    wj('opencode-host-health.json', hostHealth);
  }

  // SDK/HTTP smoke: list global or session endpoint if health ok
  let sdkSmoke: Record<string, unknown> = { skipped: true };
  if (ocPort?.url && hostHealth?.ok) {
    try {
      const base = ocPort.url.replace(/\/$/, '');
      const paths = ['/global/health', '/session', '/project', '/'];
      const hits: Array<{ path: string; status: number }> = [];
      for (const p of paths) {
        try {
          const r = await fetch(base + p, { redirect: 'follow' });
          hits.push({ path: p, status: r.status });
        } catch (e) {
          hits.push({ path: p, status: 0 });
        }
      }
      sdkSmoke = {
        skipped: false,
        baseUrl: base,
        hits,
        ok: hits.some((h) => h.status >= 200 && h.status < 400),
      };
    } catch (e) {
      sdkSmoke = { skipped: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
  wj('opencode-sdk-smoke.json', sdkSmoke);

  wj('sandbox-agent-meta.json', {
    sandboxId,
    opencodePort: OPENCODE_SERVE_PORT,
    opencodeOk: oc.ok,
    boardAllRequiredOk: board.allRequiredOk,
    board: board.processes.map((p) => ({ name: p.name, port: p.port, ok: p.ok, status: p.status })),
    hostHealthOk: hostHealth?.ok ?? false,
    sdkSmokeOk: (sdkSmoke as { ok?: boolean }).ok ?? false,
    openUrls: path.join(SCRATCH, 'open-urls.txt'),
    mintedAt: mint.set.mintedAt,
  });

  const pass =
    oc.ok &&
    Boolean(ocPort?.url) &&
    Boolean(hostHealth?.ok) &&
    board.processes.some((p) => p.name === 'opencode-serve' && p.ok);

  console.log(pass ? 'DEMO FORMAL OPENCODE PASS' : 'DEMO FORMAL OPENCODE PARTIAL', {
    sandboxId,
    opencodeOk: oc.ok,
    hostHealth: hostHealth?.status,
    board: board.processes.map((p) => `${p.name}:${p.status}`),
    opencodeUrl: ocPort?.url,
  });
  if (fs.existsSync(path.join(SCRATCH, 'open-urls.txt'))) {
    console.log(fs.readFileSync(path.join(SCRATCH, 'open-urls.txt'), 'utf8'));
  }

  if (process.env.KEEP_FORMAL_SANDBOX !== '1' && !preferred) {
    // only destroy if we created ephemeral without preferred id
    try {
      await d.delete(sandbox);
    } catch {
      /* */
    }
  }

  process.exitCode = pass ? 0 : 1;
}

main().catch((e) => {
  console.error(e);
  try {
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.writeFileSync(
      path.join(SCRATCH, 'demo-fatal.txt'),
      e instanceof Error ? e.stack || e.message : String(e),
    );
  } catch {
    /* */
  }
  process.exit(1);
});
