/**
 * Persist formal validation I/O (SHACL / Lean / GraphQL / Guardrails) to host SurrealDB.
 * Also mirrors JSONL under .px/session for sandbox UI when Surreal is unreachable.
 *
 * Surreal stays on the host (:8000). Sandbox does not run Surreal.
 */
import fs from 'fs';
import path from 'path';
import crypto from 'node:crypto';
import {
  surrealQuery,
  isSurrealDbConfigured,
  getSurrealDbTarget,
} from '../event-logger.js';
import {
  buildOntologyOverlay,
  emptyOverlay,
  type OntologyOverlay,
  type OverlayGraphEdge,
  type OverlayGraphNode,
} from './ontology-overlay.js';

export type ValidationLayer = 'shacl' | 'lean' | 'graphql' | 'guardrails' | 'cascade' | 'rules';

export interface EndpointIoRecord {
  io_id: string;
  call_id: string;
  layer: ValidationLayer | string;
  phase?: string;
  ok: boolean;
  engine?: string;
  duration_ms?: number;
  /** Request body / payload to the layer */
  request?: unknown;
  /** Layer response / raw result */
  response?: unknown;
  violations?: unknown[];
  at: string;
}

export interface ValidationCallRecord {
  call_id: string;
  at: string;
  tool: string;
  phase: string;
  pack: string;
  className?: string;
  ok: boolean;
  layers: string[];
  sandbox_id?: string | null;
  provider?: string | null;
  /** Full tool input (payload) */
  input?: unknown;
  /** Full tool/cascade output summary */
  output?: unknown;
  violations?: unknown[];
  linkml_reasoning?: {
    classesUsed?: string[];
    resolversUsed?: string[];
    mutationsReferenced?: string[];
    relationshipsUsed?: string[];
    narrative?: string;
  };
  endpoint_ios?: EndpointIoRecord[];
  duration_ms?: number;
  source: 'tool_io_guard' | 'px_validate_cascade' | 'manual' | string;
}

function ensureSurrealUrl(): void {
  if (!process.env.SURREALDB_URL) {
    process.env.SURREALDB_URL = 'http://127.0.0.1:8000';
  }
  if (!process.env.SURREALDB_NS) process.env.SURREALDB_NS = 'main';
  if (!process.env.SURREALDB_DB) process.env.SURREALDB_DB = 'main';
  if (!process.env.SURREALDB_USER) process.env.SURREALDB_USER = 'root';
  if (!process.env.SURREALDB_PASS) process.env.SURREALDB_PASS = 'root';
}

function sessionDir(): string {
  const root =
    process.env.GROK_PROJECT_DIR ||
    process.env.CLOUD_AGENT_ROOT ||
    process.cwd();
  return path.join(root, '.px/session');
}

function appendJsonl(name: string, obj: unknown): void {
  try {
    const dir = sessionDir();
    fs.mkdirSync(dir, { recursive: true });
    fs.appendFileSync(path.join(dir, name), `${JSON.stringify(obj)}\n`);
  } catch {
    /* best-effort */
  }
}

export async function ensureValidationIoTables(): Promise<void> {
  ensureSurrealUrl();
  if (!isSurrealDbConfigured()) return;
  try {
    await surrealQuery('DEFINE TABLE IF NOT EXISTS validation_call SCHEMALESS');
    await surrealQuery('DEFINE TABLE IF NOT EXISTS endpoint_io SCHEMALESS');
    await surrealQuery(
      'DEFINE INDEX IF NOT EXISTS idx_validation_call_at ON validation_call FIELDS at',
    );
    await surrealQuery(
      'DEFINE INDEX IF NOT EXISTS idx_endpoint_io_call ON endpoint_io FIELDS call_id',
    );
  } catch {
    /* DEFINE may fail on older Surreal — CREATE still works SCHEMALESS */
  }
}

function truncate(value: unknown, max = 48_000): unknown {
  try {
    const s = JSON.stringify(value);
    if (s.length <= max) return value;
    return {
      _truncated: true,
      preview: s.slice(0, max),
      originalBytes: s.length,
    };
  } catch {
    return { _unserializable: true };
  }
}

/**
 * Record one validation call + per-layer endpoint I/O to Surreal (+ JSONL mirror).
 */
