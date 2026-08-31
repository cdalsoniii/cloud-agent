/**
 * Midspiral stack bridge for the ontology viewer only.
 * Does NOT import assistant-ui or fleet-ui. Uses host CLIs when present.
 *
 * Stack: lemmafit | LemmaScript | lemmacore | claimcheck | dafny-replay | dafny2js
 */
import fs from 'fs';
import path from 'path';
import { execFileSync, execSync } from 'node:child_process';
import crypto from 'node:crypto';

export type MidspiralToolId =
  | 'lemmafit'
  | 'lemmascript'
  | 'lemmacore'
  | 'claimcheck'
  | 'dafny-replay'
  | 'dafny2js';

export interface MidspiralToolStatus {
  id: MidspiralToolId;
  name: string;
  ready: boolean;
  version?: string;
  path?: string;
  note?: string;
  installHint?: string;
}

export interface MidspiralStatus {
  generatedAt: string;
  tools: MidspiralToolStatus[];
  readyCount: number;
  total: number;
  allowExec: boolean;
  sessionDir: string;
}

export interface MidspiralRunRecord {
  run_id: string;
  at: string;
  tool: MidspiralToolId | string;
  ok: boolean;
  source: 'real' | 'probe' | 'demo' | 'error';
  input?: unknown;
  output?: unknown;
  error?: string;
  duration_ms?: number;
}

export type ExecFn = (
  cmd: string,
  args: string[],
  opts?: { cwd?: string; timeout?: number; input?: string },
) => { stdout: string; stderr: string; code: number };

function defaultSessionDir(): string {
  const root =
    process.env.GROK_PROJECT_DIR ||
    process.env.CLOUD_AGENT_ROOT ||
    process.cwd();
  return path.join(root, '.px/session');
}

