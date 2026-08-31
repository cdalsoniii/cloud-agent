/**
 * Build ontology-state.json for the in-sandbox React Flow ontology viewer.
 * Supports multi-customer packs via pack id (verifier-fleet | skydio | customer ids).
 */
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { resolvePxRoot } from './px-pack.js';
import {
  getExampleCustomer,
  type ExampleCustomer,
  customerPaths,
  listExampleCustomers,
} from './example-customers.js';

// ESM package ("type":"module") — bare require() is not defined; use createRequire.
const require = createRequire(fileURLToPath(import.meta.url));

export interface OntologyStateNode {
  id: string;
  type: 'fleetRoot' | 'class' | 'slot' | 'verifier' | 'tag' | 'shape' | 'enum' | 'instance';
  label: string;
  subtitle?: string;
  data?: Record<string, unknown>;
}

export interface OntologyStateEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  /** DBMS-style property port on source class node */
  sourceHandle?: string;
  /** DBMS-style property port on target class node */
  targetHandle?: string;
  /** Edge kind for styling / animation */
  kind?: 'defines' | 'slot' | 'range' | 'inherits' | 'verifier' | 'shape' | 'instance' | 'live';
  animated?: boolean;
}

/** Per-property field on a schema class (DBMS-style graph). */
export interface SchemaField {
  id: string;
  name: string;
  range?: string;
  required?: boolean;
  multivalued?: boolean;
  identifier?: boolean;
}

export type OntologyLayoutMode = 'class-nodes' | 'schema-ports';

export interface ReactFlowNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

export interface ReactFlowEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  sourceHandle?: string;
  targetHandle?: string;
  type?: string;
  animated?: boolean;
  data?: Record<string, unknown>;
}

export interface OntologyState {
  version: 1;
  generatedAt: string;
  pack: string;
  customerId: string;
  customerName: string;
  /** Default layout for consumers that support schema ports */
  layoutMode?: OntologyLayoutMode;
  summary: {
    classes: number;
    slots: number;
    verifiers: number;
    shapes: number;
    enums: number;
  };
  fleet?: {
    fleet_id?: string;
    revision?: string;
    environment?: string;
    compliance_tier?: string;
  };
  nodes: OntologyStateNode[];
  edges: OntologyStateEdge[];
  shapes: Array<{ name: string; bytes: number }>;
  meta: { sourceRoot: string; notes: string[] };
  reactFlow?: {
    nodes: ReactFlowNode[];
    edges: ReactFlowEdge[];
  };
}

/** Stable field handle id: ClassName.slot_name */
export function schemaFieldId(className: string, slotName: string): string {
  return `${className}.${slotName}`;
}

/** True if range names another class (not a primitive/enum literal we treat as scalar). */
export function isClassRange(range: string | undefined, classNames: Set<string> | string[]): boolean {
  if (!range) return false;
  const set = classNames instanceof Set ? classNames : new Set(classNames);
  // strip list wrappers e.g. Verifier
  const r = range.replace(/^list\[|\]$/g, '').trim();
  return set.has(r);
}

/**
 * Layered left-to-right layout for schema-port graphs (Dagre-like without new deps).
 * Ranks by BFS from preferred roots (fleet-root / tree_root-ish input nodes).
 */
