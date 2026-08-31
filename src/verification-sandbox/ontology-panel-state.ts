/**
 * Pure panel state for ontology React Flow viewer:
 * selection, tagging, tab routing, Guardrails active set. Testable without a browser.
 */

import {
  type GuardrailsServer as GrServer,
  type GuardrailsServerKind as GrKind,
  type GuardrailsServerStatus as GrStatus,
  FORMAL_GUARDRAILS_PORT as GR_PORT,
  defaultGuardrailsCatalog as grDefaultCatalog,
  registerGuardrailsServer as grRegister,
  removeGuardrailsServer as grRemove,
  listGuardrailsServers as grList,
  makeGuardrailsServer,
  mergeGuardrailsSets,
  seedGuardrailsAiInstances,
  rollupMultiHealth,
  applyGuardrailsHealth,
} from './guardrails-servers.js';

export type PanelTab =
  | 'search'
  | 'logs'
  | 'node'
  | 'summary'
  | 'guardrails'
  | 'midspiral';

export interface NodeTagMap {
  [nodeId: string]: string[];
}

export type GuardrailsServerKind = GrKind;
export type GuardrailsServerStatus = GrStatus;
export type GuardrailsServer = GrServer;

export {
  makeGuardrailsServer,
  mergeGuardrailsSets,
  seedGuardrailsAiInstances,
  rollupMultiHealth,
  applyGuardrailsHealth,
  registerGuardrailsServer,
  removeGuardrailsServer,
  listGuardrailsServers,
  getGuardrailsServer,
  guardrailsMaxServers,
} from './guardrails-servers.js';

const TAG_STORAGE_KEY = 'ontology-ui-node-tags-v1';
const GUARDRAILS_ACTIVE_KEY = 'ontology-ui-guardrails-active-v1';
const GUARDRAILS_SELECTED_KEY = 'ontology-ui-guardrails-selected-v1';

/** Discrete right-panel tabs (must stay in sync with UI labels). */
export const PANEL_TABS: Array<{ id: PanelTab; label: string }> = [
  { id: 'search', label: 'Search' },
  { id: 'summary', label: 'Summary' },
  { id: 'logs', label: 'Logs' },
  { id: 'guardrails', label: 'Guardrails' },
  { id: 'midspiral', label: 'Midspiral' },
  { id: 'node', label: 'Node' },
];

/** Formal sandbox Guardrails content-check port (multi-service). */
export const FORMAL_GUARDRAILS_PORT = GR_PORT;

/** Surreal validation overlay status → graph color (keep in sync with ontology-overlay.ts). */
export const OVERLAY_STATUS_COLORS: Record<
  string,
  { label: string; color: string }
> = {
  pass: { label: 'Pass', color: '#10b981' },
  fail: { label: 'Fail', color: '#f87171' },
  mixed: { label: 'Mixed', color: '#f59e0b' },
  stale: { label: 'Stale', color: '#64748b' },
  unknown: { label: 'Unknown', color: '#334155' },
};

export const MIDSPIRAL_TOOL_ORDER = [
  'lemmafit',
  'lemmascript',
  'lemmacore',
  'claimcheck',
  'dafny-replay',
  'dafny2js',
] as const;

export function isPanelTab(v: string): v is PanelTab {
  return (
    v === 'search' ||
    v === 'logs' ||
    v === 'node' ||
    v === 'summary' ||
    v === 'guardrails' ||
    v === 'midspiral'
  );
}

/** Merge Surreal overlay entity onto a React Flow node (immutable). */
export function mergeNodeOverlay<
  T extends { id: string; style?: Record<string, unknown>; data?: Record<string, unknown> },
