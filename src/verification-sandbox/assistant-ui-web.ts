/**
 * Pack, upload, install, and start latest on-disk assistant-ui web (Next)
 * inside a Daytona formal sandbox.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { execInSandbox } from '../mastra/tools/daytona-client.js';
import {
  ASSISTANT_UI_WEB_PORT,
  REMOTE_ASSISTANT_UI,
  type ShaclPreviewUrl,
} from './types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function resolveAssistantUiRoot(explicit?: string): string | null {
  const candidates = [
    explicit,
    process.env.ASSISTANT_UI_ROOT,
    process.env.ASSISTANT_UI_PATH,
    path.resolve(
      process.env.HOME || '',
      'Documents/Personal/employment/partners/experiments/02-products/assistant-ui',
    ),
    path.resolve(__dirname, '../../../02-products/assistant-ui'),
    path.resolve(process.cwd(), '../02-products/assistant-ui'),
    path.resolve(process.cwd(), '../../02-products/assistant-ui'),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      const webPkg = path.join(c, 'packages/web/package.json');
      if (fs.existsSync(webPkg)) return path.resolve(c);
    } catch {
      /* skip */
    }
  }
  return null;
}

/** Paths included in the sandbox tarball (relative to monorepo root). */
export function assistantUiPackIncludeList(root: string): string[] {
  const include: string[] = ['package.json'];
  for (const f of ['package-lock.json', 'npm-shrinkwrap.json', '.npmrc', 'tsconfig.json', 'tsconfig.base.json']) {
    if (fs.existsSync(path.join(root, f))) include.push(f);
  }
  for (const pkg of ['packages/web', 'packages/verified-kernels', 'packages/core']) {
    if (fs.existsSync(path.join(root, pkg))) include.push(pkg);
  }
  // optional .px for local pack resolution inside Next
  if (fs.existsSync(path.join(root, '.px'))) include.push('.px');
  return include;
}

/**
 * Build a compressed tarball of monorepo subset (no node_modules / .next).
 * Returns absolute path to .tgz on host.
 */
