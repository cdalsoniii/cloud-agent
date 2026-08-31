/**
 * Aggregate Surreal validation_call (+ optional endpoint_io) into per-node / per-edge
 * color + metadata for the ontology React Flow viewer.
 *
 * Pure functions — no I/O. Persistence lives in validation-io-store / UI server.
 */

export type OverlayStatus = 'pass' | 'fail' | 'mixed' | 'stale' | 'unknown';

export const OVERLAY_COLORS: Record<OverlayStatus, { node: string; edge: string }> = {
  pass: { node: '#10b981', edge: '#34d399' },
  fail: { node: '#f87171', edge: '#f87171' },
  mixed: { node: '#f59e0b', edge: '#fbbf24' },
  stale: { node: '#64748b', edge: '#64748b' },
  unknown: { node: '#334155', edge: '#475569' },
};

export interface OverlayEntity {
  id: string;
  kind: 'node' | 'edge';
  status: OverlayStatus;
  color: string;
  strokeWidth?: number;
  lastAt?: string;
  lastOk?: boolean;
  failCount: number;
  passCount: number;
  layers: string[];
  tools: string[];
  classes?: string[];
  callIds: string[];
  note?: string;
}

export interface OntologyOverlay {
  version: 1;
  generatedAt: string;
  source: 'surreal' | 'jsonl' | 'empty' | 'computed';
  staleAfterMs: number;
  nodes: Record<string, OverlayEntity>;
  edges: Record<string, OverlayEntity>;
  summary: {
    pass: number;
    fail: number;
    mixed: number;
    stale: number;
    unknown: number;
    totalNodes: number;
    totalEdges: number;
    callCount: number;
  };
}

export interface OverlayGraphNode {
  id: string;
  type?: string;
  data?: {
    label?: string;
    kind?: string;
    detail?: string;
    fields?: Array<{ name?: string; id?: string; range?: string }>;
    [k: string]: unknown;
  };
}

export interface OverlayGraphEdge {
  id?: string;
  source: string;
  target: string;
  label?: string | unknown;
  data?: {
    slot?: string;
    name?: string;
    relationship?: string;
    [k: string]: unknown;
  };
  sourceHandle?: string;
  targetHandle?: string;
}

export interface OverlayValidationCall {
  call_id?: string;
  at?: string;
  tool?: string;
  pack?: string;
  className?: string;
  ok?: boolean;
  layers?: string[];
  linkml_reasoning?: {
    classesUsed?: string[];
    relationshipsUsed?: string[];
    resolversUsed?: string[];
    mutationsReferenced?: string[];
  };
}

export interface BuildOverlayInput {
  nodes: OverlayGraphNode[];
  edges: OverlayGraphEdge[];
  calls: OverlayValidationCall[];
  /** Default 24h */
  staleAfterMs?: number;
  /** Max calls considered per entity window for mixed */
  windowSize?: number;
  now?: number;
  source?: OntologyOverlay['source'];
}

function norm(s: string | undefined | null): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/^class[-_]/, '')
    .replace(/[^a-z0-9]+/g, '');
}

function edgeLabel(e: OverlayGraphEdge): string {
  if (typeof e.label === 'string') return e.label;
  if (e.label != null && typeof e.label === 'object' && 'label' in (e.label as object)) {
    return String((e.label as { label?: string }).label || '');
  }
  return (
    String(e.data?.slot || e.data?.name || e.data?.relationship || e.id || '')
  );
}

function nodeKeys(n: OverlayGraphNode): string[] {
  const keys = new Set<string>();
  const add = (v: string | undefined) => {
    const k = norm(v);
    if (k) keys.add(k);
  };
  add(n.id);
  add(n.data?.label);
  add(String(n.data?.kind || ''));
  // class-Engagement style ids
  if (n.id && n.id.includes('-')) {
    const parts = n.id.split('-');
    add(parts[parts.length - 1]);
  }
  return [...keys];
}

function callClassKeys(c: OverlayValidationCall): string[] {
  const keys = new Set<string>();
  const add = (v: string | undefined) => {
    const k = norm(v);
    if (k) keys.add(k);
  };
  add(c.className);
  for (const x of c.linkml_reasoning?.classesUsed || []) add(x);
  return [...keys];
}

function callRelKeys(c: OverlayValidationCall): string[] {
  const keys = new Set<string>();
  for (const x of c.linkml_reasoning?.relationshipsUsed || []) {
    const k = norm(x);
    if (k) keys.add(k);
  }
  return [...keys];
}

interface Hit {
  at: string;
  ok: boolean;
  callId: string;
  tool: string;
  layers: string[];
  classes: string[];
}