>(
  node: T,
  entity:
    | {
        status?: string;
        color?: string;
        lastAt?: string;
        failCount?: number;
        passCount?: number;
        layers?: string[];
        note?: string;
        [k: string]: unknown;
      }
    | null
    | undefined,
): T {
  if (!entity || !entity.status || entity.status === 'unknown') {
    return {
      ...node,
      data: { ...(node.data || {}), overlay: entity || null },
    };
  }
  const color = entity.color || OVERLAY_STATUS_COLORS[entity.status]?.color || '#334155';
  return {
    ...node,
    style: {
      ...(node.style || {}),
      borderColor: color,
      boxShadow: `0 0 0 1px ${color}55, 0 4px 12px rgba(0,0,0,.35)`,
    },
    data: {
      ...(node.data || {}),
      overlay: entity,
      overlayStatus: entity.status,
      overlayColor: color,
    },
  };
}

/** Merge Surreal overlay onto a React Flow edge. */
export function mergeEdgeOverlay<
  T extends {
    id?: string;
    style?: Record<string, unknown>;
    animated?: boolean;
    data?: Record<string, unknown>;
  },
>(
  edge: T,
  entity:
    | {
        status?: string;
        color?: string;
        strokeWidth?: number;
        [k: string]: unknown;
      }
    | null
    | undefined,
): T {
  if (!entity || !entity.status || entity.status === 'unknown') {
    return {
      ...edge,
      data: { ...(edge.data || {}), overlay: entity || null },
    };
  }
  const color = entity.color || OVERLAY_STATUS_COLORS[entity.status]?.color || '#475569';
  const dashed = entity.status === 'mixed' || entity.status === 'stale';
  return {
    ...edge,
    animated: entity.status === 'fail' ? true : edge.animated,
    style: {
      ...(edge.style || {}),
      stroke: color,
      strokeWidth: entity.strokeWidth ?? (entity.status === 'fail' ? 2.5 : 1.5),
      ...(dashed ? { strokeDasharray: '6 4' } : {}),
    },
    data: {
      ...(edge.data || {}),
      overlay: entity,
      overlayStatus: entity.status,
    },
  };
}

/** Click path: set selection to node id (or null to clear). */
export function selectNode(
  currentId: string | null,
  nodeId: string | null,
): string | null {
  if (nodeId == null || nodeId === '') return null;
  return String(nodeId);
}

/** Toggle selection if same node clicked again (optional UX). */
export function selectNodeToggle(
  currentId: string | null,
  nodeId: string,
): string | null {
  if (currentId === nodeId) return null;
  return selectNode(currentId, nodeId);
}

export function normalizeTag(tag: string): string {
  return String(tag || '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 64);
}

/** Add a tag for nodeId; no-ops on empty/duplicate. */
export function addNodeTag(tags: NodeTagMap, nodeId: string, tag: string): NodeTagMap {
  const id = String(nodeId || '');
  if (!id) return tags;
  const t = normalizeTag(tag);
  if (!t) return tags;
  const prev = tags[id] || [];
  if (prev.includes(t)) return tags;
  return { ...tags, [id]: [...prev, t] };
}

/** Remove a tag for nodeId. */
export function removeNodeTag(
  tags: NodeTagMap,
  nodeId: string,
  tag: string,
): NodeTagMap {
  const id = String(nodeId || '');
  if (!id) return tags;
  const t = normalizeTag(tag);
  const prev = tags[id] || [];
  const next = prev.filter((x) => x !== t);
  if (next.length === prev.length) return tags;
  if (next.length === 0) {
    const copy = { ...tags };
    delete copy[id];
    return copy;
  }
  return { ...tags, [id]: next };
}

export function getNodeTags(tags: NodeTagMap, nodeId: string): string[] {
  return [...(tags[String(nodeId)] || [])];
}

/** Session persistence helpers (browser localStorage or memory store). */
export function loadTagsFromStorage(
  storage: { getItem(k: string): string | null } | null | undefined,
): NodeTagMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(TAG_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as NodeTagMap;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: NodeTagMap = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (Array.isArray(v)) out[k] = v.map(String).map(normalizeTag).filter(Boolean);
    }
    return out;
  } catch {
    return {};
  }
}

