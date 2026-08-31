/**
 * Structured LinkML reasoning: classes, relationships, mutations, resolvers.
 * Used by tool_io_guard / cascade for agent-facing explanations.
 */
import fs from 'fs';
import path from 'path';
import { resolvePxRoot } from './px-pack.js';

export interface ReasoningClass {
  name: string;
  used: boolean;
  reason: string;
}

export interface ReasoningRelationship {
  id: string;
  sourceType: string;
  field: string;
  targetType: string;
  resolver?: string;
  used: boolean;
  reason: string;
}

export interface ReasoningResolver {
  name: string;
  kind: 'type' | 'field' | 'query';
  type?: string;
  field?: string;
  used: boolean;
  reason: string;
}

export interface ReasoningMutation {
  name: string;
  args: string;
  returnType: string;
  used: boolean;
  reason: string;
}

export interface LinkmlReasoning {
  pack: string;
  rootClass: string;
  tool: string;
  classes: ReasoningClass[];
  relationships: ReasoningRelationship[];
  resolvers: ReasoningResolver[];
  mutations: ReasoningMutation[];
  classesUsed: string[];
  resolversUsed: string[];
  mutationsReferenced: string[];
  relationshipsUsed: string[];
  narrative: string;
  artifacts: {
    resolversPath?: string;
    leanRulesPath?: string;
    graphqlPath?: string;
    shaclPath?: string;
  };
}

function packNorm(pack?: string): string {
  return String(pack || 'verifier-fleet')
    .toLowerCase()
    .replace(/_/g, '-');
}

function packFile(pack: string): string {
  return pack === 'oteemo-devsecops' ? 'oteemo' : pack;
}

function defaultClass(pack: string): string {
  if (pack === 'oteemo' || pack === 'oteemo-devsecops') return 'Engagement';
  if (pack === 'skydio') return 'IncidentPostmortemReport';
  return 'VerifierFleet';
}