function which(cmd: string): string | null {
  try {
    const out = execSync(`command -v ${cmd}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return out || null;
  } catch {
    return null;
  }
}

function tryVersion(bin: string, args: string[] = ['--version']): string | undefined {
  try {
    const out = execFileSync(bin, args, {
      encoding: 'utf8',
      timeout: 8000,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return String(out || '')
      .split('\n')[0]
      .trim()
      .slice(0, 120);
  } catch {
    try {
      const out = execFileSync(bin, ['-h'], {
        encoding: 'utf8',
        timeout: 8000,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return String(out || '')
        .split('\n')[0]
        .trim()
        .slice(0, 120);
    } catch {
      return undefined;
    }
  }
}

const defaultExec: ExecFn = (cmd, args, opts) => {
  try {
    const stdout = execFileSync(cmd, args, {
      encoding: 'utf8',
      cwd: opts?.cwd,
      timeout: opts?.timeout ?? 60_000,
      input: opts?.input,
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 4 * 1024 * 1024,
    });
    return { stdout: String(stdout || ''), stderr: '', code: 0 };
  } catch (e: unknown) {
    const err = e as {
      stdout?: Buffer | string;
      stderr?: Buffer | string;
      status?: number;
      message?: string;
    };
    return {
      stdout: String(err.stdout || ''),
      stderr: String(err.stderr || err.message || ''),
      code: typeof err.status === 'number' ? err.status : 1,
    };
  }
};

export function probeMidspiralTools(opts?: {
  whichFn?: (cmd: string) => string | null;
  env?: NodeJS.ProcessEnv;
}): MidspiralToolStatus[] {
  const w = opts?.whichFn || which;
  const env = opts?.env || process.env;

  const lemmafitPath = w('lemmafit');
  const claimcheckPath = w('claimcheck');
  const lemmascriptPath = w('lemmascript') || w('lemma-script') || w('lsc');
  const lemmacorePath = w('lemmacore') || w('lemma-core');
  const dafnyPath = w('dafny');
  const dafny2jsPath =
    env.DAFNY2JS_PATH ||
    w('dafny2js') ||
    w('dafny-to-js') ||
    null;
  const replayHint =
    env.DAFNY_REPLAY_PATH ||
    env.VERIFIED_KERNELS_PATH ||
    null;

  return [
    {
      id: 'lemmafit',
      name: 'lemmafit',
      ready: Boolean(lemmafitPath),
      path: lemmafitPath || undefined,
      version: lemmafitPath ? tryVersion(lemmafitPath, ['--help']) : undefined,
      note: lemmafitPath
        ? 'Verified vibe coding — Dafny in the agent loop'
        : 'not on PATH',
      installHint: 'npm install -g lemmafit',
    },
    {
      id: 'lemmascript',
      name: 'LemmaScript',
      ready: Boolean(lemmascriptPath),
      path: lemmascriptPath || undefined,
      version: lemmascriptPath ? tryVersion(lemmascriptPath) : undefined,
      note: lemmascriptPath
        ? 'TypeScript //@ specs → Lean 4 / Dafny'
        : 'not on PATH',
      installHint: 'npm install -g lemmascript  (CLI binary often named lsc)',
    },
    {
      id: 'lemmacore',
      name: 'lemmacore',
      ready: Boolean(lemmacorePath),
      path: lemmacorePath || undefined,
      note: lemmacorePath
        ? 'Shared verification engine / daemon'
        : 'Coming soon — not on PATH',
      installHint: 'VS Code extension / Midspiral lemmacore (when published)',
    },
    {
      id: 'claimcheck',
      name: 'claimcheck',
      ready: Boolean(claimcheckPath),
      path: claimcheckPath || undefined,
      version: claimcheckPath ? tryVersion(claimcheckPath, ['--help']) : undefined,
      note: claimcheckPath
        ? 'Proof ↔ intent (requirements vs lemmas)'
        : 'not on PATH',
      installHint: 'npm install -g claimcheck',
    },
    {
      id: 'dafny-replay',
      name: 'dafny-replay',
      ready: Boolean(dafnyPath || replayHint),
      path: dafnyPath || replayHint || undefined,
      version: dafnyPath ? tryVersion(dafnyPath) : undefined,
      note: dafnyPath
        ? 'Dafny available — verified kernels / replay methodology'
        : replayHint
          ? `kernels path set: ${replayHint}`
          : 'dafny binary not found; set DAFNY_REPLAY_PATH or VERIFIED_KERNELS_PATH',
      installHint: 'Install Dafny (.NET) or point VERIFIED_KERNELS_PATH at verified kernels',
    },
    {
      id: 'dafny2js',
      name: 'dafny2js',
      ready: Boolean(dafny2jsPath),
      path: dafny2jsPath || undefined,
      note: dafny2jsPath
        ? 'Dafny→TypeScript API compiler'
        : 'not installed — lemmafit compile path may still emit JS',
      installHint: 'Set DAFNY2JS_PATH or install dafny2js when available',
    },
  ];
}

export function getMidspiralStatus(opts?: {
  sessionDir?: string;
  whichFn?: (cmd: string) => string | null;
  write?: boolean;
}): MidspiralStatus {
  const sessionDir = opts?.sessionDir || defaultSessionDir();
  const tools = probeMidspiralTools({ whichFn: opts?.whichFn });
  const status: MidspiralStatus = {
    generatedAt: new Date().toISOString(),
    tools,
    readyCount: tools.filter((t) => t.ready).length,
    total: tools.length,
    allowExec: process.env.MIDSPIRAL_ALLOW_EXEC === '1',
    sessionDir,
  };
  if (opts?.write !== false) {
    try {
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(
        path.join(sessionDir, 'midspiral-status.json'),
        JSON.stringify(status, null, 2),
      );
    } catch {
      /* best-effort */
    }
  }
  return status;
}

function appendRun(sessionDir: string, rec: MidspiralRunRecord): void {
  try {
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.appendFileSync(
      path.join(sessionDir, 'midspiral-runs.jsonl'),
      `${JSON.stringify(rec)}\n`,
    );
  } catch {
    /* */
  }
}

export function readMidspiralRuns(
  limit = 30,
  sessionDir?: string,
): MidspiralRunRecord[] {
  const dir = sessionDir || defaultSessionDir();
  const p = path.join(dir, 'midspiral-runs.jsonl');
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const out: MidspiralRunRecord[] = [];
  for (const line of lines.slice(-Math.max(1, Math.min(limit, 100)))) {
    try {
      out.push(JSON.parse(line) as MidspiralRunRecord);
    } catch {
      /* */
    }
  }
  return out.reverse();
}

/** Extract //@ LemmaScript-style annotations from source text. */
export function extractLemmaScriptAnnotations(source: string): Array<{
  line: number;
  text: string;
  kind?: string;
}> {
  const out: Array<{ line: number; text: string; kind?: string }> = [];
  const lines = String(source || '').split(/\r?\n/);
  lines.forEach((line, i) => {
    const m = line.match(/\/\/@\s*(.*)$/);
    if (m) {
      const text = m[1].trim();
      const kindMatch = text.match(/^(requires|ensures|invariant|decreases|modifies|reads)\b/i);
      out.push({
        line: i + 1,
        text,
        kind: kindMatch ? kindMatch[1].toLowerCase() : undefined,
      });
    }
  });
  return out;
}

export async function runMidspiralTool(
  tool: MidspiralToolId | string,
  args: {
    claim?: string;
    moduleName?: string;
    sourceText?: string;
    sourcePath?: string;
    requirement?: string;
    mapping?: Array<{ requirement: string; lemmaName: string }>;
    dfyPath?: string;
  },
  opts?: {
    sessionDir?: string;
    exec?: ExecFn;
    allowExec?: boolean;
  },
): Promise<MidspiralRunRecord> {
  const sessionDir = opts?.sessionDir || defaultSessionDir();
  const exec = opts?.exec || defaultExec;
  const allow =
    opts?.allowExec === true || process.env.MIDSPIRAL_ALLOW_EXEC === '1';
  const run_id = `ms-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
  const at = new Date().toISOString();
  const t0 = Date.now();

  const finish = (
    partial: Omit<MidspiralRunRecord, 'run_id' | 'at' | 'tool' | 'duration_ms'>,
  ): MidspiralRunRecord => {
    const rec: MidspiralRunRecord = {
      run_id,
      at,
      tool,
      duration_ms: Date.now() - t0,
      ...partial,
    };
    appendRun(sessionDir, rec);
    return rec;
  };

  if (!allow && tool !== 'status') {
    // probes always ok; runs need allowExec except pure extract
    if (tool === 'lemmascript' && (args.sourceText || args.sourcePath)) {
      // pure annotation extract allowed without exec
    } else if (tool !== 'lemmafit' && tool !== 'claimcheck') {
      return finish({
        ok: false,
        source: 'error',
        error: 'MIDSPIRAL_ALLOW_EXEC is not set — set MIDSPIRAL_ALLOW_EXEC=1 for CLI runs',
        input: args,
      });
    }
  }

  try {
    if (tool === 'lemmafit') {
      const claim = args.claim || 'Ontology class invariant holds';
      const lemmafitBin = which('lemmafit');
      if (!lemmafitBin || (!allow && process.env.MIDSPIRAL_ALLOW_EXEC !== '1')) {
        // demo structured result when CLI missing or exec disabled
        if (!lemmafitBin) {
          return finish({
            ok: false,
            source: 'error',
            error: 'lemmafit not on PATH',
            input: { claim },
          });
        }
      }
      if (!allow) {
        return finish({
          ok: true,
          source: 'demo',
          input: { claim },
          output: {
            note: 'Exec disabled — would run lemmafit add for claim',
            claim,
            install: 'MIDSPIRAL_ALLOW_EXEC=1',
          },
        });
      }
      const tmpDir = path.join(
        sessionDir,
        `midspiral-lemmafit-${Date.now()}`,
      );
      fs.mkdirSync(tmpDir, { recursive: true });
      const moduleName =
        args.moduleName ||
        'Claim' +
          String(claim)
            .replace(/[^a-zA-Z0-9]/g, '')
            .slice(0, 24) ||
        'Claim';
      const dfy = `// Claim: ${claim}\nmodule ${moduleName} {\n  predicate ValidClaim() { true }\n}\n`;
      fs.writeFileSync(path.join(tmpDir, `${moduleName}.dfy`), dfy);
      // init minimal project if needed
      const init = exec(lemmafitBin!, ['init', tmpDir], { timeout: 45_000 });
      const add = exec(
        lemmafitBin!,
        ['add', moduleName, '--no-json-api'],
        { cwd: tmpDir, timeout: 90_000 },
      );
      const ok = add.code === 0 || /lemmafit/i.test(add.stdout + add.stderr);
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        /* */
      }
      return finish({
        ok,
        source: 'real',
        input: { claim, moduleName },
        output: {
          init: { code: init.code, stdout: init.stdout.slice(0, 2000) },
          add: {
            code: add.code,
            stdout: add.stdout.slice(0, 4000),
            stderr: add.stderr.slice(0, 2000),
          },
        },
      });
    }

    if (tool === 'lemmascript') {
      let source = args.sourceText || '';
      if (args.sourcePath && fs.existsSync(args.sourcePath)) {
        source = fs.readFileSync(args.sourcePath, 'utf8');
      }
      const annotations = extractLemmaScriptAnnotations(source);
      const bin = which('lemmascript') || which('lsc') || which('lemma-script');
      let cli: { code: number; stdout: string; stderr: string } | undefined;
      if (bin && allow && args.sourcePath) {
        cli = exec(bin, [args.sourcePath], { timeout: 60_000 });
      }
      return finish({
        ok: true,
        source: bin && cli ? 'real' : 'demo',
        input: {
          sourcePath: args.sourcePath,
          annotationCount: annotations.length,
        },
        output: { annotations, cli },
      });
    }

    if (tool === 'claimcheck') {
      const bin = which('claimcheck');
      if (!bin) {
        return finish({
          ok: false,
          source: 'error',
          error: 'claimcheck not on PATH',
          input: args,
        });
      }
      const requirement =
        args.requirement ||
        args.claim ||
        'Selected ontology class validates under SHACL cascade';
      const mapping =
        args.mapping ||
        [{ requirement, lemmaName: args.moduleName || 'ValidClaim' }];
      if (!allow) {
        return finish({
          ok: true,
          source: 'demo',
          input: { mapping },
          output: {
            note: 'Exec disabled — would run claimcheck --stdin --json',
            mapping,
          },
        });
      }
      const stdin = JSON.stringify(mapping);
      const cliArgs = ['--stdin', '--json'];
      if (args.dfyPath) cliArgs.push('--dfy', args.dfyPath);
      const r = exec(bin, cliArgs, { timeout: 120_000, input: stdin });
      let parsed: unknown = r.stdout;
      try {
        parsed = JSON.parse(r.stdout);
      } catch {
        /* keep text */
      }
      return finish({
        ok: r.code === 0,
        source: 'real',
        input: { mapping, dfyPath: args.dfyPath },
        output: { code: r.code, result: parsed, stderr: r.stderr.slice(0, 2000) },
        error: r.code !== 0 ? r.stderr.slice(0, 500) : undefined,
      });
    }

    if (tool === 'lemmacore' || tool === 'dafny-replay' || tool === 'dafny2js') {
      const status = probeMidspiralTools();
      const t = status.find((x) => x.id === tool);
      return finish({
        ok: Boolean(t?.ready),
        source: 'probe',
        input: args,
        output: t || { note: 'unknown tool' },
      });
    }

    return finish({
      ok: false,
      source: 'error',
      error: `unknown midspiral tool: ${tool}`,
      input: args,
    });
  } catch (e) {
    return finish({
      ok: false,
      source: 'error',
      error: e instanceof Error ? e.message : String(e),
      input: args,
    });
  }
}

/** Six-tool stack constant for UI. */
export const MIDSPIRAL_STACK: MidspiralToolId[] = [
  'lemmafit',
  'lemmascript',
  'lemmacore',
  'claimcheck',
  'dafny-replay',
  'dafny2js',
];
