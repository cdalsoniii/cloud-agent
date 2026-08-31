/**
 * LinkML-derived validation cascade: SHACL → Lean → GraphQL.
 * Used by tool_io_guard and px_validate_cascade.
 */
import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { resolvePxRoot } from './px-pack.js';
import type { ShaclRemoteResult } from './types.js';

export type ValidationLayerName = 'shacl' | 'lean' | 'graphql';

export interface LayerViolation {
  id: string;
  severity: 'blocking' | 'important' | 'info' | string;
  title: string;
  reason: string;
  layer: ValidationLayerName;
  phase?: string;
}

export interface LayerResult {
  layer: ValidationLayerName;
  ok: boolean;
  conforms: boolean;
  engine: string;
  skipped?: boolean;
  skipReason?: string;
  violations: LayerViolation[];
  durationMs: number;
  raw?: unknown;
}

export interface CascadeResult {
  ok: boolean;
  pack: string;
  className: string;
  layers: {
    shacl?: LayerResult;
    lean?: LayerResult;
    graphql?: LayerResult;
  };
  violations: LayerViolation[];
  durationMs: number;
  shortCircuited?: boolean;
}

function packNorm(pack?: string): string {
  return String(pack || 'verifier-fleet')
    .toLowerCase()
    .replace(/_/g, '-');
}

function defaultClass(pack: string): string {
  if (pack === 'oteemo' || pack === 'oteemo-devsecops') return 'Engagement';
  if (pack === 'skydio') return 'IncidentPostmortemReport';
  return 'VerifierFleet';
}

function leanRulesPath(pxRoot: string, pack: string): string {
  return path.join(pxRoot, 'generated', `${pack === 'oteemo-devsecops' ? 'oteemo' : pack}.lean-rules.json`);
}

function resolversPath(pxRoot: string, pack: string): string {
  const p = pack === 'oteemo-devsecops' ? 'oteemo' : pack;
  return path.join(pxRoot, 'generated', `${p}.resolvers.json`);
}

function graphqlPath(pxRoot: string, pack: string): string {
  const p = pack === 'oteemo-devsecops' ? 'oteemo' : pack;
  return path.join(pxRoot, 'generated', `${p}.graphql`);
}

