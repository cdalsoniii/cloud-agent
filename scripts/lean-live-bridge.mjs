#!/usr/bin/env node
/**
 * lean-live-bridge — NDJSON event log + HTTP/SSE for Lean build diagnostics.
 * Endpoints: GET /health, GET /state, GET /events (SSE)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const RUNTIME_DIR = process.env.LEAN_LIVE_RUNTIME_DIR
  ?? path.join(REPO_ROOT, '.px', 'lean-live');
const EVENTS_FILE = path.join(RUNTIME_DIR, 'events.ndjson');
const STATE_FILE = path.join(RUNTIME_DIR, 'state.json');
const PID_FILE = path.join(RUNTIME_DIR, 'bridge.pid');
const PORT = Number(process.env.LEAN_LIVE_PORT ?? 9474);
const DEBOUNCE_MS = Number(process.env.LEAN_LIVE_DEBOUNCE_MS ?? 800);

const BUNDLE_ROOT = process.env.PX_GROK_BUNDLE ?? path.join(REPO_ROOT, '.grok-bundle');
const LAKE_BIN = path.join(BUNDLE_ROOT, 'bin', 'lake');

let workspace = process.env.LEAN_WORKSPACE ?? '';
let buildTimer = null;
let building = false;
const sseClients = new Set();

function ensureRuntime() {
  fs.mkdirSync(RUNTIME_DIR, { recursive: true });
  if (!fs.existsSync(EVENTS_FILE)) {
    fs.writeFileSync(EVENTS_FILE, '');
  }
}

function resolveWorkspace() {
  if (workspace) return workspace;
  const script = path.join(REPO_ROOT, 'scripts', 'lib', 'resolve-lean-workspace.sh');
  const out = spawn('bash', [script], { stdio: ['ignore', 'pipe', 'pipe'] });
  return new Promise((resolve, reject) => {
    let buf = '';
    out.stdout.on('data', (c) => { buf += c; });
    out.stderr.on('data', (c) => { process.stderr.write(c); });
    out.on('close', (code) => {
      if (code !== 0) reject(new Error('resolve-lean-workspace failed'));
      else resolve(buf.trim());
    });
  });
}

function appendEvent(type, payload) {
  const event = {
    ts: new Date().toISOString(),
    type,
    ...payload,
  };
  fs.appendFileSync(EVENTS_FILE, `${JSON.stringify(event)}\n`);
  const line = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of sseClients) {
    res.write(line);
  }
  return event;
}

function writeState(patch) {
  let current = {};
  if (fs.existsSync(STATE_FILE)) {
    try {
      current = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
      current = {};
    }
  }
  const next = {
    ...current,
    ...patch,
    updatedAt: new Date().toISOString(),
    workspace,
    port: PORT,
  };
  fs.writeFileSync(STATE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

function parseDiagnostics(output) {
  const diagnostics = [];
  const goalLines = [];
  for (const line of output.split('\n')) {
    const diag = line.match(/^(.*):(\d+):(\d+):\s*(error|warning):\s*(.+)$/);
    if (diag) {
      diagnostics.push({
        file: diag[1],
        line: Number(diag[2]),
        column: Number(diag[3]),
        severity: diag[4],
        message: diag[5],
      });
      continue;
    }
    if (line.includes('⊢') || line.toLowerCase().includes('unsolved goals')) {
      goalLines.push(line.trim());
    }
  }
  return { diagnostics, goals: goalLines };
}

function runBuild(reason = 'manual') {
  if (building) return;
  building = true;
  appendEvent('build_start', { reason });
  writeState({ status: 'building', lastReason: reason });

  const child = spawn(LAKE_BIN, ['build'], {
    cwd: workspace,
    env: { ...process.env, PATH: `${path.join(BUNDLE_ROOT, 'bin')}:${process.env.PATH ?? ''}` },
  });

  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });

  child.on('close', (code) => {
    building = false;
    const combined = `${stdout}\n${stderr}`;
    const { diagnostics, goals } = parseDiagnostics(combined);
    const state = writeState({
      status: code === 0 ? 'ok' : 'error',
      exitCode: code,
      diagnostics,
      goals,
      lastBuildAt: new Date().toISOString(),
      lastOutputTail: combined.split('\n').slice(-40).join('\n'),
    });
    appendEvent('build_complete', {
      exitCode: code,
      diagnosticCount: diagnostics.length,
      goalCount: goals.length,
    });
    if (code !== 0) {
      appendEvent('diagnostics', { diagnostics, goals });
    }
  });
}

function scheduleBuild(reason) {
  if (buildTimer) clearTimeout(buildTimer);
  buildTimer = setTimeout(() => runBuild(reason), DEBOUNCE_MS);
}

// Capture the Lean 4 reasoning trail for a module (the per-step rewrites /
// lemma applications that a pass/fail build hides).  Runs the sibling
// lean-trace.sh against the workspace and surfaces the trace lines.
function captureTrace(cb) {
  const traceScript = path.join(REPO_ROOT, 'scripts', 'lean-trace.sh');
  const child = spawn('bash', [traceScript, 'PxCloudAgent.Trace'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LEAN_WORKSPACE: workspace,
      PATH: `${path.join(BUNDLE_ROOT, 'bin')}:${process.env.PATH ?? ''}`,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('close', (code) => {
    const lines = (stdout + stderr).split('\n').filter((l) => l.trim().length > 0);
    writeState({
      reasoningTrail: {
        at: new Date().toISOString(),
        exitCode: code,
        stepCount: lines.length,
        steps: lines,
      },
    });
    appendEvent('trace_capture', {
      exitCode: code,
      stepCount: lines.length,
    });
    cb ? cb({ exitCode: code, lines }) : null;
  });
}

// Capture the Lean 4 per-tactic goal tree for a module (the goals + hypotheses
// before and after every tactic, extracted from the module's InfoTree).  Runs the
// sibling lean-tree.sh against the workspace and stores the structured nodes.
function captureTree(cb) {
  const treeScript = path.join(REPO_ROOT, 'scripts', 'lean-tree.sh');
  const child = spawn('bash', [treeScript, 'PxCloudAgent.Trace'], {
    cwd: REPO_ROOT,
    env: {
      ...process.env,
      LEAN_WORKSPACE: workspace,
      PATH: `${path.join(BUNDLE_ROOT, 'bin')}:${process.env.PATH ?? ''}`,
    },
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (c) => { stdout += c; });
  child.stderr.on('data', (c) => { stderr += c; });
  child.on('close', (code) => {
    let tree = { ok: false, error: `tree script exited ${code}` };
    const start = stdout.indexOf('{');
    if (start >= 0) {
      try {
        tree = JSON.parse(stdout.slice(start));
      } catch {
        tree = { ok: false, error: 'could not parse tree JSON' };
      }
    }
    writeState({ goalTree: { at: new Date().toISOString(), ...tree } });
    appendEvent('tree_capture', {
      exitCode: code,
      ok: !!tree.ok,
      nodeCount: Array.isArray(tree.nodes) ? tree.nodes.length : 0,
    });
    cb ? cb({ exitCode: code, tree }) : null;
  });
}

function watchWorkspace() {
  if (!workspace || !fs.existsSync(workspace)) return;
  let pending = false;
  fs.watch(workspace, { recursive: true }, (_event, filename) => {
    if (!filename || !String(filename).endsWith('.lean')) return;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; }, 200);
    appendEvent('file_change', { file: String(filename) });
    scheduleBuild(`save:${filename}`);
  });
}

function handleRequest(req, res) {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`);
  if (req.method === 'GET' && url.pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, workspace, building }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/state') {
    const body = fs.existsSync(STATE_FILE)
      ? fs.readFileSync(STATE_FILE, 'utf8')
      : JSON.stringify({ status: 'idle', workspace });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(body);
    return;
  }
  if (req.method === 'POST' && url.pathname === '/rebuild') {
    scheduleBuild('http');
    res.writeHead(202, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ accepted: true }));
    return;
  }
  if (req.method === 'GET' && url.pathname === '/trace') {
    captureTrace(({ exitCode, lines }) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ exitCode, stepCount: lines.length, steps: lines }));
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/tree') {
    captureTree(({ exitCode, tree }) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tree, null, 2));
    });
    return;
  }
  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }
  res.writeHead(404);
  res.end('not found');
}

async function main() {
  ensureRuntime();
  workspace = await resolveWorkspace();
  fs.writeFileSync(PID_FILE, `${process.pid}\n`);

  watchWorkspace();
  writeState({ status: 'idle', workspace });
  appendEvent('bridge_start', { workspace, port: PORT });

  const server = http.createServer(handleRequest);
  server.listen(PORT, '127.0.0.1', () => {
    console.log(`lean-live-bridge listening on http://127.0.0.1:${PORT} (workspace ${workspace})`);
  });

  const shutdown = () => {
    try { fs.unlinkSync(PID_FILE); } catch { /* ignore */ }
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
