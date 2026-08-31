/**
 * Structured pre/post tool-hook context: LinkML ontologies, Guardrails names,
 * SHACL/Lean/GraphQL shapes, and relationships relevant to the tool payload.
 */
import fs from 'fs';
import path from 'path';
import { EXAMPLE_CUSTOMERS, getExampleCustomer, type ExampleCustomer } from './example-customers.js';
import { resolvePxRoot } from './px-pack.js';
import { GUARDRAILS_PORT, SHACL_PORT } from './types.js';
import { buildLinkmlReasoning, type LinkmlReasoning } from './linkml-reasoning.js';

export type GuardrailKind = 'formal_service' | 'guardrails_ai' | 'pack_domain' | 'cascade_layer';

export interface OntologyRef {
  id: string;
  pack: string;
  name: string;
  metamodelFile: string;
  linkmlDir: string;
  rootClass: string;
  shaclFile: string;
  relevant: boolean;
  reason: string;
}

export interface GuardrailRef {
  name: string;
  kind: GuardrailKind;
  port?: number;
  domain?: string;
  relevant: boolean;
  reason: string;
}

export interface ShapeRef {
  shapeId: string;
  targetClass: string;
  source: 'shacl' | 'lean-rules' | 'graphql-type';
  shapesFile?: string;
  relevant: boolean;
  reason: string;
}

export interface RelationshipRef {
  id: string;
  sourceType: string;
  field: string;
  targetType: string;
  multivalued?: boolean;
  resolver?: string;
  joinOn?: string;
  presentInPayload: boolean;
  reason: string;
}

export type RelevantOntologyTag =
  | 'there_is_one_relevant_ontology'
  | 'multiple_relevant_ontologies'
  | 'no_relevant_ontology';

export interface OntologyHookContext {
  phase: 'pre' | 'post';
  tool: string;
  pack: string;
  className: string;
  /** Stable I/O metadata tag for agents (count of relevant LinkML packs). */
  relevantOntologyTag: RelevantOntologyTag;
  relevantOntologyCount: number;
  endpoint?: {
    provider: string;
    sandboxId: string;
    shaclPort: number;
    guardrailsPort: number;
    shaclPreviewUrl?: string;
  };
  ontologies: OntologyRef[];
  guardrails: GuardrailRef[];
  shapes: ShapeRef[];
  relationships: RelationshipRef[];
  cascadeLayers?: Array<{ layer: string; engine?: string; ok?: boolean }>;
  /** Classes / relationships / mutations / resolvers used (agent reasoning). */
  linkmlReasoning?: LinkmlReasoning;
}

const ROOT_BY_PACK: Record<string, string> = {
  oteemo: 'Engagement',
  'oteemo-devsecops': 'Engagement',
  skydio: 'IncidentPostmortemReport',
  'verifier-fleet': 'VerifierFleet',
};

/** Tool → domain / Guardrails-AI-style rails for relevance. */
const TOOL_RAILS: Record<
  string,
  { domains: string[]; stages: string[]; guardrailsAi: string[] }
> = {
  deploy_manifest: {
    domains: ['sast', 'sca', 'secrets', 'container', 'compliance'],
    stages: ['secure', 'deploy'],
    guardrailsAi: ['ValidJson', 'DetectPII', 'RestrictToTopic'],
  },
  scan_image: {
    domains: ['container', 'sca'],
    stages: ['secure', 'build'],
    guardrailsAi: ['ValidJson', 'ToxicLanguage'],
  },
  schedule_internal_client_state_meeting: {
    domains: ['identity', 'compliance'],
    stages: ['plan', 'operate'],
    guardrailsAi: ['DetectPII', 'ToxicLanguage', 'ValidJson'],
  },
  publish_recovery_actions: {
    domains: ['compliance', 'identity', 'iac'],
    stages: ['operate', 'plan'],
    guardrailsAi: ['ValidJson', 'DetectPII'],
  },
  request_promotion_review: {
    domains: ['compliance', 'identity'],
    stages: ['operate'],
    guardrailsAi: ['ValidJson', 'RestrictToTopic'],
  },
  open_pr: {
    domains: ['sast', 'secrets'],
    stages: ['build', 'secure'],
    guardrailsAi: ['ValidJson', 'ToxicLanguage'],
  },
};