/** Host Lean layer: apply generated lean-rules.json well-formedness. */
export function invokeLeanValidate(body: {
  data: unknown;
  pack?: string;
  className?: string;
  pxRoot?: string | null;
}): LayerResult {
  const started = Date.now();
  const pack = packNorm(body.pack);
  const className = body.className || defaultClass(pack);
  const px = resolvePxRoot(body.pxRoot || undefined);
  if (!px) {
    return {
      layer: 'lean',
      ok: false,
      conforms: false,
      engine: 'unavailable',
      violations: [
        {
          id: 'lean-no-px',
          severity: 'blocking',
          title: '[Lean] px root missing',
          reason: 'resolvePxRoot failed',
          layer: 'lean',
        },
      ],
      durationMs: Date.now() - started,
    };
  }
  const rulesFile = leanRulesPath(px, pack === 'oteemo-devsecops' ? 'oteemo' : pack);
  if (!fs.existsSync(rulesFile)) {
    return {
      layer: 'lean',
      ok: false,
      conforms: false,
      engine: 'unavailable',
      violations: [
        {
          id: 'lean-no-rules',
          severity: 'blocking',
          title: '[Lean] rules missing',
          reason: `expected ${rulesFile} (run generate-linkml-artifacts / linkml-to-lean.py)`,
          layer: 'lean',
        },
      ],
      durationMs: Date.now() - started,
    };
  }

  // Prefer Python checker co-located with generator for single source of truth
  const scriptCandidates = [
    path.resolve(
      process.env.HOME || '',
      'Documents/Personal/employment/partners/experiments/02-products/assistant-ui/scripts/linkml-to-lean.py',
    ),
    path.resolve(process.cwd(), '../02-products/assistant-ui/scripts/linkml-to-lean.py'),
  ];
  const script = scriptCandidates.find((s) => fs.existsSync(s));
  const rules = JSON.parse(fs.readFileSync(rulesFile, 'utf8')) as {
    root?: string;
    enums?: Record<string, string[]>;
    classes?: Record<
      string,
      {
        fields?: Array<{
          name: string;
          range?: string;
          required?: boolean;
          multivalued?: boolean;
        }>;
      }
    >;
  };

  const violations: LayerViolation[] = [];
  const enums = rules.enums || {};
  const classes = rules.classes || {};

  function walk(obj: unknown, cname: string, pth: string) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
      violations.push({
        id: `lean-${pth}-type`,
        severity: 'blocking',
        title: '[Lean] expected object',
        reason: `${pth}: expected object for ${cname}`,
        layer: 'lean',
      });
      return;
    }
    const rec = obj as Record<string, unknown>;
    const cr = classes[cname];
    if (!cr) return;
    for (const f of cr.fields || []) {
      const val = rec[f.name];
      const fpath = `${pth}.${f.name}`;
      const rng = f.range || 'string';
      if (f.required && (val === undefined || val === null || val === '' || (Array.isArray(val) && val.length === 0))) {
        violations.push({
          id: `lean-${fpath}-required`,
          severity: 'blocking',
          title: '[Lean] required field missing',
          reason: `${fpath}: required by ${cname}`,
          layer: 'lean',
        });
        continue;
      }
      if (val === undefined || val === null) continue;
      if (f.multivalued) {
        if (!Array.isArray(val)) {
          violations.push({
            id: `lean-${fpath}-list`,
            severity: 'blocking',
            title: '[Lean] expected list',
            reason: `${fpath}: multivalued must be list`,
            layer: 'lean',
          });
          continue;
        }
        if (classes[rng]) {
          val.forEach((item, i) => walk(item, rng, `${fpath}[${i}]`));
        } else if (enums[rng]) {
          val.forEach((item, i) => {
            if (!enums[rng].includes(String(item))) {
              violations.push({
                id: `lean-${fpath}-${i}-enum`,
                severity: 'blocking',
                title: '[Lean] enum violation',
                reason: `${fpath}[${i}]: ${JSON.stringify(item)} not in ${JSON.stringify(enums[rng])}`,
                layer: 'lean',
              });
            }
          });
        }
      } else if (enums[rng] && !enums[rng].includes(String(val))) {
        violations.push({
          id: `lean-${fpath}-enum`,
          severity: 'blocking',
          title: '[Lean] enum violation',
          reason: `${fpath}: ${JSON.stringify(val)} not in ${JSON.stringify(enums[rng])}`,
          layer: 'lean',
        });
      } else if (classes[rng]) {
        walk(val, rng, fpath);
      } else if ((rng === 'boolean' || rng === 'bool') && typeof val !== 'boolean') {
        violations.push({
          id: `lean-${fpath}-bool`,
          severity: 'blocking',
          title: '[Lean] expected boolean',
          reason: `${fpath}: expected bool`,
          layer: 'lean',
        });
      } else if ((rng === 'integer' || rng === 'int') && typeof val !== 'number') {
        violations.push({
          id: `lean-${fpath}-int`,
          severity: 'blocking',
          title: '[Lean] expected integer',
          reason: `${fpath}: expected int`,
          layer: 'lean',
        });
      }
    }
  }

  walk(body.data, className, className);
  const ok = violations.length === 0;

  // Optional: note that Lean sources exist (lake build is offline gate)
  const leanSrc = path.join(
    process.cwd(),
    'config/verification/lean/PxCloudAgent/Generated',
    `${pack === 'oteemo' || pack === 'oteemo-devsecops' ? 'Oteemo' : snakePascal(pack)}.lean`,
  );
  const leanExists = fs.existsSync(leanSrc);

  return {
    layer: 'lean',
    ok,
    conforms: ok,
    engine: leanExists ? 'lean-rules-v1+sources' : 'lean-rules-v1',
    violations,
    durationMs: Date.now() - started,
    raw: { rulesFile, leanSrc: leanExists ? leanSrc : null, script: script || null },
  };
}