export function saveTagsToStorage(
  storage: { setItem(k: string, v: string): void } | null | undefined,
  tags: NodeTagMap,
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(TAG_STORAGE_KEY, JSON.stringify(tags));
    return true;
  } catch {
    return false;
  }
}

// —— Guardrails active set (multi-server; no hard cap of 1) ——

/** Default catalog: formal :7003 + common Guardrails AI validator names (routing labels). */
export function defaultGuardrailsCatalog(opts?: {
  guardrailsPort?: number;
  healthOk?: boolean | null;
  extraAi?: string[];
}): GuardrailsServer[] {
  return grDefaultCatalog(opts);
}

/** Select a Guardrails server id (or null to clear). */
export function selectGuardrailsServer(
  currentId: string | null,
  serverId: string | null,
): string | null {
  if (serverId == null || serverId === '') return null;
  return String(serverId);
}

/**
 * Remove server from active list by id.
 * Returns new array (immutable). Other servers remain.
 */
export function removeActiveGuardrailsServer(
  active: GuardrailsServer[],
  serverId: string,
): GuardrailsServer[] {
  return grRemove(active, serverId);
}

/**
 * Add any Guardrails AI / formal / remote server. No single-slot overwrite of others.
 * Uses registerGuardrailsServer (soft max only if GUARDRAILS_MAX_SERVERS set).
 */
export function addActiveGuardrailsServer(
  active: GuardrailsServer[],
  server: GuardrailsServer,
): GuardrailsServer[] {
  const r = grRegister(active, server, { replace: false });
  return r.servers;
}

/** Register or replace by id; for free-form operator adds (N servers). */
export function registerActiveGuardrailsServer(
  active: GuardrailsServer[],
  server: GuardrailsServer | Parameters<typeof makeGuardrailsServer>[0],
  opts?: { replace?: boolean },
): GuardrailsServer[] {
  const r = grRegister(active, server, { replace: opts?.replace !== false });
  return r.servers;
}

export function listActiveGuardrailsServers(
  active: GuardrailsServer[],
): GuardrailsServer[] {
  return grList(active).filter(
    (s) => s.status === 'active' || s.status === 'unknown',
  );
}

/** List entire set including unreachable (for multi-health UI). */
export function listAllGuardrailsServers(
  active: GuardrailsServer[],
): GuardrailsServer[] {
  return grList(active);
}

export function loadGuardrailsActiveFromStorage(
  storage: { getItem(k: string): string | null } | null | undefined,
): GuardrailsServer[] | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(GUARDRAILS_ACTIVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as GuardrailsServer[];
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((s) => s && typeof s.id === 'string');
  } catch {
    return null;
  }
}

export function saveGuardrailsActiveToStorage(
  storage: { setItem(k: string, v: string): void } | null | undefined,
  active: GuardrailsServer[],
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(GUARDRAILS_ACTIVE_KEY, JSON.stringify(active));
    return true;
  } catch {
    return false;
  }
}

export function loadGuardrailsSelectedFromStorage(
  storage: { getItem(k: string): string | null } | null | undefined,
): string | null {
  if (!storage) return null;
  try {
    return storage.getItem(GUARDRAILS_SELECTED_KEY);
  } catch {
    return null;
  }
}

export function saveGuardrailsSelectedToStorage(
  storage: { setItem(k: string, v: string): void } | null | undefined,
  id: string | null,
): boolean {
  if (!storage) return false;
  try {
    if (id == null) storage.setItem(GUARDRAILS_SELECTED_KEY, '');
    else storage.setItem(GUARDRAILS_SELECTED_KEY, id);
    return true;
  } catch {
    return false;
  }
}

export {
  TAG_STORAGE_KEY,
  GUARDRAILS_ACTIVE_KEY,
  GUARDRAILS_SELECTED_KEY,
};