function loadJson(p: string): unknown {
  if (!fs.existsSync(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/** Types present in payload given class field map (range classes). */
export function presentTypes(
  data: unknown,
  root: string,
  classFields: Map<string, Array<{ name: string; range: string }>>,
): Set<string> {
  const out = new Set<string>();
  function walk(obj: unknown, cname: string) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    out.add(cname);
    const rec = obj as Record<string, unknown>;
    const fields = classFields.get(cname) || [];
    for (const f of fields) {
      const val = rec[f.name];
      if (val === undefined || val === null) continue;
      const range = f.range;
      if (!range || range[0] !== range[0].toUpperCase()) continue;
      if (Array.isArray(val)) {
        for (const item of val) walk(item, range);
      } else {
        walk(val, range);
      }
    }
  }
  walk(data, root);
  out.add(root);
  return out;
}

/** Parse `type Mutation { ... }` field signatures from GraphQL SDL. */
export function parseGraphqlMutations(
  sdl: string,
): Array<{ name: string; args: string; returnType: string }> {
  const m = sdl.match(/type\s+Mutation\s*\{([\s\S]*?)\n\}/);
  if (!m) return [];
  const body = m[1] || '';
  const out: Array<{ name: string; args: string; returnType: string }> = [];
  // writeEngagement(input: WriteEngagementInput!): Engagement!
  const re = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?\s*:\s*([^\s!]+)!?/gm;
  let match: RegExpExecArray | null;
  while ((match = re.exec(body))) {
    out.push({
      name: match[1],
      args: (match[2] || '').replace(/^\(|\)$/g, ''),
      returnType: match[3].replace(/!$/, ''),
    });
  }
  return out;
}

const WRITE_TOOL_RE = /deploy|write|ingest|publish|open_pr|sdlc|batch|create|mutate|update/i;

export function buildLinkmlReasoning(opts: {
  pack?: string;
  className?: string;
  tool?: string;
  data?: unknown;
  pxRoot?: string | null;
}): LinkmlReasoning {
  const pack = packNorm(opts.pack);
  const pf = packFile(pack);
  const rootClass = opts.className || defaultClass(pack);
  const tool = opts.tool || 'unknown';
  const px = resolvePxRoot(opts.pxRoot || undefined);
  const generated = px ? path.join(px, 'generated') : null;

  const resolversPath = generated ? path.join(generated, `${pf}.resolvers.json`) : undefined;
  const leanRulesPath = generated ? path.join(generated, `${pf}.lean-rules.json`) : undefined;
  const graphqlPath = generated ? path.join(generated, `${pf}.graphql`) : undefined;
  const shaclPath = generated ? path.join(generated, `${pf}.shacl.ttl`) : undefined;

  const resolversJson = resolversPath ? (loadJson(resolversPath) as any) : null;
  const rules = leanRulesPath ? (loadJson(leanRulesPath) as any) : null;
  const sdl =
    graphqlPath && fs.existsSync(graphqlPath) ? fs.readFileSync(graphqlPath, 'utf8') : '';

  const classFields = new Map<string, Array<{ name: string; range: string }>>();
  if (rules?.classes) {
    for (const [cname, cdef] of Object.entries(rules.classes as Record<string, any>)) {
      const fields = (cdef.fields || []).map((f: any) => ({
        name: String(f.name),
        range: String(f.range || 'string'),
      }));
      classFields.set(cname, fields);
    }
  }
  if (resolversJson?.fields) {
    for (const f of resolversJson.fields as Array<{ type: string; field: string; range: string }>) {
      const list = classFields.get(f.type) || [];
      if (!list.some((x) => x.name === f.field)) {
        list.push({ name: f.field, range: f.range });
      }
      classFields.set(f.type, list);
    }
  }

  const typesPresent = presentTypes(opts.data, rootClass, classFields);
  const writeTool = WRITE_TOOL_RE.test(tool);

  const classNames = rules?.classes
    ? Object.keys(rules.classes)
    : resolversJson?.types
      ? Object.keys(resolversJson.types)
      : [rootClass];

  const classes: ReasoningClass[] = classNames.map((name) => {
    const used = typesPresent.has(name);
    return {
      name,
      used,
      reason: used
        ? name === rootClass
          ? 'Root class for this validation call'
          : 'Present in tool payload graph'
        : 'Defined in pack schema but not in this payload',
    };
  });

  const relationships: ReasoningRelationship[] = [];
  for (const f of (resolversJson?.fields || []) as Array<{
    type: string;
    field: string;
    range: string;
    multivalued?: boolean;
    resolver?: string;
    joinOn?: string;
  }>) {
    if (!f.range || f.range[0] !== f.range[0].toUpperCase()) continue;
    const used =
      typesPresent.has(f.type) &&
      (typesPresent.has(f.range) ||
        (opts.data &&
          typeof opts.data === 'object' &&
          !Array.isArray(opts.data) &&
          f.type === rootClass &&
          (opts.data as any)[f.field] !== undefined));
    relationships.push({
      id: `${f.type}.${f.field}->${f.range}`,
      sourceType: f.type,
      field: f.field,
      targetType: f.range,
      resolver: f.resolver || undefined,
      used: Boolean(used),
      reason: used
        ? 'Edge present in payload / type graph'
        : 'Schema relationship (not present in this payload)',
    });
  }

  const resolvers: ReasoningResolver[] = [];
  const seenRes = new Set<string>();
  for (const [tname, tdef] of Object.entries((resolversJson?.types || {}) as Record<string, any>)) {
    const rname = tdef?.resolver;
    if (!rname || seenRes.has(rname)) continue;
    seenRes.add(rname);
    const used = typesPresent.has(tname) || typesPresent.has(tdef.class || tname);
    resolvers.push({
      name: String(rname),
      kind: 'type',
      type: tname,
      used,
      reason: used
        ? `Type resolver for ${tname} (instance in payload or root)`
        : `Type resolver registered for ${tname}`,
    });
  }
  for (const f of (resolversJson?.fields || []) as Array<{
    type: string;
    field: string;
    resolver?: string;
  }>) {
    if (!f.resolver || seenRes.has(f.resolver)) continue;
    seenRes.add(f.resolver);
    const used =
      typesPresent.has(f.type) &&
      opts.data &&
      typeof opts.data === 'object' &&
      ((opts.data as any)[f.field] !== undefined || typesPresent.has(f.type));
    resolvers.push({
      name: String(f.resolver),
      kind: 'field',
      type: f.type,
      field: f.field,
      used: Boolean(used),
      reason: used
        ? `Field resolver ${f.type}.${f.field} touched by payload`
        : `Field resolver available for ${f.type}.${f.field}`,
    });
  }

  const mutationsParsed = parseGraphqlMutations(sdl);
  const mutations: ReasoningMutation[] = mutationsParsed.map((mu) => {
    const returnUsed = typesPresent.has(mu.returnType) || rootClass === mu.returnType;
    const used = returnUsed || (writeTool && returnUsed) || (writeTool && mu.returnType === rootClass);
    // Prefer: used if return type in payload OR (write tool and return matches root)
    const usedFinal =
      typesPresent.has(mu.returnType) ||
      (writeTool && (mu.returnType === rootClass || typesPresent.has(rootClass)));
    return {
      name: mu.name,
      args: mu.args,
      returnType: mu.returnType,
      used: usedFinal,
      reason: usedFinal
        ? writeTool
          ? `Write-like tool=${tool}; mutation returns ${mu.returnType}`
          : `Payload/root relates to mutation return type ${mu.returnType}`
        : `Mutation available on GraphQL write surface (return ${mu.returnType})`,
    };
  });

  const classesUsed = classes.filter((c) => c.used).map((c) => c.name);
  const resolversUsed = resolvers.filter((r) => r.used).map((r) => r.name);
  const mutationsReferenced = mutations.filter((m) => m.used).map((m) => m.name);
  const relationshipsUsed = relationships.filter((r) => r.used).map((r) => r.id);

  const narrative = [
    `### LinkML reasoning (pack=\`${pack}\` root=\`${rootClass}\` tool=\`${tool}\`)`,
    `- **Classes used** (${classesUsed.length}): ${classesUsed.join(', ') || '—'}`,
    `- **Relationships used** (${relationshipsUsed.length}): ${relationshipsUsed.slice(0, 12).join(', ') || '—'}${relationshipsUsed.length > 12 ? '…' : ''}`,
    `- **Resolvers used** (${resolversUsed.length}): ${resolversUsed.join(', ') || '—'}`,
    `- **Mutations referenced** (${mutationsReferenced.length}): ${mutationsReferenced.join(', ') || '—'}`,
    mutations.length
      ? `- All mutations in SDL: ${mutations.map((m) => `${m.name}→${m.returnType}`).join(', ')}`
      : '- No `type Mutation` in pack GraphQL (or SDL missing)',
    `- Artifacts: resolvers=${resolversPath && fs.existsSync(resolversPath) ? 'ok' : 'missing'}, lean-rules=${leanRulesPath && fs.existsSync(leanRulesPath) ? 'ok' : 'missing'}, graphql=${graphqlPath && fs.existsSync(graphqlPath) ? 'ok' : 'missing'}`,
  ].join('\n');

  return {
    pack,
    rootClass,
    tool,
    classes,
    relationships,
    resolvers,
    mutations,
    classesUsed,
    resolversUsed,
    mutationsReferenced,
    relationshipsUsed,
    narrative,
    artifacts: {
      resolversPath: resolversPath && fs.existsSync(resolversPath) ? resolversPath : undefined,
      leanRulesPath: leanRulesPath && fs.existsSync(leanRulesPath) ? leanRulesPath : undefined,
      graphqlPath: graphqlPath && fs.existsSync(graphqlPath) ? graphqlPath : undefined,
      shaclPath: shaclPath && fs.existsSync(shaclPath) ? shaclPath : undefined,
    },
  };
}