function packNorm(pack?: string): string {
  return String(pack || 'verifier-fleet')
    .toLowerCase()
    .replace(/_/g, '-');
}

function defaultClass(pack: string): string {
  return ROOT_BY_PACK[pack] || 'VerifierFleet';
}

function presentTypes(data: unknown, root: string, classFields: Map<string, string[]>): Set<string> {
  const out = new Set<string>([root]);
  function walk(obj: unknown, typeName: string) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    const rec = obj as Record<string, unknown>;
    const fields = classFields.get(typeName) || [];
    for (const f of fields) {
      // f encoded as field:range
      const [field, range] = f.split(':');
      const val = rec[field];
      if (val === undefined || val === null) continue;
      if (!range) continue;
      if (Array.isArray(val)) {
        out.add(range);
        val.forEach((item) => {
          if (item && typeof item === 'object') walk(item, range);
        });
      } else if (typeof val === 'object') {
        out.add(range);
        walk(val, range);
      }
    }
  }
  walk(data, root);
  return out;
}

function loadJson(p: string): unknown {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

function scanShaclNodeShapes(shapesFile: string): string[] {
  if (!fs.existsSync(shapesFile)) return [];
  const text = fs.readFileSync(shapesFile, 'utf8');
  const names: string[] = [];
  const re = /(?:^|\n)([a-zA-Z0-9_]+:[A-Za-z0-9_]+)\s+a\s+sh:NodeShape\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    names.push(m[1]);
  }
  return names;
}