function sortHitsDesc(hits: Hit[]): Hit[] {
  return [...hits].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

function rollupStatus(
  hits: Hit[],
  staleAfterMs: number,
  now: number,
  windowSize: number,
): Pick<
  OverlayEntity,
  | 'status'
  | 'lastAt'
  | 'lastOk'
  | 'failCount'
  | 'passCount'
  | 'layers'
  | 'tools'
  | 'classes'
  | 'callIds'
  | 'note'
> {
  if (!hits.length) {
    return {
      status: 'unknown',
      failCount: 0,
      passCount: 0,
      layers: [],
      tools: [],
      classes: [],
      callIds: [],
    };
  }
  const sorted = sortHitsDesc(hits);
  const window = sorted.slice(0, windowSize);
  let failCount = 0;
  let passCount = 0;
  const layers = new Set<string>();
  const tools = new Set<string>();
  const classes = new Set<string>();
  const callIds: string[] = [];
  for (const h of window) {
    if (h.ok) passCount += 1;
    else failCount += 1;
    for (const L of h.layers) if (L) layers.add(L);
    if (h.tool) tools.add(h.tool);
    for (const c of h.classes) if (c) classes.add(c);
    if (h.callId) callIds.push(h.callId);
  }
  const last = sorted[0];
  const lastMs = Date.parse(last.at);
  const age = Number.isFinite(lastMs) ? now - lastMs : 0;
  let status: OverlayStatus;
  if (age > staleAfterMs) {
    status = 'stale';
  } else if (failCount > 0 && passCount > 0) {
    status = 'mixed';
  } else if (failCount > 0) {
    status = 'fail';
  } else {
    status = 'pass';
  }
  return {
    status,
    lastAt: last.at,
    lastOk: last.ok,
    failCount,
    passCount,
    layers: [...layers],
    tools: [...tools],
    classes: [...classes],
    callIds: callIds.slice(0, 12),
    note:
      status === 'stale'
        ? `last hit ${last.at} older than TTL`
        : `${passCount} pass / ${failCount} fail in window`,
  };
}

function entityFromHits(
  id: string,
  kind: 'node' | 'edge',
  hits: Hit[],
  staleAfterMs: number,
  now: number,
  windowSize: number,
): OverlayEntity {
  const r = rollupStatus(hits, staleAfterMs, now, windowSize);
  const color =
    kind === 'edge'
      ? OVERLAY_COLORS[r.status].edge
      : OVERLAY_COLORS[r.status].node;
  return {
    id,
    kind,
    color,
    strokeWidth:
      r.status === 'fail' ? 2.5 : r.status === 'mixed' ? 2 : r.status === 'pass' ? 1.75 : 1.5,
    ...r,
  };
}

/**
 * Build full overlay maps for graph nodes/edges from validation calls.
 */
export function buildOntologyOverlay(input: BuildOverlayInput): OntologyOverlay {
  const staleAfterMs = input.staleAfterMs ?? 24 * 60 * 60 * 1000;
  const windowSize = input.windowSize ?? 20;
  const now = input.now ?? Date.now();
  const source = input.source ?? (input.calls.length ? 'computed' : 'empty');

  // index nodes by normalized keys
  const nodeByKey = new Map<string, string[]>(); // key → node ids
  for (const n of input.nodes) {
    for (const k of nodeKeys(n)) {
      const list = nodeByKey.get(k) || [];
      if (!list.includes(n.id)) list.push(n.id);
      nodeByKey.set(k, list);
    }
  }

  const nodeHits = new Map<string, Hit[]>();
  const edgeHits = new Map<string, Hit[]>();

  const ensureNode = (id: string) => {
    if (!nodeHits.has(id)) nodeHits.set(id, []);
    return nodeHits.get(id)!;
  };
  const ensureEdge = (id: string) => {
    if (!edgeHits.has(id)) edgeHits.set(id, []);
    return edgeHits.get(id)!;
  };

  for (const c of input.calls) {
    const hit: Hit = {
      at: c.at || new Date(0).toISOString(),
      ok: c.ok !== false,
      callId: c.call_id || '',
      tool: c.tool || '',
      layers: Array.isArray(c.layers) ? c.layers.map(String) : [],
      classes: [
        ...(c.className ? [c.className] : []),
        ...(c.linkml_reasoning?.classesUsed || []),
      ],
    };

    const classKeys = callClassKeys(c);
    const matchedNodeIds = new Set<string>();
    for (const ck of classKeys) {
      for (const nid of nodeByKey.get(ck) || []) matchedNodeIds.add(nid);
    }
    // soft pack-level: no class → fleetRoot nodes only (low signal)
    if (!classKeys.length) {
      for (const n of input.nodes) {
        if (n.data?.kind === 'fleetRoot' || n.type === 'input') {
          matchedNodeIds.add(n.id);
        }
      }
    }
    for (const nid of matchedNodeIds) ensureNode(nid).push(hit);

    const relKeys = callRelKeys(c);
    for (const e of input.edges) {
      const eid = e.id || `${e.source}->${e.target}`;
      const elabel = norm(edgeLabel(e));
      const idNorm = norm(e.id);
      let relHit = false;
      for (const rk of relKeys) {
        if (rk && (elabel.includes(rk) || rk.includes(elabel) || idNorm.includes(rk))) {
          relHit = true;
          break;
        }
      }
      if (relHit) ensureEdge(eid).push(hit);
    }
  }

  // edge status also derived from endpoint node statuses when no direct rel hits
  const nodes: Record<string, OverlayEntity> = {};
  for (const n of input.nodes) {
    nodes[n.id] = entityFromHits(
      n.id,
      'node',
      nodeHits.get(n.id) || [],
      staleAfterMs,
      now,
      windowSize,
    );
  }

  const edges: Record<string, OverlayEntity> = {};
  for (const e of input.edges) {
    const eid = e.id || `${e.source}->${e.target}`;
    let hits = edgeHits.get(eid) || [];
    if (!hits.length) {
      // derive from endpoints
      const src = nodes[e.source];
      const tgt = nodes[e.target];
      if (src && tgt && (src.status !== 'unknown' || tgt.status !== 'unknown')) {
        const synthetic: Hit[] = [];
        if (src.lastAt) {
          synthetic.push({
            at: src.lastAt,
            ok: src.status === 'pass' || (src.status === 'mixed' && src.lastOk === true),
            callId: src.callIds[0] || '',
            tool: src.tools[0] || 'endpoint-derive',
            layers: src.layers,
            classes: src.classes || [],
          });
        }
        if (tgt.lastAt) {
          synthetic.push({
            at: tgt.lastAt,
            ok: tgt.status === 'pass' || (tgt.status === 'mixed' && tgt.lastOk === true),
            callId: tgt.callIds[0] || '',
            tool: tgt.tools[0] || 'endpoint-derive',
            layers: tgt.layers,
            classes: tgt.classes || [],
          });
        }
        // both fail → fail; one fail → mixed/fail; both pass → pass
        if (src.status === 'fail' && tgt.status === 'fail') {
          hits = synthetic.map((h) => ({ ...h, ok: false }));
        } else if (src.status === 'fail' || tgt.status === 'fail') {
          hits = [
            ...synthetic,
            {
              at: new Date(now).toISOString(),
              ok: false,
              callId: '',
              tool: 'endpoint-derive',
              layers: [],
              classes: [],
            },
          ];
        } else {
          hits = synthetic;
        }
      }
    }
    edges[eid] = entityFromHits(eid, 'edge', hits, staleAfterMs, now, windowSize);
  }

  const summary = {
    pass: 0,
    fail: 0,
    mixed: 0,
    stale: 0,
    unknown: 0,
    totalNodes: input.nodes.length,
    totalEdges: input.edges.length,
    callCount: input.calls.length,
  };
  for (const ent of Object.values(nodes)) {
    summary[ent.status] += 1;
  }

  return {
    version: 1,
    generatedAt: new Date(now).toISOString(),
    source,
    staleAfterMs,
    nodes,
    edges,
    summary,
  };
}

/** Merge overlay colors into React Flow node/edge style objects (immutable). */
export function applyOverlayToNode<
  T extends { id: string; style?: Record<string, unknown>; data?: Record<string, unknown> },
>(node: T, overlay: OverlayEntity | undefined): T {
  if (!overlay || overlay.status === 'unknown') {
    return {
      ...node,
      data: { ...(node.data || {}), overlay: overlay || null },
    };
  }
  return {
    ...node,
    style: {
      ...(node.style || {}),
      borderColor: overlay.color,
      boxShadow: `0 0 0 1px ${overlay.color}55, 0 4px 12px rgba(0,0,0,.35)`,
    },
    data: {
      ...(node.data || {}),
      overlay,
      overlayStatus: overlay.status,
      overlayColor: overlay.color,
    },
  };
}

export function applyOverlayToEdge<
  T extends {
    id?: string;
    style?: Record<string, unknown>;
    animated?: boolean;
    label?: unknown;
    data?: Record<string, unknown>;
  },
>(edge: T, overlay: OverlayEntity | undefined): T {
  if (!overlay || overlay.status === 'unknown') {
    return {
      ...edge,
      data: { ...(edge.data || {}), overlay: overlay || null },
    };
  }
  const dashed = overlay.status === 'mixed' || overlay.status === 'stale';
  return {
    ...edge,
    animated: overlay.status === 'fail' ? true : edge.animated,
    style: {
      ...(edge.style || {}),
      stroke: overlay.color,
      strokeWidth: overlay.strokeWidth ?? 1.5,
      ...(dashed ? { strokeDasharray: '6 4' } : {}),
    },
    data: {
      ...(edge.data || {}),
      overlay,
      overlayStatus: overlay.status,
    },
  };
}

export function emptyOverlay(source: OntologyOverlay['source'] = 'empty'): OntologyOverlay {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    source,
    staleAfterMs: 24 * 60 * 60 * 1000,
    nodes: {},
    edges: {},
    summary: {
      pass: 0,
      fail: 0,
      mixed: 0,
      stale: 0,
      unknown: 0,
      totalNodes: 0,
      totalEdges: 0,
      callCount: 0,
    },
  };
}