export function layoutSchemaGraph(
  nodes: ReactFlowNode[],
  edges: ReactFlowEdge[],
  opts?: { rankSep?: number; nodeSep?: number },
): ReactFlowNode[] {
  const rankSep = opts?.rankSep ?? 280;
  const nodeSep = opts?.nodeSep ?? 140;
  const ids = new Set(nodes.map((n) => n.id));
  const outs = new Map<string, string[]>();
  const indeg = new Map<string, number>();
  for (const n of nodes) {
    outs.set(n.id, []);
    indeg.set(n.id, 0);
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    outs.get(e.source)!.push(e.target);
    indeg.set(e.target, (indeg.get(e.target) || 0) + 1);
  }
  const roots = nodes
    .filter((n) => (indeg.get(n.id) || 0) === 0)
    .map((n) => n.id);
  if (roots.length === 0 && nodes[0]) roots.push(nodes[0].id);

  const rank = new Map<string, number>();
  const q = [...roots];
  for (const r of roots) rank.set(r, 0);
  while (q.length) {
    const u = q.shift()!;
    const ru = rank.get(u) || 0;
    for (const v of outs.get(u) || []) {
      const next = ru + 1;
      if (!rank.has(v) || (rank.get(v) || 0) < next) {
        rank.set(v, next);
        q.push(v);
      }
    }
  }
  // unreached
  let maxR = 0;
  for (const n of nodes) {
    if (!rank.has(n.id)) rank.set(n.id, 0);
    maxR = Math.max(maxR, rank.get(n.id) || 0);
  }
  const buckets = new Map<number, string[]>();
  for (const n of nodes) {
    const r = rank.get(n.id) || 0;
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(n.id);
  }
  const pos = new Map<string, { x: number; y: number }>();
  for (let r = 0; r <= maxR; r++) {
    const bucket = buckets.get(r) || [];
    bucket.forEach((id, i) => {
      // Height scales with field count for schema classes
      const node = nodes.find((x) => x.id === id);
      const fields = (node?.data?.fields as unknown[]) || [];
      const rowH = Math.max(nodeSep, 48 + fields.length * 22);
      pos.set(id, { x: 48 + r * rankSep, y: 48 + i * rowH });
    });
  }
  return nodes.map((n) => ({
    ...n,
    position: pos.get(n.id) || n.position,
  }));
}