export function buildOntologyHookContext(opts: {
  phase: 'pre' | 'post';
  tool?: string;
  pack?: string;
  className?: string;
  data?: unknown;
  pxRoot?: string | null;
  relevantOnly?: boolean;
  endpoint?: OntologyHookContext['endpoint'];
  cascadeLayers?: OntologyHookContext['cascadeLayers'];
}): OntologyHookContext {
  const pack = packNorm(opts.pack);
  const className = opts.className || defaultClass(pack);
  const tool = opts.tool || 'unknown';
  const relevantOnly = opts.relevantOnly !== false;
  const px = resolvePxRoot(opts.pxRoot || undefined);
  const customer =
    getExampleCustomer(pack) ||
    EXAMPLE_CUSTOMERS.find((c) => c.pack === pack) ||
    null;

  const ontologies: OntologyRef[] = EXAMPLE_CUSTOMERS.map((c) => {
    const relevant = c.pack === pack || c.id === pack || pack.startsWith(c.pack);
    return {
      id: c.id,
      pack: c.pack,
      name: c.name,
      metamodelFile: c.metamodelFile,
      linkmlDir: c.linkmlDir,
      rootClass: defaultClass(c.pack),
      shaclFile: c.shaclFile,
      relevant,
      reason: relevant
        ? `Active pack for this tool_io_guard call (pack=${pack})`
        : 'Registered LinkML pack (not selected for this call)',
    };
  });

  // Generated artifacts for active pack
  const packFile = pack === 'oteemo-devsecops' ? 'oteemo' : pack;
  const generated = px ? path.join(px, 'generated') : null;
  const resolversPath = generated ? path.join(generated, `${packFile}.resolvers.json`) : null;
  const rulesPath = generated ? path.join(generated, `${packFile}.lean-rules.json`) : null;
  const shaclPath =
    customer && px
      ? path.join(px, 'generated', customer.shaclFile)
      : generated
        ? path.join(generated, `${packFile}.shacl.ttl`)
        : null;

  const resolvers = resolversPath ? (loadJson(resolversPath) as any) : null;
  const rules = rulesPath ? (loadJson(rulesPath) as any) : null;

  // class → field:range for payload walk
  const classFields = new Map<string, string[]>();
  if (rules?.classes) {
    for (const [cname, cdef] of Object.entries(rules.classes as Record<string, any>)) {
      const fields = (cdef.fields || [])
        .filter((f: any) => f.range && String(f.range)[0] === String(f.range)[0].toUpperCase())
        .map((f: any) => `${f.name}:${f.range}`);
      // also keep non-class for completeness with range hint
      const all = (cdef.fields || []).map((f: any) => `${f.name}:${f.range || 'string'}`);
      classFields.set(cname, all.filter((x: string) => {
        const r = x.split(':')[1];
        return r && r[0] === r[0].toUpperCase() && r !== 'String';
      }));
      if (!classFields.get(cname)?.length) {
        // use resolvers
      }
    }
  }
  if (resolvers?.fields) {
    for (const f of resolvers.fields as Array<{ type: string; field: string; range: string }>) {
      if (!f.range || f.range[0] !== f.range[0].toUpperCase()) continue;
      const list = classFields.get(f.type) || [];
      const key = `${f.field}:${f.range}`;
      if (!list.includes(key)) list.push(key);
      classFields.set(f.type, list);
    }
  }

  const typesPresent = presentTypes(opts.data, className, classFields);

  const shapes: ShapeRef[] = [];
  const classNames = rules?.classes ? Object.keys(rules.classes) : [className];
  for (const c of classNames) {
    const relevant = typesPresent.has(c) || c === className;
    shapes.push({
      shapeId: `${packFile}:${c}`,
      targetClass: c,
      source: 'lean-rules',
      shapesFile: shaclPath || undefined,
      relevant,
      reason: relevant
        ? c === className
          ? 'Root class for validation'
          : 'Present in tool payload graph'
        : 'Defined in pack lean-rules but not in this payload',
    });
  }
  if (shaclPath) {
    for (const n of scanShaclNodeShapes(shaclPath)) {
      const short = n.includes(':') ? n.split(':')[1] : n;
      if (shapes.some((s) => s.targetClass === short)) continue;
      shapes.push({
        shapeId: n,
        targetClass: short,
        source: 'shacl',
        shapesFile: shaclPath,
        relevant: typesPresent.has(short),
        reason: 'SHACL NodeShape in pack TTL',
      });
    }
  }

  const relationships: RelationshipRef[] = [];
  const fields = (resolvers?.fields || []) as Array<{
    type: string;
    field: string;
    range: string;
    multivalued?: boolean;
    resolver?: string;
    joinOn?: string;
  }>;
  for (const f of fields) {
    if (!f.range || f.range[0] !== f.range[0].toUpperCase()) continue;
    const present =
      typesPresent.has(f.type) &&
      (typesPresent.has(f.range) ||
        (opts.data &&
          typeof opts.data === 'object' &&
          !Array.isArray(opts.data) &&
          f.type === className &&
          (opts.data as any)[f.field] !== undefined));
    relationships.push({
      id: `${f.type}.${f.field}->${f.range}`,
      sourceType: f.type,
      field: f.field,
      targetType: f.range,
      multivalued: f.multivalued,
      resolver: f.resolver,
      joinOn: f.joinOn,
      presentInPayload: Boolean(present),
      reason: present
        ? 'Edge present in payload / type graph'
        : 'Schema relationship (not present in this payload)',
    });
  }

  // Guardrails
  const toolKey = tool.toLowerCase();
  const toolRails =
    TOOL_RAILS[tool] ||
    TOOL_RAILS[toolKey] ||
    ({ domains: [], stages: [], guardrailsAi: ['ValidJson'] } as const);

  const guardrails: GuardrailRef[] = [
    {
      name: 'formal.guardrails.content',
      kind: 'formal_service',
      port: GUARDRAILS_PORT,
      relevant: true,
      reason: `Packed sandbox content-check service on :${GUARDRAILS_PORT}`,
    },
    {
      name: 'formal.shacl.validate',
      kind: 'cascade_layer',
      port: SHACL_PORT,
      relevant: true,
      reason: `SHACL shapes server / host pySHACL (port ${SHACL_PORT} in sandbox)`,
    },
    {
      name: 'cascade.lean-rules-v1',
      kind: 'cascade_layer',
      relevant: true,
      reason: 'Lean well-formedness layer after SHACL',
    },
    {
      name: 'cascade.linkml-resolvers-v1',
      kind: 'cascade_layer',
      relevant: true,
      reason: 'GraphQL SDL + LinkML resolver completeness layer',
    },
  ];

  for (const ga of toolRails.guardrailsAi) {
    guardrails.push({
      name: `GuardrailsAI.${ga}`,
      kind: 'guardrails_ai',
      relevant: true,
      reason: `Routing label for tool=${tool} (Guardrails AI-style validator name)`,
    });
  }
  for (const d of toolRails.domains) {
    guardrails.push({
      name: `${packFile}.domain.${d}`,
      kind: 'pack_domain',
      domain: d,
      relevant: true,
      reason: `LinkML control domain associated with tool=${tool}`,
    });
  }
  for (const s of toolRails.stages) {
    guardrails.push({
      name: `${packFile}.stage.${s}`,
      kind: 'pack_domain',
      domain: s,
      relevant: true,
      reason: `Pipeline stage associated with tool=${tool}`,
    });
  }

  // Payload domains from controls if present
  if (opts.data && typeof opts.data === 'object' && !Array.isArray(opts.data)) {
    const controls = (opts.data as any).controls;
    if (Array.isArray(controls)) {
      for (const c of controls) {
        if (c?.domain) {
          const name = `${packFile}.domain.${c.domain}`;
          if (!guardrails.some((g) => g.name === name)) {
            guardrails.push({
              name,
              kind: 'pack_domain',
              domain: String(c.domain),
              relevant: true,
              reason: 'Domain present on SecurityControl in payload',
            });
          }
        }
      }
    }
  }

  const filterRel = <T extends { relevant?: boolean; presentInPayload?: boolean }>(
    arr: T[],
    pred: (x: T) => boolean,
  ) => (relevantOnly ? arr.filter(pred) : arr);

  const ontologiesOut = filterRel(ontologies, (o) => o.relevant);
  const relevantOntologyCount = ontologiesOut.filter((o) => o.relevant).length;
  const relevantOntologyTag: RelevantOntologyTag =
    relevantOntologyCount === 1
      ? 'there_is_one_relevant_ontology'
      : relevantOntologyCount > 1
        ? 'multiple_relevant_ontologies'
        : 'no_relevant_ontology';

  let linkmlReasoning: LinkmlReasoning | undefined;
  try {
    linkmlReasoning = buildLinkmlReasoning({
      pack,
      className,
      tool,
      data: opts.data,
      pxRoot: opts.pxRoot,
    });
  } catch {
    linkmlReasoning = undefined;
  }

  return {
    phase: opts.phase,
    tool,
    pack,
    className,
    relevantOntologyTag,
    relevantOntologyCount,
    endpoint: opts.endpoint,
    ontologies: ontologiesOut,
    guardrails: filterRel(guardrails, (g) => g.relevant),
    shapes: filterRel(shapes, (s) => s.relevant).slice(0, 40),
    relationships: filterRel(relationships, (r) => r.presentInPayload || r.sourceType === className).slice(
      0,
      50,
    ),
    cascadeLayers: opts.cascadeLayers,
    linkmlReasoning,
  };
}