export async function recordValidationCall(
  partial: Omit<ValidationCallRecord, 'call_id' | 'at' | 'source'> & {
    call_id?: string;
    at?: string;
    source?: string;
    endpoint_ios?: Array<Omit<EndpointIoRecord, 'io_id' | 'call_id' | 'at'> & { at?: string }>;
  },
): Promise<{ call_id: string; surreal: boolean; error?: string }> {
  ensureSurrealUrl();
  const call_id =
    partial.call_id ||
    `vcall-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const at = partial.at || new Date().toISOString();

  const endpoint_ios: EndpointIoRecord[] = (partial.endpoint_ios || []).map(
    (e, i) => ({
      io_id: `eio-${Date.now()}-${i}-${crypto.randomBytes(2).toString('hex')}`,
      call_id,
      layer: e.layer,
      phase: e.phase,
      ok: e.ok,
      engine: e.engine,
      duration_ms: e.duration_ms,
      request: truncate(e.request),
      response: truncate(e.response),
      violations: e.violations as unknown[] | undefined,
      at: e.at || at,
    }),
  );

  const record: ValidationCallRecord = {
    call_id,
    at,
    tool: partial.tool,
    phase: partial.phase,
    pack: partial.pack,
    className: partial.className,
    ok: partial.ok,
    layers: partial.layers || [],
    sandbox_id: partial.sandbox_id,
    provider: partial.provider,
    input: truncate(partial.input),
    output: truncate(partial.output),
    violations: partial.violations,
    linkml_reasoning: partial.linkml_reasoning,
    endpoint_ios,
    duration_ms: partial.duration_ms,
    source: partial.source || 'tool_io_guard',
  };

  appendJsonl('validation-calls.jsonl', record);
  for (const eio of endpoint_ios) {
    appendJsonl('endpoint-io.jsonl', eio);
  }
  try {
    fs.writeFileSync(
      path.join(sessionDir(), 'last-validation-call.json'),
      JSON.stringify(record, null, 2),
    );
  } catch {
    /* */
  }

  let surreal = false;
  let error: string | undefined;
  try {
    if (isSurrealDbConfigured() || process.env.SURREALDB_URL) {
      await ensureValidationIoTables();
      const { endpoint_ios: _e, ...callBody } = record;
      await surrealQuery(
        `CREATE validation_call CONTENT ${JSON.stringify({
          ...callBody,
          endpoint_io_count: endpoint_ios.length,
        })}`,
      );
      for (const eio of endpoint_ios) {
        await surrealQuery(`CREATE endpoint_io CONTENT ${JSON.stringify(eio)}`);
      }
      surreal = true;
    }
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    surreal = false;
  }

  // Best-effort: refresh Surreal-backed node/edge overlay for ontology UI
  try {
    await refreshOntologyOverlay({ limit: 100 });
  } catch {
    /* non-fatal */
  }

  return { call_id, surreal, error };
}

/** Load reactFlow graph from session / generated ontology-state if present. */
function loadGraphFromSession(): {
  nodes: OverlayGraphNode[];
  edges: OverlayGraphEdge[];
} {
  const candidates = [
    path.join(sessionDir(), 'ontology-state.json'),
    path.join(
      process.env.GROK_PROJECT_DIR || process.env.CLOUD_AGENT_ROOT || process.cwd(),
      '.px/generated/ontology-state.json',
    ),
    path.join(process.cwd(), '.px/generated/ontology-state.json'),
  ];
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue;
      const j = JSON.parse(fs.readFileSync(p, 'utf8')) as {
        reactFlow?: { nodes?: OverlayGraphNode[]; edges?: OverlayGraphEdge[] };
        nodes?: OverlayGraphNode[];
        edges?: OverlayGraphEdge[];
      };
      const nodes = j.reactFlow?.nodes || j.nodes || [];
      const edges = j.reactFlow?.edges || j.edges || [];
      if (nodes.length) return { nodes, edges };
    } catch {
      /* */
    }
  }
  return { nodes: [], edges: [] };
}

/**
 * Build ontology-overlay.json from recent validation_call rows (+ optional Surreal snapshot).
 */
export async function refreshOntologyOverlay(opts?: {
  limit?: number;
  graph?: { nodes: OverlayGraphNode[]; edges: OverlayGraphEdge[] };
}): Promise<OntologyOverlay> {
  ensureSurrealUrl();
  const q = await queryValidationCalls({ limit: opts?.limit ?? 100 });
  const graph = opts?.graph || loadGraphFromSession();
  // If no graph, still index by class names from calls as synthetic nodes
  let nodes = graph.nodes;
  let edges = graph.edges;
  if (!nodes.length && q.entries.length) {
    const ids = new Set<string>();
    for (const c of q.entries) {
      if (c.className) ids.add(`class-${c.className}`);
      for (const u of c.linkml_reasoning?.classesUsed || []) ids.add(`class-${u}`);
    }
    nodes = [...ids].map((id) => ({
      id,
      data: {
        label: id.replace(/^class-/, ''),
        kind: 'class',
      },
    }));
  }

  const overlay = buildOntologyOverlay({
    nodes,
    edges,
    calls: q.entries,
    source: q.source === 'empty' ? 'empty' : q.source === 'surreal' ? 'surreal' : 'jsonl',
  });

  try {
    fs.mkdirSync(sessionDir(), { recursive: true });
    fs.writeFileSync(
      path.join(sessionDir(), 'ontology-overlay.json'),
      JSON.stringify(overlay, null, 2),
    );
  } catch {
    /* */
  }

  try {
    if (isSurrealDbConfigured() || process.env.SURREALDB_URL) {
      await surrealQuery('DEFINE TABLE IF NOT EXISTS ontology_overlay SCHEMALESS');
      await surrealQuery(
        `CREATE ontology_overlay CONTENT ${JSON.stringify({
          kind: 'snapshot',
          generatedAt: overlay.generatedAt,
          source: overlay.source,
          summary: overlay.summary,
          nodeCount: Object.keys(overlay.nodes).length,
          edgeCount: Object.keys(overlay.edges).length,
          // store compact maps (status + color only) to bound size
          nodes: Object.fromEntries(
            Object.entries(overlay.nodes).map(([k, v]) => [
              k,
              {
                status: v.status,
                color: v.color,
                lastAt: v.lastAt,
                failCount: v.failCount,
                passCount: v.passCount,
              },
            ]),
          ),
          edges: Object.fromEntries(
            Object.entries(overlay.edges).map(([k, v]) => [
              k,
              {
                status: v.status,
                color: v.color,
                lastAt: v.lastAt,
              },
            ]),
          ),
        })}`,
      );
    }
  } catch {
    /* optional Surreal snapshot */
  }

  return overlay;
}

export function readOntologyOverlayFile(): OntologyOverlay {
  try {
    const p = path.join(sessionDir(), 'ontology-overlay.json');
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8')) as OntologyOverlay;
    }
  } catch {
    /* */
  }
  return emptyOverlay('empty');
}

/** Build endpoint_io rows from cascade.layers */
export function endpointIosFromCascade(
  cascade: {
    layers?: Record<
      string,
      {
        ok?: boolean;
        engine?: string;
        durationMs?: number;
        raw?: unknown;
        violations?: unknown[];
      }
    >;
  } | null | undefined,
  input: unknown,
  phase?: string,
): Array<Omit<EndpointIoRecord, 'io_id' | 'call_id' | 'at'>> {
  const out: Array<Omit<EndpointIoRecord, 'io_id' | 'call_id' | 'at'>> = [];
  if (!cascade?.layers) return out;
  for (const [layer, L] of Object.entries(cascade.layers)) {
    if (!L) continue;
    out.push({
      layer,
      phase,
      ok: L.ok !== false,
      engine: L.engine,
      duration_ms: L.durationMs,
      request: input,
      response: L.raw ?? { ok: L.ok, engine: L.engine },
      violations: L.violations as unknown[] | undefined,
    });
  }
  return out;
}

export async function queryValidationCalls(opts?: {
  limit?: number;
  pack?: string;
  tool?: string;
  ok?: boolean;
}): Promise<{
  ok: boolean;
  surreal: boolean;
  target: ReturnType<typeof getSurrealDbTarget>;
  entries: ValidationCallRecord[];
  count: number;
  source: 'surreal' | 'jsonl' | 'empty';
  error?: string;
}> {
  ensureSurrealUrl();
  const limit = Math.max(1, Math.min(opts?.limit ?? 40, 200));
  const target = getSurrealDbTarget();

  // Prefer Surreal
  try {
    if (isSurrealDbConfigured() || process.env.SURREALDB_URL) {
      const filters: string[] = [];
      if (opts?.pack) {
        filters.push(`pack = '${String(opts.pack).replace(/'/g, "\\'")}'`);
      }
      if (opts?.tool) {
        filters.push(`tool = '${String(opts.tool).replace(/'/g, "\\'")}'`);
      }
      if (opts?.ok === true) filters.push('ok = true');
      if (opts?.ok === false) filters.push('ok = false');
      const where = filters.length ? `WHERE ${filters.join(' AND ')} ` : '';
      const [r] = await surrealQuery(
        `SELECT * FROM validation_call ${where}ORDER BY at DESC LIMIT ${limit}`,
      );
      // Surreal 2 may reject ORDER BY at in some builds — fallback unordered
      const entries = (r?.result || []) as ValidationCallRecord[];
      if (entries.length || !fs.existsSync(path.join(sessionDir(), 'validation-calls.jsonl'))) {
        return {
          ok: true,
          surreal: true,
          target,
          entries,
          count: entries.length,
          source: 'surreal',
        };
      }
    }
  } catch (e) {
    // fall through to jsonl
    const error = e instanceof Error ? e.message : String(e);
    const jsonl = readValidationCallsJsonl(limit, opts);
    return {
      ok: true,
      surreal: false,
      target,
      entries: jsonl,
      count: jsonl.length,
      source: jsonl.length ? 'jsonl' : 'empty',
      error,
    };
  }

  const jsonl = readValidationCallsJsonl(limit, opts);
  return {
    ok: true,
    surreal: false,
    target,
    entries: jsonl,
    count: jsonl.length,
    source: jsonl.length ? 'jsonl' : 'empty',
  };
}