function snakePascal(s: string): string {
  return s
    .split(/[-_]/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('');
}

/** GraphQL final layer: SDL present + resolver map complete for nested class fields. */
export function invokeGraphqlValidate(body: {
  data: unknown;
  pack?: string;
  className?: string;
  pxRoot?: string | null;
}): LayerResult {
  const started = Date.now();
  const pack = packNorm(body.pack);
  const className = body.className || defaultClass(pack);
  const px = resolvePxRoot(body.pxRoot || undefined);
  const violations: LayerViolation[] = [];
  if (!px) {
    return {
      layer: 'graphql',
      ok: false,
      conforms: false,
      engine: 'unavailable',
      violations: [
        {
          id: 'gql-no-px',
          severity: 'blocking',
          title: '[GraphQL] px root missing',
          reason: 'resolvePxRoot failed',
          layer: 'graphql',
        },
      ],
      durationMs: Date.now() - started,
    };
  }
  const p = pack === 'oteemo-devsecops' ? 'oteemo' : pack;
  const sdl = graphqlPath(px, p);
  const resFile = resolversPath(px, p);
  if (!fs.existsSync(sdl)) {
    violations.push({
      id: 'gql-no-sdl',
      severity: 'blocking',
      title: '[GraphQL] SDL missing',
      reason: `expected ${sdl}`,
      layer: 'graphql',
    });
  }
  if (!fs.existsSync(resFile)) {
    violations.push({
      id: 'gql-no-resolvers',
      severity: 'blocking',
      title: '[GraphQL] resolvers map missing',
      reason: `expected ${resFile} (LinkML annotations → linkml-to-resolvers.py)`,
      layer: 'graphql',
    });
  }
  let resolvers: {
    complete?: boolean;
    missingResolvers?: unknown[];
    fields?: Array<{ type: string; field: string; range: string; resolver?: string }>;
    types?: Record<string, unknown>;
  } = {};
  if (fs.existsSync(resFile)) {
    resolvers = JSON.parse(fs.readFileSync(resFile, 'utf8')) as typeof resolvers;
    if (resolvers.complete === false) {
      violations.push({
        id: 'gql-incomplete-map',
        severity: 'blocking',
        title: '[GraphQL] resolver map incomplete',
        reason: `missingResolvers=${JSON.stringify(resolvers.missingResolvers || [])}`,
        layer: 'graphql',
      });
    }
  }

  // Instance walk: every class-range field present must have a resolver entry
  const fieldIndex = new Map<string, string | undefined>();
  for (const f of resolvers.fields || []) {
    fieldIndex.set(`${f.type}.${f.field}`, f.resolver);
  }
  const typeNames = new Set(Object.keys(resolvers.types || {}));

  function walk(obj: unknown, typeName: string, pth: string) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    const rec = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (v === null || v === undefined) continue;
      const key = `${typeName}.${k}`;
      if (Array.isArray(v)) {
        // if first element is object, treat as nested class list
        const first = v[0];
        if (first && typeof first === 'object' && !Array.isArray(first)) {
          const resolver = fieldIndex.get(key);
          if (typeNames.size && !resolver) {
            // only enforce if we know nested types
            const maybeRange = (resolvers.fields || []).find((f) => f.type === typeName && f.field === k)?.range;
            if (maybeRange && typeNames.has(maybeRange) && !resolver) {
              violations.push({
                id: `gql-${key}-resolver`,
                severity: 'blocking',
                title: '[GraphQL] missing field resolver',
                reason: `${key} has class range but no resolver in LinkML map`,
                layer: 'graphql',
              });
            }
          }
          const range =
            (resolvers.fields || []).find((f) => f.type === typeName && f.field === k)?.range || '';
          if (range && typeNames.has(range)) {
            v.forEach((item, i) => walk(item, range, `${pth}.${k}[${i}]`));
          }
        }
      } else if (typeof v === 'object') {
        const range =
          (resolvers.fields || []).find((f) => f.type === typeName && f.field === k)?.range || '';
        if (range && typeNames.has(range)) {
          const resolver = fieldIndex.get(key);
          if (!resolver) {
            violations.push({
              id: `gql-${key}-resolver`,
              severity: 'blocking',
              title: '[GraphQL] missing field resolver',
              reason: `${key} → ${range} has no graphql.fieldResolver`,
              layer: 'graphql',
            });
          }
          walk(v, range, `${pth}.${k}`);
        }
      }
    }
  }

  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data) && typeNames.size) {
    walk(body.data, className, className);
  }

  // SDL must mention root type
  if (fs.existsSync(sdl)) {
    const text = fs.readFileSync(sdl, 'utf8');
    if (!text.includes(`type ${className}`) && !text.includes(`type ${className} `)) {
      // gen-graphql may use slightly different naming — soft important if root operation exists
      if (!text.includes(className)) {
        violations.push({
          id: 'gql-root-missing',
          severity: 'important',
          title: '[GraphQL] root type not found in SDL',
          reason: `${className} not found in ${sdl}`,
          layer: 'graphql',
        });
      }
    }
  }

  const blocking = violations.filter((v) => v.severity === 'blocking');
  const ok = blocking.length === 0;
  return {
    layer: 'graphql',
    ok,
    conforms: ok,
    engine: 'linkml-resolvers-v1',
    violations,
    durationMs: Date.now() - started,
    raw: { sdl, resolvers: resFile },
  };
}