export function buildAssistantUiWebTarball(root?: string): {
  tarballPath: string;
  root: string;
  include: string[];
  bytes: number;
  source: Record<string, unknown>;
} {
  const auiRoot = resolveAssistantUiRoot(root);
  if (!auiRoot) {
    throw new Error(
      'assistant-ui root not found (set ASSISTANT_UI_ROOT or use 02-products/assistant-ui)',
    );
  }
  const include = assistantUiPackIncludeList(auiRoot);
  if (!include.some((p) => p.startsWith('packages/web'))) {
    throw new Error(`packages/web missing under ${auiRoot}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aui-web-'));
  const tarballPath = path.join(tmpDir, 'assistant-ui-web.tgz');

  const args = [
    '-czf',
    tarballPath,
    '--exclude=node_modules',
    '--exclude=.next',
    '--exclude=dist',
    '--exclude=coverage',
    '--exclude=.git',
    '--exclude=*.log',
    '--exclude=playwright-report',
    '-C',
    auiRoot,
    ...include,
  ];
  const r = spawnSync('tar', args, { encoding: 'utf8' });
  if (r.status !== 0) {
    throw new Error(`tar failed: ${r.stderr || r.stdout || r.status}`);
  }
  const st = fs.statSync(tarballPath);
  let gitSha: string | null = null;
  try {
    const g = spawnSync('git', ['-C', auiRoot, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
    });
    if (g.status === 0) gitSha = (g.stdout || '').trim() || null;
  } catch {
    /* */
  }

  return {
    tarballPath,
    root: auiRoot,
    include,
    bytes: st.size,
    source: {
      hostPath: auiRoot,
      gitSha,
      packedAt: new Date().toISOString(),
      include,
      bytes: st.size,
    },
  };
}

async function uploadBufferToSandbox(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  remotePath: string,
  buf: Buffer,
): Promise<void> {
  await execInSandbox(sandbox, `mkdir -p ${JSON.stringify(path.posix.dirname(remotePath))}`, {
    timeoutSeconds: 30,
  });
  if (sandbox.fs?.uploadFile) {
    await sandbox.fs.uploadFile(buf, remotePath);
    return;
  }
  // base64 chunk fallback
  const b64 = buf.toString('base64');
  const chunkSize = 40_000;
  const tmp = remotePath + '.b64';
  await execInSandbox(sandbox, `rm -f ${JSON.stringify(tmp)}`, { timeoutSeconds: 15 });
  for (let i = 0; i < b64.length; i += chunkSize) {
    const part = b64.slice(i, i + chunkSize);
    await execInSandbox(
      sandbox,
      `printf %s ${JSON.stringify(part)} >> ${JSON.stringify(tmp)}`,
      { timeoutSeconds: 30 },
    );
  }
  await execInSandbox(
    sandbox,
    `python3 -c "import base64,pathlib; p=pathlib.Path(${JSON.stringify(tmp)}); pathlib.Path(${JSON.stringify(remotePath)}).write_bytes(base64.b64decode(p.read_text())); p.unlink(missing_ok=True)"`,
    { timeoutSeconds: 120 },
  );
}

export interface EnsureAssistantUiWebResult {
  ok: boolean;
  remoteRoot: string;
  port: number;
  source: Record<string, unknown>;
  installOk: boolean;
  ready: boolean;
  probe: {
    home?: { ok: boolean; status?: number; sample?: string };
    verifierFleet?: { ok: boolean; status?: number; sample?: string };
    process?: string;
  };
  logTail?: string;
  error?: string;
}

/**
 * Upload latest assistant-ui web subset, npm install, start next on ASSISTANT_UI_WEB_PORT.
 */
export async function ensureAssistantUiWebRunning(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  opts?: {
    assistantUiRoot?: string;
    port?: number;
    skipInstall?: boolean;
    readyTimeoutMs?: number;
  },
): Promise<EnsureAssistantUiWebResult> {
  const port = opts?.port ?? ASSISTANT_UI_WEB_PORT;
  const remoteRoot = REMOTE_ASSISTANT_UI;
  const packed = buildAssistantUiWebTarball(opts?.assistantUiRoot);
  const remoteTgz = '/tmp/assistant-ui-web.tgz';

  try {
    const buf = fs.readFileSync(packed.tarballPath);
    await uploadBufferToSandbox(sandbox, remoteTgz, buf);

    // extract
    await execInSandbox(
      sandbox,
      `rm -rf ${JSON.stringify(remoteRoot)} && mkdir -p ${JSON.stringify(remoteRoot)} && ` +
        `tar -xzf ${JSON.stringify(remoteTgz)} -C ${JSON.stringify(remoteRoot)} && ` +
        `printf %s ${JSON.stringify(JSON.stringify(packed.source, null, 2))} > ${JSON.stringify(remoteRoot + '/ASSISTANT_UI_SOURCE.json')}`,
      { timeoutSeconds: 120 },
    );

    // node path (daytona-large has nvm)
    const nodeSetup =
      'export NVM_DIR="$HOME/.nvm"; [ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"; ' +
      'export PATH="/usr/local/share/nvm/current/bin:$PATH:/usr/local/bin:$PATH"; ';

    let installOk = true;
    if (!opts?.skipInstall) {
      // Install web + verified-kernels workspaces (web depends on * workspace package)
      const install = await execInSandbox(
        sandbox,
        nodeSetup +
          `cd ${JSON.stringify(remoteRoot)} && ` +
          `npm install --no-audit --no-fund ` +
          `--workspace=@assistant-ui/web --workspace=@assistant-ui/verified-kernels ` +
          `--include-workspace-root 2>&1 | tail -50`,
        { timeoutSeconds: 900 },
      );
      installOk = install.ok || /added \d+|up to date/i.test(install.stdout);
      if (!installOk) {
        const install2 = await execInSandbox(
          sandbox,
          nodeSetup +
            `cd ${JSON.stringify(remoteRoot)} && npm install --no-audit --no-fund 2>&1 | tail -50`,
          { timeoutSeconds: 900 },
        );
        installOk = install2.ok || /added \d+|up to date/i.test(install2.stdout);
        if (!installOk) {
          return {
            ok: false,
            remoteRoot,
            port,
            source: packed.source,
            installOk: false,
            ready: false,
            probe: {},
            logTail: install2.stdout || install.stdout,
            error: 'npm install failed',
          };
        }
      }

      // Workspace package main is dist/ — build if missing (host dist is in tarball when present)
      await execInSandbox(
        sandbox,
        nodeSetup +
          `cd ${JSON.stringify(remoteRoot)} && ` +
          `if [ ! -f packages/verified-kernels/dist/index.js ]; then ` +
          `  npm run build --workspace=@assistant-ui/verified-kernels 2>&1 | tail -30; ` +
          `else echo kernels-dist-present; fi`,
        { timeoutSeconds: 180 },
      );
    }

    // stop previous next if any; start bound to 0.0.0.0
    // Unset Clerk so middleware does not require auth (omit host .env.local secrets)
    await execInSandbox(
      sandbox,
      nodeSetup +
        `(pkill -f 'next dev' 2>/dev/null || true); (pkill -f 'next-server' 2>/dev/null || true); sleep 1; ` +
        `cd ${JSON.stringify(remoteRoot)} && ` +
        `rm -f packages/web/.env.local packages/web/.env.local.bak 2>/dev/null; ` +
        `nohup env -u NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY -u CLERK_SECRET_KEY ` +
        `PORT=${port} HOSTNAME=0.0.0.0 NEXT_TELEMETRY_DISABLED=1 ` +
        `PX_ROOT=${JSON.stringify(remoteRoot + '/.px')} ` +
        `npm run dev --workspace=@assistant-ui/web -- -H 0.0.0.0 -p ${port} ` +
        `>/tmp/assistant-ui-web.log 2>&1 & echo next-started`,
      { timeoutSeconds: 60 },
    );

    const deadline = Date.now() + (opts?.readyTimeoutMs ?? 180_000);
    let ready = false;
    let homeProbe = { ok: false as boolean, status: 0, sample: '' };
    let fleetProbe = { ok: false as boolean, status: 0, sample: '' };

    while (Date.now() < deadline) {
      const home = await execInSandbox(
        sandbox,
        `code=$(curl -s -o /tmp/aui-home.html -w '%{http_code}' --max-time 5 http://127.0.0.1:${port}/ || echo 000); echo $code; head -c 200 /tmp/aui-home.html 2>/dev/null`,
        { timeoutSeconds: 20 },
      );
      const lines = (home.stdout || '').split('\n');
      const status = parseInt(lines[0] || '0', 10) || 0;
      homeProbe = {
        ok: status === 200 || status === 304,
        status,
        sample: lines.slice(1).join('\n').slice(0, 200),
      };

      const fleet = await execInSandbox(
        sandbox,
        `code=$(curl -s -o /tmp/aui-fleet.html -w '%{http_code}' --max-time 15 -L http://127.0.0.1:${port}/verifier-fleet || echo 000); echo $code; head -c 300 /tmp/aui-fleet.html 2>/dev/null`,
        { timeoutSeconds: 30 },
      );
      const fl = (fleet.stdout || '').split('\n');
      const fstatus = parseInt(fl[0] || '0', 10) || 0;
      const fbody = fl.slice(1).join('\n');
      fleetProbe = {
        ok:
          fstatus === 200 ||
          fstatus === 304 ||
          (fstatus > 0 && /verifier-fleet|react-flow|__NEXT_DATA__/i.test(fbody)),
        status: fstatus,
        sample: fbody.slice(0, 300),
      };

      // Ready when Next serves 200 on home; prefer fleet 200 too
      if (homeProbe.ok) {
        ready = true;
        if (fleetProbe.ok) break;
        // first compile of /verifier-fleet can lag after /
        if (Date.now() > deadline - 45_000 && homeProbe.ok) break;
      }
      await new Promise((r) => setTimeout(r, 3000));
    }

    const proc = await execInSandbox(
      sandbox,
      `ps aux | grep -E 'next|packages/web' | grep -v grep | head -5; tail -30 /tmp/assistant-ui-web.log 2>/dev/null`,
      { timeoutSeconds: 20 },
    );

    return {
      ok: ready,
      remoteRoot,
      port,
      source: packed.source,
      installOk,
      ready,
      probe: {
        home: homeProbe,
        verifierFleet: fleetProbe,
        process: proc.stdout?.slice(0, 1500),
      },
      logTail: proc.stdout?.slice(-800),
      error: ready ? undefined : 'Next did not become ready on port ' + port,
    };
  } finally {
    try {
      fs.rmSync(path.dirname(packed.tarballPath), { recursive: true, force: true });
    } catch {
      /* */
    }
  }
}

/** Mint signed preview for assistant-ui web port. */
export async function mintAssistantUiWebPreview(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sandbox: any,
  port = ASSISTANT_UI_WEB_PORT,
): Promise<ShaclPreviewUrl | null> {
  try {
    if (typeof sandbox.getSignedPreviewUrl === 'function') {
      const signed = await sandbox.getSignedPreviewUrl(port);
      return {
        url: signed.url || String(signed),
        token: signed.token,
        port,
        expiresInSeconds: 3600,
      };
    }
    if (typeof sandbox.createSignedPreviewUrl === 'function') {
      const signed = await sandbox.createSignedPreviewUrl(port, 3600);
      return {
        url: signed.url || signed.previewUrl || String(signed),
        token: signed.token,
        port,
        expiresInSeconds: 3600,
      };
    }
  } catch {
    /* */
  }
  return null;
}
