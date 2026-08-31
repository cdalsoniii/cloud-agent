import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tool, type PluginInput } from '@opencode-ai/plugin';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
const CLOUD_AGENT_ROOT = join(PLUGIN_ROOT, '..');
const DEFAULT_GATEWAY_ROOT = join(CLOUD_AGENT_ROOT, '../../02-products/surreal-graphql-gateway');

type DriftReport = {
  inSync: boolean;
  mismatches: Array<{ area: string; message: string }>;
  lastRun?: string;
  introspectedQueryFields?: string[];
};

type PxConfig = {
  ontologyEditing?: boolean;
  updatedAt?: string;
};

function pxConfigPath(): string {
  return join(CLOUD_AGENT_ROOT, '.px/config.json');
}

function readPxConfig(): PxConfig {
  const path = pxConfigPath();
  if (!existsSync(path)) return { ontologyEditing: false };
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PxConfig;
  } catch {
    return { ontologyEditing: false };
  }
}

function writePxConfig(ontologyEditing: boolean): PxConfig {
  const path = pxConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const payload: PxConfig = {
    ontologyEditing,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return payload;
}

function resolveGatewayRoot(): string {
  const pointersPath = join(CLOUD_AGENT_ROOT, '.px/pointers.yaml');
  if (existsSync(pointersPath)) {
    const raw = readFileSync(pointersPath, 'utf8');
    const match = raw.match(/surreal_graphql_gateway:[\s\S]*?root:\s*(.+)/);
    if (match?.[1]) {
      const rel = match[1].trim();
      return join(CLOUD_AGENT_ROOT, rel);
    }
  }
  return DEFAULT_GATEWAY_ROOT;
}

function runInGateway(command: string, gatewayRoot: string): string {
  return execSync(command, {
    cwd: gatewayRoot,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

function readDriftReport(gatewayRoot: string): DriftReport | null {
  const path = join(gatewayRoot, '.px/graphql/generated/drift-report.json');
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf8')) as DriftReport;
}

function surrealReachable(gatewayRoot: string): boolean {
  try {
    runInGateway('curl -sf -o /dev/null http://127.0.0.1:8000/health', gatewayRoot);
    return true;
  } catch {
    return false;
  }
}

export default {
  id: 'surreal-schema',
  server: async (input: PluginInput) => {
    const gatewayRoot = resolveGatewayRoot();

    return {
      tool: {
        schema_status: tool({
          description:
            'Read Surreal GraphQL schema drift status from surreal-graphql-gateway (.px/graphql/generated/drift-report.json)',
          args: {},
          async execute() {
            const drift = readDriftReport(gatewayRoot);
            const surrealUp = surrealReachable(gatewayRoot);
            const canApply = surrealUp;
            const canSync = surrealUp;

            if (!drift) {
              return {
                title: 'Schema status',
                output: JSON.stringify(
                  {
                    gatewayRoot,
                    surrealUp,
                    canApply,
                    canSync,
                    inSync: null,
                    driftSummary: 'No drift report yet — run schema_sync',
                    paths: {
                      manifest: join(gatewayRoot, '.px/graphql/manifest.yaml'),
                      surrealkit: join(gatewayRoot, '.px/database'),
                      surreal: join(gatewayRoot, '.px/graphql/surreal'),
                      apollo: join(gatewayRoot, '.px/graphql/apollo'),
                      wundergraph: join(gatewayRoot, '.px/graphql/wundergraph'),
                      generated: join(gatewayRoot, '.px/graphql/generated'),
                    },
                  },
                  null,
                  2,
                ),
              };
            }

            return {
              title: drift.inSync ? 'Schema in sync' : 'Schema drift detected',
              output: JSON.stringify(
                {
                  gatewayRoot,
                  surrealUp,
                  canApply,
                  canSync,
                  inSync: drift.inSync,
                  driftSummary: drift.inSync
                    ? 'All federation artifacts match Surreal introspection'
                    : drift.mismatches.map((m) => `${m.area}: ${m.message}`).join('; '),
                  lastRun: drift.lastRun,
                  introspectedQueryFields: drift.introspectedQueryFields,
                  mismatches: drift.mismatches,
                },
                null,
                2,
              ),
            };
          },
        }),

        schema_apply: tool({
          description:
            'Apply .px/database SurrealKit schema to local SurrealDB (surrealkit sync). Blocked when ontology editing is OFF.',
          args: {
            confirm: tool.schema
              .boolean()
              .optional()
              .describe('Set true to confirm destructive DDL apply'),
          },
          async execute(args, context) {
            if (!readPxConfig().ontologyEditing) {
              return {
                title: 'Ontology editing disabled',
                output:
                  'Set ontology editing ON (TUI breadcrumb click or ontology_set_editing tool) before applying schema changes.',
              };
            }

            if (!args.confirm) {
              await context.ask({
                permission: 'surreal_schema_apply',
                patterns: ['*'],
                always: ['schema_apply'],
                metadata: { gatewayRoot },
              });
            }

            const output = runInGateway('npm run surreal:sync', gatewayRoot);
            return { title: 'Schema applied', output };
          },
        }),

        ontology_status: tool({
          description: 'Read ontology editing mode from .px/config.json (shown in OpenCode TUI breadcrumb)',
          args: {},
          async execute() {
            const cfg = readPxConfig();
            return {
              title: cfg.ontologyEditing ? 'Ontology editing ON' : 'Ontology editing OFF',
              output: JSON.stringify(
                {
                  ontologyEditing: !!cfg.ontologyEditing,
                  configPath: pxConfigPath(),
                  updatedAt: cfg.updatedAt,
                  envOverride: process.env.PX_ONTOLOGY_EDIT ?? null,
                },
                null,
                2,
              ),
            };
          },
        }),

        ontology_set_editing: tool({
          description: 'Enable or disable ontology editing (TUI breadcrumb + schema_apply gate)',
          args: {
            enabled: tool.schema.boolean().describe('true = allow schema edits; false = read-only'),
          },
          async execute(args) {
            const cfg = writePxConfig(args.enabled);
            return {
              title: args.enabled ? 'Ontology editing enabled' : 'Ontology editing disabled',
              output: JSON.stringify(cfg, null, 2),
            };
          },
        }),

        schema_sync: tool({
          description:
            'Full schema sync: apply Surreal DDL, introspect, update Apollo/WunderGraph artifacts, compose supergraph',
          args: {
            confirm: tool.schema
              .boolean()
              .optional()
              .describe('Set true to confirm full schema propagation'),
          },
          async execute(args, context) {
            if (!args.confirm) {
              await context.ask({
                permission: 'surreal_schema_sync',
                patterns: ['*'],
                always: ['schema_sync'],
                metadata: { gatewayRoot },
              });
            }

            const output = runInGateway('npm run schema:sync', gatewayRoot);
            const drift = readDriftReport(gatewayRoot);
            return {
              title: drift?.inSync ? 'Schema synced' : 'Schema sync finished with drift',
              output: `${output}\n\n${JSON.stringify(drift, null, 2)}`,
            };
          },
        }),
      },
    };
  },
};
