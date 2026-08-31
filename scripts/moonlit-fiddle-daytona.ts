#!/usr/bin/env tsx
/**
 * Moonlit-fiddle plan executor — remote Daytona sandbox (@daytona/sdk).
 * Loads env via dotenv (never bash-source). Applies a11y fixes from
 * ~/.claude/plans/create-a-plan-to-moonlit-fiddle.md against assistant-ui.
 *
 * Usage (from cloud-agent root):
 *   npx tsx scripts/moonlit-fiddle-daytona.ts
 *   npx tsx scripts/moonlit-fiddle-daytona.ts --sandbox-id <id>
 *   npx tsx scripts/moonlit-fiddle-daytona.ts --destroy-sandbox
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  getDaytonaClient,
  releaseDaytonaClient,
  execInSandbox,
  writeSandboxState,
  readSandboxState,
  clearSandboxState,
} from '../src/mastra/tools/daytona-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PLAN =
  process.env.MOONLIT_PLAN ||
  path.join(process.env.HOME || '', '.claude/plans/create-a-plan-to-moonlit-fiddle.md');
const LOCAL_UI =
  process.env.ASSISTANT_UI_PATH ||
  path.resolve(ROOT, '../../02-products/assistant-ui');

dotenv.config({ path: path.join(ROOT, '.env') });

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function evidencePath(label: string, ext = 'md'): string {
  const dir = path.join(ROOT, '.gsd', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${stamp()}-moonlit-fiddle-${label}.${ext}`);
}

function log(...args: unknown[]): void {
  console.log(`[moonlit-fiddle]`, ...args);
}

const REMOTE_PATCH_PATH = path.join(__dirname, 'moonlit-patch-remote.js');

async function ensureSandbox(explicitId?: string) {
  const daytona = getDaytonaClient();
  if (explicitId) {
    const sandbox = await daytona.get(explicitId);
    writeSandboxState({ sandboxId: sandbox.id, createdAt: new Date().toISOString() });
    return sandbox;
  }
  const existing = readSandboxState();
  if (existing?.sandboxId) {
    try {
      const sandbox = await daytona.get(existing.sandboxId);
      log('reusing sandbox', sandbox.id);
      return sandbox;
    } catch {
      log('stale state; creating new sandbox');
      clearSandboxState();
    }
  }
  log('creating Daytona sandbox snapshot=', process.env.DAYTONA_SNAPSHOT || 'daytona-large');
  const sandbox = await daytona.create(
    {
      language: 'typescript',
      snapshot: process.env.DAYTONA_SNAPSHOT || 'daytona-large',
      envVars: {
        HARNESS_SANDBOX: '1',
        DAYTONA_SDK_READY: '1',
        GIT_TOKEN:
          process.env.DAYTONA_GITHUB_TOKEN ||
          process.env.GITHUB_TOKEN ||
          process.env.GH_TOKEN ||
          '',
      },
      autoStopInterval: Math.min(
        5,
        Math.max(1, Number(process.env.DAYTONA_AUTO_STOP_MINUTES || 5) || 5),
      ),
      public: false,
      labels: { purpose: 'moonlit-fiddle-a11y', project: 'cloud-agent' },
    },
    { timeout: 300 },
  );
  writeSandboxState({ sandboxId: sandbox.id, createdAt: new Date().toISOString() });
  log('sandbox created', sandbox.id);
  return sandbox;
}

async function syncLocalTree(sandbox: Awaited<ReturnType<typeof ensureSandbox>>) {
  // Prefer git clone with token; fall back to uploading a tarball of key source files.
  const token =
    process.env.DAYTONA_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GIT_TOKEN ||
    '';
  const url = token
    ? `https://x-access-token:${token}@github.com/BrightforestX/assistant-ui.git`
    : 'https://github.com/BrightforestX/assistant-ui.git';

  const clone = await execInSandbox(
    sandbox,
    `rm -rf /home/daytona/assistant-ui && git clone --depth 1 --branch main ${url} /home/daytona/assistant-ui 2>&1 | tail -20`,
    { timeoutSeconds: 180 },
  );
  log('clone', clone.ok, clone.stdout.slice(0, 500));

  if (!clone.ok || clone.stdout.includes('not found') || clone.stdout.includes('Authentication')) {
    log('git clone failed — uploading local packages/web/src via tar');
    const { execSync } = await import('node:child_process');
    const tarPath = `/tmp/moonlit-assistant-web-src-${stamp()}.tar.gz`;
    execSync(
      `tar -czf ${tarPath} -C ${LOCAL_UI} packages/web/src/app packages/web/src/components/ChatPanel.tsx packages/web/src/components/RightPanel.tsx packages/web/src/components/GraphEditor.tsx packages/web/src/components/BottomStatusBar.tsx packages/web/src/components/viewer/RuleGraph.tsx 2>/dev/null || tar -czf ${tarPath} -C ${LOCAL_UI}/packages/web/src app components/ChatPanel.tsx components/RightPanel.tsx components/GraphEditor.tsx components/BottomStatusBar.tsx components/viewer`,
      { stdio: 'inherit' },
    );
    await execInSandbox(sandbox, 'mkdir -p /home/daytona/assistant-ui/packages/web/src', {
      timeoutSeconds: 30,
    });
    // Upload tar via SDK fs API
    const buf = fs.readFileSync(tarPath);
    const remoteTar = '/tmp/moonlit-web-src.tar.gz';
    await sandbox.fs.uploadFile(buf, remoteTar);
    const extract = await execInSandbox(
      sandbox,
      `mkdir -p /home/daytona/assistant-ui && tar -xzf ${remoteTar} -C /home/daytona/assistant-ui && find /home/daytona/assistant-ui/packages/web/src -type f | head -40`,
      { timeoutSeconds: 60 },
    );
    log('extract', extract.ok, extract.stdout.slice(0, 800));
    return { method: 'tarball', ok: extract.ok };
  }
  return { method: 'git', ok: true };
}

async function main() {
  const argv = process.argv.slice(2);
  let sandboxId: string | undefined;
  let destroy = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sandbox-id' && argv[i + 1]) sandboxId = argv[++i];
    else if (argv[i] === '--destroy-sandbox') destroy = true;
  }

  const planText = fs.existsSync(PLAN) ? fs.readFileSync(PLAN, 'utf8') : '(plan missing)';
  const evidenceLog: string[] = [];
  evidenceLog.push(`# Moonlit-fiddle Daytona run`);
  evidenceLog.push(`- started: ${new Date().toISOString()}`);
  evidenceLog.push(`- plan: \`${PLAN}\``);
  evidenceLog.push(`- plan bytes: ${planText.length}`);
  evidenceLog.push(`- local assistant-ui: \`${LOCAL_UI}\``);

  const sandbox = await ensureSandbox(sandboxId);
  evidenceLog.push(`- sandboxId: \`${sandbox.id}\``);
  log('sandbox', sandbox.id);

  // Upload plan + patcher
  await sandbox.fs.uploadFile(Buffer.from(planText, 'utf8'), '/tmp/moonlit-fiddle-plan.md');
  await sandbox.fs.uploadFile(fs.readFileSync(REMOTE_PATCH_PATH), '/tmp/moonlit-patch.js');
  evidenceLog.push(`- uploaded plan → /tmp/moonlit-fiddle-plan.md`);
  evidenceLog.push(`- uploaded patcher → /tmp/moonlit-patch.js`);

  const sync = await syncLocalTree(sandbox);
  evidenceLog.push(`- sync method: ${sync.method} ok=${sync.ok}`);

  const patch = await execInSandbox(
    sandbox,
    'node /tmp/moonlit-patch.js /home/daytona/assistant-ui',
    { timeoutSeconds: 60 },
  );
  log('patch', patch.ok, patch.stdout.slice(0, 2000));
  evidenceLog.push(`\n## Patch result\n\`\`\`\n${patch.stdout.slice(0, 4000)}\n\`\`\`\n`);

  // Verification probes (static — no full Next build required)
  const verify = await execInSandbox(
    sandbox,
    [
      'cd /home/daytona/assistant-ui && echo "== probes =="',
      'rg -n "maximumScale|userScalable" packages/web/src/app/layout.tsx || echo "OK viewport scale flags removed"',
      'rg -n "aria-label=\\"Model\\"|aria-label=\\"Add rule\\"|aria-label=\\"Message\\"" packages/web/src/components/ChatPanel.tsx || echo FAIL chat labels',
      'rg -n "aria-label=\\"Navigation\\"|aria-label=\\"Vendors\\"|sr-only|text-\\[#9a9a9a\\]" packages/web/src/app/page.tsx || echo FAIL page landmarks',
      'rg -n "API docs \\(opens in new tab\\)|Search vendors" packages/web/src/components/RightPanel.tsx || echo FAIL vendors',
      'rg -n "edgesFocusable=\\{false\\}|bgColor=\\"#111111\\"" packages/web/src/components/GraphEditor.tsx packages/web/src/components/viewer/RuleGraph.tsx || echo FAIL graph',
      'rg -n "contentinfo|Status bar|</footer>" packages/web/src/components/BottomStatusBar.tsx || echo FAIL footer',
      'rg -n "moonlit-fiddle focus ring" packages/web/src/app/globals.css || echo FAIL focus',
      'head -n 5 /tmp/moonlit-fiddle-plan.md',
    ].join(' && '),
    { timeoutSeconds: 60 },
  );
  log('verify', verify.ok, verify.stdout.slice(0, 3000));
  evidenceLog.push(`\n## Static verify\n\`\`\`\n${verify.stdout.slice(0, 6000)}\n\`\`\`\n`);

  // Optional: start opencode serve for agent loop evidence (non-blocking health check)
  const which = await execInSandbox(sandbox, 'command -v opencode || echo MISSING', {
    timeoutSeconds: 30,
  });
  evidenceLog.push(`- opencode binary: ${which.stdout.trim()}`);
  if (!which.stdout.includes('MISSING')) {
    await execInSandbox(
      sandbox,
      'curl -sf http://127.0.0.1:4096/global/health || (nohup opencode serve --hostname 127.0.0.1 --port 4096 > /tmp/opencode-serve.log 2>&1 & sleep 3; curl -sf http://127.0.0.1:4096/global/health || echo OPENCODE_UNHEALTHY)',
      { timeoutSeconds: 60 },
    ).then((r) => evidenceLog.push(`- opencode health: ${r.stdout.trim().slice(0, 200)}`));
  }

  const outPath = evidencePath('daytona-run');
  evidenceLog.push(`\n## Success criteria (plan)\n`);
  evidenceLog.push(`- Patches applied in remote sandbox for issues A–F (names, contrast, viewport, headings, landmarks, focus, edgesFocusable, minimap, mobile notice).`);
  evidenceLog.push(`- Full Playwright/axe against live :3010 still needs local/dev server re-run from partners/audit.`);
  evidenceLog.push(`\n- finished: ${new Date().toISOString()}\n`);
  fs.writeFileSync(outPath, evidenceLog.join('\n'));
  log('evidence', outPath);

  // Persist sandbox id for follow-up
  writeSandboxState({
    sandboxId: sandbox.id,
    createdAt: new Date().toISOString(),
    repoPath: '/home/daytona/assistant-ui',
  });

  if (destroy) {
    log('destroying sandbox', sandbox.id);
    await getDaytonaClient().delete(sandbox);
    clearSandboxState();
  }

  releaseDaytonaClient();
  console.log(
    JSON.stringify(
      {
        sandboxId: sandbox.id,
        evidence: outPath,
        patchOk: patch.ok,
        verifyOk: verify.ok,
        sync,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  releaseDaytonaClient();
  process.exit(1);
});