function readValidationCallsJsonl(
  limit: number,
  opts?: { pack?: string; tool?: string; ok?: boolean },
): ValidationCallRecord[] {
  const p = path.join(sessionDir(), 'validation-calls.jsonl');
  if (!fs.existsSync(p)) return [];
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  let entries: ValidationCallRecord[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as ValidationCallRecord);
    } catch {
      /* skip */
    }
  }
  if (opts?.pack) {
    const want = opts.pack.toLowerCase();
    entries = entries.filter((e) => (e.pack || '').toLowerCase() === want);
  }
  if (opts?.tool) {
    entries = entries.filter((e) => e.tool === opts.tool);
  }
  if (opts?.ok === true) entries = entries.filter((e) => e.ok);
  if (opts?.ok === false) entries = entries.filter((e) => !e.ok);
  return entries.slice(-limit).reverse();
}

export async function queryEndpointIo(opts?: {
  call_id?: string;
  layer?: string;
  limit?: number;
}): Promise<{ ok: boolean; entries: EndpointIoRecord[]; source: string }> {
  ensureSurrealUrl();
  const limit = Math.max(1, Math.min(opts?.limit ?? 50, 200));
  try {
    if (isSurrealDbConfigured() || process.env.SURREALDB_URL) {
      const filters: string[] = [];
      if (opts?.call_id) {
        filters.push(`call_id = '${String(opts.call_id).replace(/'/g, "\\'")}'`);
      }
      if (opts?.layer) {
        filters.push(`layer = '${String(opts.layer).replace(/'/g, "\\'")}'`);
      }
      const where = filters.length ? `WHERE ${filters.join(' AND ')} ` : '';
      const [r] = await surrealQuery(
        `SELECT * FROM endpoint_io ${where}ORDER BY at DESC LIMIT ${limit}`,
      );
      return {
        ok: true,
        entries: (r?.result || []) as EndpointIoRecord[],
        source: 'surreal',
      };
    }
  } catch {
    /* jsonl */
  }
  const p = path.join(sessionDir(), 'endpoint-io.jsonl');
  if (!fs.existsSync(p)) return { ok: true, entries: [], source: 'empty' };
  let entries: EndpointIoRecord[] = [];
  for (const line of fs.readFileSync(p, 'utf8').split('\n').filter(Boolean)) {
    try {
      entries.push(JSON.parse(line) as EndpointIoRecord);
    } catch {
      /* */
    }
  }
  if (opts?.call_id) entries = entries.filter((e) => e.call_id === opts.call_id);
  if (opts?.layer) entries = entries.filter((e) => e.layer === opts.layer);
  return {
    ok: true,
    entries: entries.slice(-limit).reverse(),
    source: 'jsonl',
  };
}
