#!/usr/bin/env tsx
/**
 * Expand assistant-ui web formal validation stack on a remote Daytona sandbox,
 * then push a branch + open a PR against BrightforestX/assistant-ui.
 *
 *   npx tsx scripts/expand-web-formal-daytona.ts
 *   npx tsx scripts/expand-web-formal-daytona.ts --no-pr
 *   npx tsx scripts/expand-web-formal-daytona.ts --destroy-sandbox
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import {
  clearSandboxState,
  execInSandbox,
  getDaytonaClient,
  readSandboxState,
  releaseDaytonaClient,
  writeSandboxState,
} from '../src/mastra/tools/daytona-client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LOCAL_UI =
  process.env.ASSISTANT_UI_PATH ||
  path.resolve(ROOT, '../../02-products/assistant-ui');
const REMOTE_REPO = 'https://github.com/BrightforestX/assistant-ui.git';
const BASE_BRANCH = process.env.ASSISTANT_UI_BASE_BRANCH || 'feat/mastra-integration';

dotenv.config({ path: path.join(ROOT, '.env') });

function stamp(): string {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function evidence(label: string, body: string): string {
  const dir = path.join(ROOT, '.gsd', 'evidence');
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, `${stamp()}-expand-web-formal-${label}.md`);
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

function log(...args: unknown[]): void {
  console.log('[expand-web-formal]', ...args);
}

function githubToken(): string {
  return (
    process.env.DAYTONA_GITHUB_TOKEN ||
    process.env.GITHUB_TOKEN ||
    process.env.GH_TOKEN ||
    process.env.GIT_TOKEN ||
    ''
  );
}

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
      return await daytona.get(existing.sandboxId);
    } catch {
      clearSandboxState();
    }
  }
  log('creating Daytona sandbox');
  const sandbox = await daytona.create(
    {
      language: 'typescript',
      snapshot: process.env.DAYTONA_SNAPSHOT || 'daytona-large',
      envVars: {
        HARNESS_SANDBOX: '1',
        GIT_TOKEN: githubToken(),
      },
      autoStopInterval: Math.min(
        5,
        Math.max(1, Number(process.env.DAYTONA_AUTO_STOP_MINUTES || 5) || 5),
      ),
      public: false,
      labels: { purpose: 'expand-web-formal', project: 'cloud-agent' },
    },
    { timeout: 300 },
  );
  writeSandboxState({ sandboxId: sandbox.id, createdAt: new Date().toISOString() });
  log('sandbox', sandbox.id);
  return sandbox;
}

const SYNC_PATHS = [
  'config/verification/quint/verify-api-happy-path.qnt',
  'config/verification/dafny/VerifyApi.dfy',
  'packages/web/src/lib/formal/runtime-trace-bridge.ts',
  'packages/web/src/lib/traces/types.ts',
  'packages/web/src/app/api/traces/route.ts',
  'packages/web/src/app/api/chat/route.ts',
  'packages/web/src/__tests__/formal/verify-api-happy-path.test.ts',
];

async function syncExpansionFiles(sandbox: Awaited<ReturnType<typeof ensureSandbox>>) {
  const token = githubToken();
  const authUrl = token
    ? `https://x-access-token:${token}@github.com/BrightforestX/assistant-ui.git`
    : REMOTE_REPO;

  let clone = await execInSandbox(
    sandbox,
    `rm -rf /home/daytona/assistant-ui && git clone --depth 1 --branch ${BASE_BRANCH} ${authUrl} /home/daytona/assistant-ui 2>&1 | tail -30`,
    { timeoutSeconds: 180 },
  );
  log('clone', clone.ok, clone.stdout.slice(0, 400));

  if (!clone.ok || /Authentication|not found|could not read/i.test(clone.stdout)) {
    log('clone failed — initializing from local tarball of expansion paths');
    await execInSandbox(sandbox, 'mkdir -p /home/daytona/assistant-ui && cd /home/daytona/assistant-ui && git init && git checkout -b expand-web-formal-stack', {
      timeoutSeconds: 60,
    });
  }

  const tarPath = `/tmp/expand-web-formal-${stamp()}.tar.gz`;
  const listFile = `/tmp/expand-web-formal-list-${stamp()}.txt`;
  fs.writeFileSync(listFile, SYNC_PATHS.join('\n') + '\n', 'utf8');
  execSync(`tar -czf ${tarPath} -C ${LOCAL_UI} -T ${listFile}`, {
    stdio: 'inherit',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });
  const buf = fs.readFileSync(tarPath);
  await sandbox.fs.uploadFile(buf, '/tmp/expand-web-formal.tar.gz');
  const extract = await execInSandbox(
    sandbox,
    `tar -xzf /tmp/expand-web-formal.tar.gz -C /home/daytona/assistant-ui && ls -la /home/daytona/assistant-ui/config/verification/quint/verify-api-happy-path.qnt /home/daytona/assistant-ui/packages/web/src/lib/formal/runtime-trace-bridge.ts`,
    { timeoutSeconds: 60 },
  );
  log('extract', extract.ok, extract.stdout.slice(0, 500));
  return extract.ok;
}

async function verifyInSandbox(sandbox: Awaited<ReturnType<typeof ensureSandbox>>) {
  const checks = await execInSandbox(
    sandbox,
    [
      'cd /home/daytona/assistant-ui',
      'set +e',
      'echo "== inventory =="',
      'ls config/verification/quint/verify-api-happy-path.qnt config/verification/dafny/VerifyApi.dfy packages/web/src/lib/formal/runtime-trace-bridge.ts',
      'echo "== quint =="',
      'if command -v quint >/dev/null 2>&1; then quint typecheck config/verification/quint/verify-api-happy-path.qnt; else echo SKIP_quint; fi',
      'echo "== dafny =="',
      'if command -v dafny >/dev/null 2>&1; then dafny verify --verification-time-limit=120 config/verification/dafny/VerifyApi.dfy; else echo SKIP_dafny; fi',
      'echo "== node syntax =="',
      'node --check packages/web/src/lib/formal/runtime-trace-bridge.ts 2>&1 || true',
      'echo DONE',
    ].join(' && '),
    { timeoutSeconds: 300 },
  );
  return checks;
}

async function pushBranch(sandbox: Awaited<ReturnType<typeof ensureSandbox>>, branch: string) {
  const token = githubToken();
  if (!token) {
    return { ok: false, stdout: 'no github token for push' };
  }
  const remote = `https://x-access-token:${token}@github.com/BrightforestX/assistant-ui.git`;
  return execInSandbox(
    sandbox,
    [
      'cd /home/daytona/assistant-ui',
      'git config user.email "cloud-agent@brightforestx.com"',
      'git config user.name "cloud-agent"',
      `git checkout -B ${branch}`,
      'git add -A',
      'git status --short | head -40',
      'git commit -m "formal: expand web verify happy-path stack (Quint/Dafny/traces/claimcheck)" || true',
      `git remote remove origin 2>/dev/null || true`,
      `git remote add origin ${remote}`,
      `git push -u origin ${branch} --force 2>&1 | tail -30`,
    ].join(' && '),
    { timeoutSeconds: 180 },
  );
}

async function main() {
  const argv = process.argv.slice(2);
  let sandboxId: string | undefined;
  let destroy = false;
  let noPr = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sandbox-id' && argv[i + 1]) sandboxId = argv[++i];
    else if (argv[i] === '--destroy-sandbox') destroy = true;
    else if (argv[i] === '--no-pr') noPr = true;
  }

  if (destroy) {
    const state = readSandboxState();
    if (state?.sandboxId) {
      const daytona = getDaytonaClient();
      const sandbox = await daytona.get(state.sandboxId);
      await daytona.delete(sandbox);
      clearSandboxState();
      releaseDaytonaClient();
      log('destroyed', state.sandboxId);
    }
    return;
  }

  const branch = `formal/expand-web-stack-${stamp().slice(0, 8)}`;
  const sandbox = await ensureSandbox(sandboxId);
  const synced = await syncExpansionFiles(sandbox);
  const verify = await verifyInSandbox(sandbox);
  const push = await pushBranch(sandbox, branch);

  let prUrl = '';
  if (!noPr && githubToken()) {
    try {
      const bodyFile = path.join('/tmp', `expand-web-formal-pr-${stamp()}.md`);
      fs.writeFileSync(
        bodyFile,
        [
          '## Summary',
          'Cloud-agent Daytona expansion of the **packages/web** formal validation stack.',
          '',
          `- Sandbox: \`${sandbox.id}\``,
          `- Branch: \`${branch}\``,
          '',
          '## Test plan',
          '- [ ] dafny verify VerifyApi.dfy',
          '- [ ] quint typecheck verify-api-happy-path.qnt',
          '- [ ] web formal jest',
          '',
        ].join('\n'),
        'utf8',
      );
      prUrl = execSync(
        `gh pr create --repo BrightforestX/assistant-ui --base ${BASE_BRANCH} --head ${branch} --title "formal: expand web verify happy-path stack" --body-file ${JSON.stringify(bodyFile)}`,
        { encoding: 'utf8', cwd: ROOT },
      ).trim();
    } catch (e) {
      log('pr create failed', e instanceof Error ? e.message : e);
    }
  }

  const ev = evidence(
    'run',
    [
      `# Expand web formal — Daytona`,
      '',
      `- sandbox: \`${sandbox.id}\``,
      `- synced: ${synced}`,
      `- branch: \`${branch}\``,
      `- pr: ${prUrl || '(none)'}`,
      '',
      '## verify stdout',
      '```',
      verify.stdout.slice(-4000),
      '```',
      '',
      '## push stdout',
      '```',
      push.stdout.slice(-2000),
      '```',
    ].join('\n'),
  );

  console.log(
    JSON.stringify(
      {
        ok: synced && verify.ok,
        sandboxId: sandbox.id,
        branch,
        prUrl,
        evidence: ev,
      },
      null,
      2,
    ),
  );

  releaseDaytonaClient();
}

main().catch((err) => {
  console.error(err);
  releaseDaytonaClient();
  process.exit(1);
});
