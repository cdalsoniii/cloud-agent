/**
 * Multi-instance Guardrails AI / formal content-check server set.
 * No hard-coded maximum of 1 — operator may register N distinct servers.
 * Soft cap only via GUARDRAILS_MAX_SERVERS when set (>0); unset = unlimited.
 */

export type GuardrailsServerKind =
  | 'formal_sandbox'
  | 'guardrails_ai'
  | 'cascade_layer'
  | 'remote';

export type GuardrailsServerStatus =
  | 'active'
  | 'inactive'
  | 'unknown'
  | 'unreachable';

export interface GuardrailsServer {
  id: string;
  name: string;
  kind: GuardrailsServerKind;
  port?: number;
  url?: string;
  host?: string;
  status: GuardrailsServerStatus;
  inSandbox: boolean;
  note?: string;
  /** Optional process bind for multi-instance formal stubs */
  bind?: string;
}

export interface GuardrailsHealthResult {
  id: string;
  ok: boolean;
  status: GuardrailsServerStatus;
  port?: number;
  url?: string;
  note?: string;
  latencyMs?: number;
}

export const FORMAL_GUARDRAILS_PORT = 7003;
export const DEFAULT_GUARDRAILS_HOST = '127.0.0.1';

/** Parse soft max; undefined/0/NaN → unlimited (null). */
export function guardrailsMaxServers(
  env: NodeJS.ProcessEnv = process.env,
): number | null {
  const raw = env.GUARDRAILS_MAX_SERVERS;
  if (raw == null || raw === '' || raw === '0' || raw === 'unlimited') {
    return null;
  }
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.floor(n);
}

export function normalizeServerId(id: string): string {
  return String(id || '')
    .trim()
    .replace(/\s+/g, '.')
    .slice(0, 128);
}

export function makeGuardrailsServer(partial: {
  id: string;
  name?: string;
  kind?: GuardrailsServerKind;
  port?: number;
  url?: string;
  host?: string;
  status?: GuardrailsServerStatus;
  inSandbox?: boolean;
  note?: string;
  bind?: string;
}): GuardrailsServer {
  const id = normalizeServerId(partial.id);
  if (!id) {
    throw new Error('Guardrails server id is required');
  }
  const port = partial.port;
  const host = partial.host || DEFAULT_GUARDRAILS_HOST;
  const url =
    partial.url ||
    (port != null ? `http://${host}:${port}/health` : undefined);
  return {
    id,
    name: partial.name || id,
    kind: partial.kind || 'guardrails_ai',
    port,
    url,
    host,
    status: partial.status || 'unknown',
    inSandbox: partial.inSandbox ?? Boolean(port && port >= 7003 && port < 7100),
    note: partial.note,
    bind: partial.bind || (port != null ? `0.0.0.0:${port}` : undefined),
  };
}

/**
 * Register / add a Guardrails server. Dedupes by id (replace if replace=true).
 * Soft max when GUARDRAILS_MAX_SERVERS set; never hard-codes max=1.
 */
export function registerGuardrailsServer(
  active: GuardrailsServer[],
  server: GuardrailsServer | Parameters<typeof makeGuardrailsServer>[0],
  opts?: {
    replace?: boolean;
    maxServers?: number | null;
    env?: NodeJS.ProcessEnv;
  },
): { ok: true; servers: GuardrailsServer[] } | { ok: false; error: string; servers: GuardrailsServer[] } {
  const s =
    'status' in server && 'kind' in server && 'name' in server
      ? (server as GuardrailsServer)
      : makeGuardrailsServer(server);
  if (!s.id) {
    return { ok: false, error: 'missing id', servers: active };
  }
  const max =
    opts?.maxServers !== undefined
      ? opts.maxServers
      : guardrailsMaxServers(opts?.env);
  const existingIdx = active.findIndex((x) => x.id === s.id);
  if (existingIdx >= 0) {
    if (opts?.replace === false) {
      return { ok: false, error: `already registered: ${s.id}`, servers: active };
    }
    const next = active.slice();
    next[existingIdx] = { ...active[existingIdx], ...s, id: s.id };
    return { ok: true, servers: next };
  }
  if (max != null && active.length >= max) {
    return {
      ok: false,
      error: `GUARDRAILS_MAX_SERVERS=${max} reached`,
      servers: active,
    };
  }
  return { ok: true, servers: [...active, s] };
}

export function removeGuardrailsServer(
  active: GuardrailsServer[],
  serverId: string,
): GuardrailsServer[] {
  const id = normalizeServerId(serverId);
  if (!id) return active;
  return active.filter((s) => s.id !== id);
}

export function listGuardrailsServers(
  active: GuardrailsServer[],
  filter?: { kind?: GuardrailsServerKind; status?: GuardrailsServerStatus },
): GuardrailsServer[] {
  let out = [...active];
  if (filter?.kind) out = out.filter((s) => s.kind === filter.kind);
  if (filter?.status) out = out.filter((s) => s.status === filter.status);
  return out;
}