export function shaclToLayer(
  r: ShaclRemoteResult,
  phase?: string,
): LayerResult {
  const violations: LayerViolation[] = (r.violations || []).map((v, i) => ({
    id: v.id || `shacl-v${i}`,
    severity: v.severity || 'blocking',
    title: v.title || 'SHACL constraint violation',
    reason: v.reason || 'non-conformant',
    layer: 'shacl' as const,
    phase,
  }));
  if (!r.conforms && violations.length === 0) {
    violations.push({
      id: 'shacl-nonconformant',
      severity: 'blocking',
      title: 'SHACL non-conformant',
      reason: 'conforms=false',
      layer: 'shacl',
      phase,
    });
  }
  return {
    layer: 'shacl',
    ok: Boolean(r.conforms),
    conforms: Boolean(r.conforms),
    engine: r.engine || 'pyshacl',
    violations,
    durationMs: r.durationMs || 0,
    raw: r,
  };
}

export async function runValidationCascade(opts: {
  data: unknown;
  pack?: string;
  className?: string;
  layers?: ValidationLayerName[];
  shortCircuit?: boolean;
  invokeShacl?: (body: {
    data: unknown;
    pack?: string;
    className?: string;
  }) => Promise<ShaclRemoteResult>;
  pxRoot?: string | null;
}): Promise<CascadeResult> {
  const started = Date.now();
  const pack = packNorm(opts.pack);
  const className = opts.className || defaultClass(pack);
  const want = opts.layers?.length ? opts.layers : (['shacl', 'lean', 'graphql'] as ValidationLayerName[]);
  const shortCircuit = opts.shortCircuit !== false;
  const layers: CascadeResult['layers'] = {};
  const violations: LayerViolation[] = [];
  let shortCircuited = false;

  for (const name of want) {
    if (name === 'shacl') {
      if (!opts.invokeShacl) {
        const lr: LayerResult = {
          layer: 'shacl',
          ok: false,
          conforms: false,
          engine: 'unavailable',
          violations: [
            {
              id: 'shacl-no-invoke',
              severity: 'blocking',
              title: '[SHACL] no invokeShacl',
              reason: 'sandbox/provider missing invokeShacl',
              layer: 'shacl',
            },
          ],
          durationMs: 0,
        };
        layers.shacl = lr;
        violations.push(...lr.violations);
        if (shortCircuit) {
          shortCircuited = true;
          break;
        }
        continue;
      }
      const r = await opts.invokeShacl({ data: opts.data, pack, className });
      const lr = shaclToLayer(r);
      layers.shacl = lr;
      violations.push(...lr.violations);
      if (shortCircuit && !lr.ok) {
        shortCircuited = true;
        break;
      }
    } else if (name === 'lean') {
      const lr = invokeLeanValidate({
        data: opts.data,
        pack,
        className,
        pxRoot: opts.pxRoot,
      });
      layers.lean = lr;
      violations.push(...lr.violations);
      if (shortCircuit && !lr.ok) {
        shortCircuited = true;
        break;
      }
    } else if (name === 'graphql') {
      const lr = invokeGraphqlValidate({
        data: opts.data,
        pack,
        className,
        pxRoot: opts.pxRoot,
      });
      layers.graphql = lr;
      violations.push(...lr.violations);
      if (shortCircuit && !lr.ok) {
        shortCircuited = true;
        break;
      }
    }
  }

  const blocking = violations.filter((v) => v.severity === 'blocking');
  return {
    ok: blocking.length === 0,
    pack,
    className,
    layers,
    violations,
    durationMs: Date.now() - started,
    shortCircuited,
  };
}

/** Optional: lake build Generated Oteemo module (offline / smoke). */
export function lakeBuildGeneratedOteemo(timeoutMs = 120_000): {
  ok: boolean;
  exit: number | null;
  sample: string;
} {
  const leanDir = path.resolve(process.cwd(), 'config/verification/lean');
  if (!fs.existsSync(path.join(leanDir, 'lakefile.lean'))) {
    return { ok: false, exit: null, sample: 'no lakefile' };
  }
  const lake =
    process.env.LAKE_BIN ||
    [
      path.resolve(process.cwd(), '.grok-bundle/bin/lake'),
      'lake',
    ].find((c) => c === 'lake' || fs.existsSync(c)) ||
    'lake';
  const r = spawnSync(lake, ['build'], {
    cwd: leanDir,
    encoding: 'utf8',
    timeout: timeoutMs,
    env: { ...process.env },
  });
  return {
    ok: r.status === 0,
    exit: r.status,
    sample: ((r.stdout || '') + (r.stderr || '')).slice(-800),
  };
}