export function formatOntologyHookContextScope(ctx: OntologyHookContext | { pre?: OntologyHookContext; post?: OntologyHookContext }): string {
  const blocks: OntologyHookContext[] = [];
  if ('phase' in ctx && ctx.phase) blocks.push(ctx as OntologyHookContext);
  else {
    if ((ctx as any).pre) blocks.push((ctx as any).pre);
    if ((ctx as any).post) blocks.push((ctx as any).post);
  }
  const lines: string[] = ['### Scope (structured ontologyHookContext)'];
  for (const c of blocks) {
    lines.push(
      `- Phase **${c.phase}** tool=\`${c.tool}\` pack=\`${c.pack}\` root=\`${c.className}\` tag=\`${c.relevantOntologyTag}\` (n=${c.relevantOntologyCount})`,
    );
    if (c.endpoint?.sandboxId) {
      lines.push(
        `  - Endpoint: provider=${c.endpoint.provider} sandbox=${c.endpoint.sandboxId} shacl=:${c.endpoint.shaclPort} guardrails=:${c.endpoint.guardrailsPort}`,
      );
    }
    lines.push(
      `  - Ontologies: ${c.ontologies.map((o) => o.pack).join(', ') || '(none)'}`,
    );
    lines.push(
      `  - Guardrails: ${c.guardrails
        .slice(0, 8)
        .map((g) => g.name)
        .join(', ')}`,
    );
    lines.push(
      `  - Shapes: ${c.shapes
        .slice(0, 8)
        .map((s) => s.targetClass)
        .join(', ')}`,
    );
    lines.push(
      `  - Relationships: ${c.relationships
        .slice(0, 6)
        .map((r) => r.id)
        .join(', ')}`,
    );
    if (c.linkmlReasoning?.narrative) {
      lines.push(c.linkmlReasoning.narrative);
    }
  }
  return lines.join('\n');
}