function tryParseYamlSimple(text: string): Record<string, unknown> | null {
  try {
    const yaml = require('yaml') as { parse: (s: string) => unknown };
    const v = yaml.parse(text);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch (e) {
    // surface for debugging in meta.notes callers
    if (process.env.ONTOLOGY_STATE_DEBUG === '1') {
      console.error('yaml parse failed', e);
    }
    return null;
  }
}

function layoutGrid(
  items: Array<{ id: string }>,
  startX: number,
  startY: number,
  colW: number,
  rowH: number,
  cols: number,
): Map<string, { x: number; y: number }> {
  const m = new Map<string, { x: number; y: number }>();
  items.forEach((it, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    m.set(it.id, { x: startX + col * colW, y: startY + row * rowH });
  });
  return m;
}

export interface SlotMeta {
  name: string;
  range?: string;
  required?: boolean;
  multivalued?: boolean;
  identifier?: boolean;
}

function scanLinkmlMeta(metaPath: string): {
  classNames: string[];
  enumNames: string[];
  slotsByClass: Record<string, string[]>;
  /** Richer slot metadata for schema-port graph */
  slotMetaByClass: Record<string, SlotMeta[]>;
} {
  const classNames: string[] = [];
  const enumNames: string[] = [];
  const slotsByClass: Record<string, string[]> = {};
  const slotMetaByClass: Record<string, SlotMeta[]> = {};
  if (!fs.existsSync(metaPath)) {
    return { classNames, enumNames, slotsByClass, slotMetaByClass };
  }
  const text = fs.readFileSync(metaPath, 'utf8');
  let currentClass: string | null = null;
  let currentSlot: SlotMeta | null = null;
  let inEnums = false;
  let inClasses = false;
  let inAttrs = false;
  const finishSlot = () => {
    if (currentClass && currentSlot) {
      if (!slotMetaByClass[currentClass]) slotMetaByClass[currentClass] = [];
      if (!slotsByClass[currentClass]) slotsByClass[currentClass] = [];
      if (!slotsByClass[currentClass].includes(currentSlot.name)) {
        slotsByClass[currentClass].push(currentSlot.name);
        slotMetaByClass[currentClass].push(currentSlot);
      }
    }
    currentSlot = null;
  };
  for (const line of text.split('\n')) {
    if (/^enums:/.test(line)) {
      finishSlot();
      inEnums = true;
      inClasses = false;
      currentClass = null;
      inAttrs = false;
      continue;
    }
    if (/^classes:/.test(line)) {
      finishSlot();
      inClasses = true;
      inEnums = false;
      currentClass = null;
      inAttrs = false;
      continue;
    }
    if (inEnums && /^  [A-Za-z0-9_]+:/.test(line) && !line.includes('permissible')) {
      const n = line.trim().replace(/:$/, '');
      if (n && !['description', 'permissible_values'].includes(n)) enumNames.push(n);
    }
    if (inClasses && /^  [A-Za-z][A-Za-z0-9_]*:/.test(line)) {
      finishSlot();
      currentClass = line.trim().replace(/:$/, '');
      classNames.push(currentClass);
      slotsByClass[currentClass] = [];
      slotMetaByClass[currentClass] = [];
      inAttrs = false;
      continue;
    }
    if (inClasses && currentClass && /attributes:/.test(line)) {
      finishSlot();
      inAttrs = true;
      continue;
    }
    // attribute name at 6 spaces
    if (inAttrs && currentClass && /^      [a-z][a-z0-9_]*:/.test(line)) {
      finishSlot();
      const slot = line.trim().replace(/:$/, '');
      if (slot && !['description', 'range', 'required', 'multivalued', 'identifier'].includes(slot)) {
        currentSlot = { name: slot };
      }
      continue;
    }
    // attribute properties at 8+ spaces
    if (inAttrs && currentClass && currentSlot && /^ {8,}[a-z_]+:/.test(line)) {
      const m = line.trim().match(/^([a-z_]+):\s*(.*)$/);
      if (m) {
        const key = m[1];
        const val = m[2].replace(/^['"]|['"]$/g, '').trim();
        if (key === 'range') currentSlot.range = val;
        if (key === 'required') currentSlot.required = val === 'true' || val === '';
        if (key === 'multivalued') currentSlot.multivalued = val === 'true' || val === '';
        if (key === 'identifier') currentSlot.identifier = val === 'true' || val === '';
      }
      continue;
    }
    if (inAttrs && currentClass && /^  [A-Za-z]/.test(line) && !/^      /.test(line)) {
      finishSlot();
      inAttrs = false;
    }
  }
  finishSlot();
  return { classNames, enumNames, slotsByClass, slotMetaByClass };
}

function resolveCustomer(packOrCustomer?: string | null): ExampleCustomer {
  if (packOrCustomer) {
    const c = getExampleCustomer(packOrCustomer);
    if (c) return c;
  }
  return getExampleCustomer('acme-fleet')!;
}

/**
 * Build graph state for a named example customer / pack.
 * @param pxRoot optional .px root
 * @param packOrCustomer pack key or customer id (acme-fleet | skydio-ops | verifier-fleet | skydio)
 */
export function buildOntologyState(
  pxRoot?: string | null,
  packOrCustomer?: string | null,
): OntologyState | null {
  const customer = resolveCustomer(packOrCustomer);
  const paths = customerPaths(customer, pxRoot);
  if (!paths) return null;
  const { root } = paths;
  const notes: string[] = [`customer=${customer.id}`, `pack=${customer.pack}`];
  const nodes: OntologyStateNode[] = [];
  const edges: OntologyStateEdge[] = [];
  const rfNodes: ReactFlowNode[] = [];
  const rfEdges: ReactFlowEdge[] = [];

  let fleet: OntologyState['fleet'];
  let verifiers: Array<Record<string, unknown>> = [];
  let instanceDoc: Record<string, unknown> | null = null;

  if (paths.instance && fs.existsSync(paths.instance)) {
    instanceDoc = tryParseYamlSimple(fs.readFileSync(paths.instance, 'utf8'));
    if (instanceDoc) {
      if (customer.pack === 'verifier-fleet' || Array.isArray(instanceDoc.verifiers)) {
        fleet = {
          fleet_id: String(instanceDoc.fleet_id || customer.id),
          revision: String(instanceDoc.revision ?? ''),
          environment: String(instanceDoc.environment || ''),
          compliance_tier:
            instanceDoc.compliance_tier != null ? String(instanceDoc.compliance_tier) : undefined,
        };
        if (Array.isArray(instanceDoc.verifiers)) {
          verifiers = instanceDoc.verifiers.filter((v) => v && typeof v === 'object') as Array<
            Record<string, unknown>
          >;
        }
      } else {
        // skydio-style report instance
        fleet = {
          fleet_id: String(instanceDoc.report_id || instanceDoc.fleet_id || customer.id),
          revision: String(instanceDoc.revision ?? '1'),
          environment: String(instanceDoc.site_id || instanceDoc.environment || 'ops'),
        };
      }
    } else notes.push('instance yaml parse failed');
  } else notes.push('no instance file');

  const { classNames, enumNames, slotsByClass, slotMetaByClass } = scanLinkmlMeta(paths.metamodel);
  if (!fs.existsSync(paths.metamodel)) notes.push('metamodel missing');
  const classNameSet = new Set(classNames);

  // Optional explode-slots mode (legacy separate slot nodes). Default: schema-ports.
  const explodeSlots =
    process.env.ONTOLOGY_GRAPH_EXPLODE_SLOTS === '1' ||
    process.env.ONTOLOGY_GRAPH_EXPLODE_SLOTS === 'true';
  const layoutMode: OntologyLayoutMode = explodeSlots ? 'class-nodes' : 'schema-ports';
  notes.push(`layoutMode=${layoutMode}`);

  const genDir = path.join(root, 'generated');
  const shapes: Array<{ name: string; bytes: number }> = [];
  if (fs.existsSync(genDir)) {
    const want = customer.shaclFile;
    for (const f of fs.readdirSync(genDir)) {
      if (!f.endsWith('.shacl.ttl')) continue;
      // prefer customer shape; still list related
      if (f === want || f.includes(customer.pack) || customer.pack === 'verifier-fleet') {
        if (customer.pack === 'verifier-fleet' && f.startsWith('skydio')) continue;
        if (customer.pack === 'skydio' && f.startsWith('verifier')) continue;
        const st = fs.statSync(path.join(genDir, f));
        shapes.push({ name: f, bytes: st.size });
      }
    }
    // always include exact match if filtered empty
    if (shapes.length === 0 && fs.existsSync(paths.shacl)) {
      shapes.push({ name: customer.shaclFile, bytes: fs.statSync(paths.shacl).size });
    }
  }

  const rootLabel =
    customer.pack === 'skydio' ? 'Ops report ontology' : 'Ontology / verifier fleet';
  nodes.push({
    id: 'fleet-root',
    type: 'fleetRoot',
    label: customer.name,
    subtitle: fleet?.fleet_id || customer.id,
    data: { ...fleet, customerId: customer.id, pack: customer.pack },
  });
  rfNodes.push({
    id: 'fleet-root',
    type: 'input',
    position: { x: 40, y: 40 },
    data: {
      label: `${customer.name}`,
      kind: 'fleetRoot',
      detail: `id=${customer.id} pack=${customer.pack} env=${fleet?.environment || '?'}`,
    },
  });

  // Instance highlight for skydio report
  if (instanceDoc && customer.pack === 'skydio') {
    const iid = 'instance-root';
    nodes.push({
      id: iid,
      type: 'instance',
      label: String(instanceDoc.title || instanceDoc.report_id || 'report'),
      subtitle: String(instanceDoc.severity || ''),
      data: instanceDoc,
    });
    rfNodes.push({
      id: iid,
      type: 'default',
      position: { x: 40, y: 120 },
      data: {
        label: String(instanceDoc.title || 'Incident report').slice(0, 48),
        detail: `severity=${instanceDoc.severity || '?'} model=${instanceDoc.vehicle_model || '?'}`,
      },
    });
    edges.push({
      id: 'e-root-inst',
      source: 'fleet-root',
      target: iid,
      label: 'instance',
      kind: 'instance',
    });
    rfEdges.push({
      id: 'e-root-inst',
      source: 'fleet-root',
      target: iid,
      label: 'instance',
      data: { kind: 'instance' },
    });
  }

  const classPos = layoutGrid(
    classNames.map((c) => ({ id: `class-${c}` })),
    40,
    200,
    280,
    160,
    3,
  );
  for (const c of classNames) {
    const id = `class-${c}`;
    const metas: SlotMeta[] =
      slotMetaByClass[c] ||
      (slotsByClass[c] || []).map((name) => ({ name }));
    const fields: SchemaField[] = metas.map((m) => ({
      id: schemaFieldId(c, m.name),
      name: m.name,
      range: m.range,
      required: m.required,
      multivalued: m.multivalued,
      identifier: m.identifier,
    }));

    nodes.push({
      id,
      type: 'class',
      label: c,
      subtitle: `${fields.length} slots`,
      data: { slots: slotsByClass[c] || [], fields },
    });
    rfNodes.push({
      id,
      type: layoutMode === 'schema-ports' ? 'schemaClass' : 'default',
      position: classPos.get(id) || { x: 40, y: 200 },
      data: {
        label: c,
        kind: 'class',
        detail: fields
          .map((f) => f.name)
          .slice(0, 8)
          .join(', '),
        fields,
        collapsed: false,
      },
    });
    edges.push({
      id: `e-root-${c}`,
      source: 'fleet-root',
      target: id,
      label: 'defines',
      kind: 'defines',
    });
    rfEdges.push({
      id: `e-root-${c}`,
      source: 'fleet-root',
      target: id,
      label: 'defines',
      data: { kind: 'defines' },
    });

    // Optional legacy explode: separate slot nodes
    if (explodeSlots) {
      for (const slot of slotsByClass[c] || []) {
        const sid = `slot-${c}-${slot}`;
        nodes.push({ id: sid, type: 'slot', label: slot, subtitle: c });
        if (
          ['compliance_tier', 'fleet_id', 'verifiers', 'shape_uri', 'report_id', 'severity'].includes(
            slot,
          ) ||
          (slotsByClass[c]!.length <= 6 && classNames.length <= 8)
        ) {
          rfNodes.push({
            id: sid,
            type: 'default',
            position: {
              x: (classPos.get(id)?.x || 40) + 40,
              y: (classPos.get(id)?.y || 200) + 70 + (slotsByClass[c]!.indexOf(slot) % 4) * 28,
            },
            data: { label: `.${slot}`, detail: c },
          });
          rfEdges.push({ id: `e-${c}-${slot}`, source: id, target: sid, label: 'slot' });
          edges.push({ id: `e-${c}-${slot}`, source: id, target: sid, label: 'slot', kind: 'slot' });
        }
      }
    }

    // Range associations → property-port edges (DBMS-style)
    for (const f of fields) {
      if (!f.range || !isClassRange(f.range, classNameSet)) continue;
      const rangeClass = f.range.replace(/^list\[|\]$/g, '').trim();
      const targetId = `class-${rangeClass}`;
      if (!classNames.includes(rangeClass)) continue;
      // Prefer identifier field on target as targetHandle when present
      const targetMeta = slotMetaByClass[rangeClass] || [];
      const idField =
        targetMeta.find((m) => m.identifier) ||
        targetMeta.find((m) => /_id$|^id$/i.test(m.name));
      const targetHandle = idField
        ? schemaFieldId(rangeClass, idField.name)
        : schemaFieldId(rangeClass, idField?.name || 'id');
      // If no id field, still use a synthetic class-level handle consumers may map
      const th = idField ? targetHandle : `${rangeClass}.__class__`;
      const eid = `e-range-${c}-${f.name}-${rangeClass}`;
      const edgeBase = {
        id: eid,
        source: id,
        target: targetId,
        label: f.name,
        sourceHandle: f.id,
        targetHandle: th,
        kind: 'range' as const,
        animated: Boolean(f.multivalued || f.required),
      };
      edges.push(edgeBase);
      rfEdges.push({
        id: eid,
        source: id,
        target: targetId,
        label: f.name,
        sourceHandle: f.id,
        targetHandle: th,
        animated: edgeBase.animated,
        type: edgeBase.animated ? 'default' : 'default',
        data: { kind: 'range', multivalued: f.multivalued, required: f.required },
      });
    }
  }

  const vPos = layoutGrid(
    verifiers.map((v, i) => ({ id: `v-${String(v.verifier_id || i)}` })),
    40,
    520,
    240,
    110,
    3,
  );
  for (let i = 0; i < verifiers.length; i++) {
    const v = verifiers[i];
    const vid = String(v.verifier_id || `v${i}`);
    const id = `v-${vid}`;
    const tags = Array.isArray(v.tags) ? (v.tags as string[]) : [];
    const blocking = Boolean(v.blocking);
    nodes.push({
      id,
      type: 'verifier',
      label: String(v.name || vid),
      subtitle: `${v.backend || ''} · ${v.kind || ''}`,
      data: { verifier_id: vid, order: v.order, tags, blocking: v.blocking, enabled: v.enabled },
    });
    rfNodes.push({
      id,
      type: 'default',
      position: vPos.get(id) || { x: 40, y: 520 },
      data: {
        label: String(v.name || vid),
        kind: 'verifier',
        detail: `order=${v.order} tags=${tags.join(',')}`,
        blocking,
      },
    });
    edges.push({
      id: `e-fleet-${vid}`,
      source: 'fleet-root',
      target: id,
      label: 'verifier',
      kind: 'verifier',
      animated: blocking,
    });
    rfEdges.push({
      id: `e-fleet-${vid}`,
      source: 'fleet-root',
      target: id,
      label: 'verifier',
      animated: blocking,
      data: { kind: 'verifier', blocking },
    });
  }

  shapes.forEach((s, i) => {
    const id = `shape-${s.name}`;
    nodes.push({ id, type: 'shape', label: s.name, subtitle: `${s.bytes} bytes` });
    rfNodes.push({
      id,
      type: 'output',
      position: { x: 720, y: 200 + i * 90 },
      data: { label: s.name, detail: `${s.bytes} B SHACL`, kind: 'shape' },
    });
    edges.push({
      id: `e-shape-${s.name}`,
      source: 'fleet-root',
      target: id,
      label: 'shape',
      kind: 'shape',
    });
    rfEdges.push({
      id: `e-shape-${s.name}`,
      source: 'fleet-root',
      target: id,
      label: 'shape',
      data: { kind: 'shape' },
    });
  });

  enumNames.slice(0, 12).forEach((e, i) => {
    const id = `enum-${e}`;
    nodes.push({ id, type: 'enum', label: e });
    rfNodes.push({
      id,
      type: 'default',
      position: { x: 720, y: 420 + i * 48 },
      data: { label: e, detail: 'enum', kind: 'enum' },
    });
  });

  void rootLabel;

  // Layered layout for schema-port graphs (stable x by rank, y by field height)
  const laidOut =
    layoutMode === 'schema-ports' ? layoutSchemaGraph(rfNodes, rfEdges) : rfNodes;

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    pack: customer.pack,
    customerId: customer.id,
    customerName: customer.name,
    layoutMode,
    summary: {
      classes: classNames.length,
      slots: Object.values(slotsByClass).reduce((a, b) => a + b.length, 0),
      verifiers: verifiers.length,
      shapes: shapes.length,
      enums: enumNames.length,
    },
    fleet,
    nodes,
    edges,
    shapes,
    meta: { sourceRoot: root, notes },
    reactFlow: { nodes: laidOut, edges: rfEdges },
  };
}

export function writeOntologyStateFile(
  pxRoot?: string | null,
  outPath?: string,
  packOrCustomer?: string | null,
): string | null {
  const state = buildOntologyState(pxRoot, packOrCustomer);
  if (!state) return null;
  const root = resolvePxRoot(pxRoot || undefined);
  if (!root) return null;
  const customer = resolveCustomer(packOrCustomer);
  const dest =
    outPath ||
    path.join(root, 'generated', `ontology-state.${customer.id}.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(state, null, 2));
  // also write default ontology-state.json for the active pack (viewer default)
  const def = path.join(root, 'generated', 'ontology-state.json');
  fs.writeFileSync(def, JSON.stringify(state, null, 2));
  return dest;
}

export function buildAllCustomerStates(pxRoot?: string | null): Array<{
  customer: ExampleCustomer;
  state: OntologyState;
  path: string;
}> {
  const out: Array<{ customer: ExampleCustomer; state: OntologyState; path: string }> = [];
  for (const c of listExampleCustomers()) {
    const state = buildOntologyState(pxRoot, c.id);
    if (!state) continue;
    const p = writeOntologyStateFile(pxRoot, undefined, c.id);
    if (p) out.push({ customer: c, state, path: p });
  }
  return out;
}

export { listExampleCustomers, getExampleCustomer };