export function getGuardrailsServer(
  active: GuardrailsServer[],
  serverId: string,
): GuardrailsServer | undefined {
  const id = normalizeServerId(serverId);
  return active.find((s) => s.id === id);
}

/**
 * Apply per-id health results. Unreachable one must NOT wipe others.
 */
export function applyGuardrailsHealth(
  active: GuardrailsServer[],
  results: GuardrailsHealthResult[] | Map<string, GuardrailsHealthResult>,
): GuardrailsServer[] {
  const map = new Map<string, GuardrailsHealthResult>();
  if (results instanceof Map) {
    for (const [k, v] of results) map.set(normalizeServerId(k), v);
  } else {
    for (const r of results) map.set(normalizeServerId(r.id), r);
  }
  return active.map((s) => {
    const r = map.get(s.id);
    if (!r) return s;
    return {
      ...s,
      status: r.status,
      note: r.note != null ? r.note : s.note,
      url: r.url || s.url,
      port: r.port != null ? r.port : s.port,
    };
  });
}

/** Seed N Guardrails AI instances on consecutive ports (for multi-bind formal). */
export function seedGuardrailsAiInstances(opts: {
  count: number;
  basePort?: number;
  namePrefix?: string;
  host?: string;
}): GuardrailsServer[] {
  const n = Math.max(0, Math.floor(opts.count));
  const base = opts.basePort ?? FORMAL_GUARDRAILS_PORT;
  const prefix = opts.namePrefix || 'GuardrailsAI.instance';
  const host = opts.host || DEFAULT_GUARDRAILS_HOST;
  const out: GuardrailsServer[] = [];
  for (let i = 0; i < n; i++) {
    const port = base + i;
    const id = `${prefix}.${i + 1}`;
    out.push(
      makeGuardrailsServer({
        id,
        name: id,
        kind: i === 0 ? 'formal_sandbox' : 'guardrails_ai',
        port,
        host,
        status: 'unknown',
        inSandbox: true,
        note: `Guardrails multi-instance slot ${i + 1} on :${port}`,
      }),
    );
  }
  return out;
}

/**
 * Merge extra registered servers into active set without losing existing
 * and without single-slot overwrite.
 */
export function mergeGuardrailsSets(
  base: GuardrailsServer[],
  extra: GuardrailsServer[],
  opts?: { maxServers?: number | null; env?: NodeJS.ProcessEnv },
): GuardrailsServer[] {
  let cur = [...base];
  for (const s of extra) {
    const r = registerGuardrailsServer(cur, s, {
      replace: true,
      maxServers: opts?.maxServers,
      env: opts?.env,
    });
    if (r.ok) cur = r.servers;
  }
  return cur;
}

/** Default catalog: formal :7003 + common Guardrails AI labels (N labels, not cap-1). */
export function defaultGuardrailsCatalog(opts?: {
  guardrailsPort?: number;
  healthOk?: boolean | null;
  extraAi?: string[];
}): GuardrailsServer[] {
  const port = opts?.guardrailsPort ?? FORMAL_GUARDRAILS_PORT;
  const healthOk = opts?.healthOk;
  const formalStatus: GuardrailsServerStatus =
    healthOk === true ? 'active' : healthOk === false ? 'unreachable' : 'unknown';
  const aiNames = opts?.extraAi || [
    'ValidJson',
    'DetectPII',
    'RestrictToTopic',
    'ToxicLanguage',
  ];
  const formal: GuardrailsServer = makeGuardrailsServer({
    id: 'formal.guardrails.content',
    name: 'formal.guardrails.content',
    kind: 'formal_sandbox',
    port,
    status: formalStatus,
    inSandbox: true,
    note:
      'Formal multi-service content-check on :' +
      port +
      '. Additional Guardrails AI servers can be registered without replacing this slot.',
  });
  const ais = aiNames.map((n) =>
    makeGuardrailsServer({
      id: `GuardrailsAI.${n}`,
      name: `GuardrailsAI.${n}`,
      kind: 'guardrails_ai',
      status: 'active',
      inSandbox: false,
      note: 'Guardrails AI-style validator / remote server label; add more freely.',
    }),
  );
  return [formal, ...ais];
}

/**
 * Pure multi-probe reducer: given probe fn results by id, update statuses independently.
 * Used by tests and host without network.
 */
export function rollupMultiHealth(
  active: GuardrailsServer[],
  probeById: Record<string, { ok: boolean; note?: string }>,
): GuardrailsServer[] {
  const results: GuardrailsHealthResult[] = active.map((s) => {
    const p = probeById[s.id];
    if (!p) {
      return {
        id: s.id,
        ok: s.status === 'active',
        status: s.status,
        port: s.port,
        url: s.url,
      };
    }
    return {
      id: s.id,
      ok: p.ok,
      status: p.ok ? 'active' : 'unreachable',
      port: s.port,
      url: s.url,
      note: p.note,
    };
  });
  return applyGuardrailsHealth(active, results);
}
