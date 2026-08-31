/**
 * MCP-oriented tool list for verification sandbox / px-kernel (cloud-agent side).
 * Product owns DAYTONA keys; agents call these tools only.
 */

import {
  handlePxSandboxCreate,
  handlePxUploadLinkml,
  handlePxShaclValidate,
  handlePxShaclPreview,
  handlePxSandboxDestroy,
  handleFleetRun,
  handleToolIoGuard,
  handlePxValidateCascade,
  handlePxOntologyScope,
  handlePxPackResolve,
  handlePxPipelineReady,
  handlePxOntologySuggest,
  handleOntologyMode,
  handlePxOntologyUiPreview,
  handlePxFormalPreview,
  handlePxFormalCreate,
  handlePxFormalIngest,
  handlePxFormalFleetPreview,
  handlePxLinkmlUsage,
  handlePxValidationCalls,
} from './handlers.js';
import { registrySyncSnapshot, SANDBOX_TYPES_VERSION } from './types-registry.js';
import { describeDomainMatrix } from './preview-urls.js';

export const VERIFICATION_MCP_TOOLS = [
  {
    name: 'px_load',
    description: 'Describe verification pack config (provider, packing policy, SHACL port).',
  },
  {
    name: 'fleet_run',
    description: 'Run packed multi-service verification with optional retry-until-pass.',
  },
  {
    name: 'tool_io_guard',
    description:
      'Pre/post structured tool I/O validation; cascade SHACL → Lean → GraphQL when enforceSchema. Returns ontologyHookContext + linkmlReasoning (classes, relationships, mutations, resolvers).',
  },
  {
    name: 'px_validate_cascade',
    description:
      'Full validation cascade on a JSON instance: SHACL then Lean then GraphQL for a LinkML pack (default oteemo Engagement).',
  },
  {
    name: 'px_ontology_scope',
    description:
      'Always-on cheap scope: relevantOntologyTag + ontologies/shapes/relationships/guardrails for pack (no pySHACL). Use before domain answers (skydio/oteemo).',
  },
  {
    name: 'px_pipeline_ready',
    description:
      'Check LinkML artifacts + ontologyEnforcement; optional live sandbox SHACL probe. Returns ready flag and ontologyHookContext.',
  },
  {
    name: 'px_pack_resolve',
    description: 'Resolve LinkML pack + root class from text/tool/pack argument (skydio|oteemo|verifier-fleet).',
  },
  {
    name: 'px_linkml_usage',
    description:
      'List recent LinkML usage log: when tool_io_guard/cascade ran, which classes/resolvers/mutations were used, and narrative reasoning.',
  },
  {
    name: 'px_validation_calls',
    description:
      'List formal validation I/O from host SurrealDB (validation_call + endpoint_io): SHACL/Lean/GraphQL/Guardrails request/response logs for UI and agents.',
  },
  {
    name: 'px_sandbox_create',
    description:
      'Create packed verification sandbox (Daytona default) with multi-service ports 7000–7003 and SHACL server on 7004. Product holds cloud keys.',
  },
  {
    name: 'px_upload_linkml',
    description:
      'Upload LinkML + generated SHACL (.px pack) into the active sandbox via SDK upload (not agent keys). Host regenerates artifacts then restarts/reloads SHACL server.',
  },
  {
    name: 'px_shacl_validate',
    description:
      'Validate a JSON instance against in-sandbox SHACL (POST :7004/validate). Happy/sad dual-gate path.',
  },
  {
    name: 'px_shacl_preview',
    description:
      'Mint a Daytona signed preview URL for SHACL port 7004 (host→sandbox HTTP, short TTL).',
  },
  {
    name: 'px_sandbox_destroy',
    description: 'Destroy the active packed verification sandbox.',
  },
  {
    name: 'px_ontology_mode',
    description:
      'Set ontologyEnforcement or ontologyEditing (on/off/status). Maps to /ontology and /ontology-edit.',
  },
  {
    name: 'px_ontology_suggest',
    description:
      'Propose LinkML/Surreal ontology fixes from SHACL violations (requires ontologyEditing ON).',
  },
  {
    name: 'px_ontology_ui_preview',
    description:
      'Mint friendly/raw preview URL for formal sandbox React Flow ontology viewer (port 7005).',
  },
  {
    name: 'px_formal_create',
    description:
      'Create formal (S2) stack: LinkML diagram viewer + verifier-fleet under formal role. Local formal-equivalent when Daytona unavailable.',
  },
  {
    name: 'px_formal_ingest',
    description:
      'Ingest customer LinkML pack into active formal stack; rebuild ontology-state and re-serve diagram + fleet.',
  },
  {
    name: 'px_formal_preview',
    description:
      'Mint formal-role preview for ontology UI (7005), validate API (7004), or fleet UI (7006).',
  },
  {
    name: 'px_formal_fleet_preview',
    description: 'Mint formal-role preview URL for verifier-fleet surface (port 7006).',
  },
  {
    name: 'px_sandbox_types',
    description:
      'Return SandboxTypeRegistry snapshot (roles, ports, egress, domains) for lifecycle sync.',
  },
] as const;

export function verificationMcpManifest() {
  return {
    server: 'cloud-agent-verification',
    tools: VERIFICATION_MCP_TOOLS,
    packing: 'multi-role-synced',
    sandboxTypesVersion: SANDBOX_TYPES_VERSION,
    providers: ['daytona', 'e2b', 'mock'],
    shaclPort: 7004,
    ontologyUiPort: 7005,
    remotePxRoot: process.env.REMOTE_VERIFIER_ROOT
      ? `${process.env.REMOTE_VERIFIER_ROOT}/px`
      : '/home/daytona/verifier/px',
    domainMatrix: describeDomainMatrix(),
    registry: registrySyncSnapshot(),
    note: 'Roles editor|formal|agent|legacy-packed stay in sync with ontology lifecycle. Friendly domains via SANDBOX_DOMAIN_BASE + PREVIEW_MODE.',
  };
}

export const VERIFICATION_MCP_SCHEMAS: Record<
  string,
  { description: string; inputSchema: Record<string, unknown> }
> = {
  px_load: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_load')!.description,
    inputSchema: { type: 'object', properties: {} },
  },
  px_sandbox_create: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_sandbox_create')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['daytona', 'e2b', 'mock'] },
        forceMock: { type: 'boolean', default: false },
        pxRoot: { type: 'string', description: 'Local .px root with linkml/ + generated/' },
        skipShacl: { type: 'boolean', default: false },
      },
    },
  },
  px_upload_linkml: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_upload_linkml')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        pxRoot: { type: 'string' },
        regenerate: { type: 'boolean', default: true },
      },
    },
  },
  px_shacl_validate: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_shacl_validate')!.description,
    inputSchema: {
      type: 'object',
      required: ['data'],
      properties: {
        data: { type: 'object', description: 'JSON instance to validate' },
        pack: { type: 'string', default: 'verifier-fleet' },
        className: { type: 'string' },
      },
    },
  },
  px_shacl_preview: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_shacl_preview')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        expiresInSeconds: { type: 'number', default: 300 },
      },
    },
  },
  px_sandbox_destroy: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_sandbox_destroy')!.description,
    inputSchema: { type: 'object', properties: {} },
  },
  fleet_run: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'fleet_run')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        forceMock: { type: 'boolean', default: true },
        maxRetries: { type: 'number', default: 3 },
        forceFail: { type: 'boolean', default: false },
        backends: {
          type: 'array',
          items: { type: 'string', enum: ['lean', 'haskell', 'boundaryml'] },
        },
      },
    },
  },
  tool_io_guard: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'tool_io_guard')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        tool: { type: 'string' },
        phase: { type: 'string', enum: ['pre', 'post', 'both'], default: 'both' },
        payload: {},
        result: {},
        enforceSchema: {
          type: 'boolean',
          default: true,
          description: 'Default true (always-on). Set false only to opt out of cascade.',
        },
        pack: { type: 'string' },
        className: { type: 'string' },
        layers: {
          type: 'array',
          items: { type: 'string', enum: ['shacl', 'lean', 'graphql'] },
        },
        shortCircuit: { type: 'boolean', default: true },
      },
    },
  },
  px_ontology_scope: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_ontology_scope')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        pack: { type: 'string' },
        className: { type: 'string' },
        tool: { type: 'string' },
        text: { type: 'string', description: 'Free text for pack auto-resolve' },
        payload: {},
        phase: { type: 'string', enum: ['pre', 'post'], default: 'pre' },
      },
    },
  },
  px_pipeline_ready: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_pipeline_ready')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        packs: { type: 'array', items: { type: 'string' } },
        live: { type: 'boolean', default: false },
        text: { type: 'string' },
      },
    },
  },
  px_pack_resolve: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_pack_resolve')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        pack: { type: 'string' },
        className: { type: 'string' },
        tool: { type: 'string' },
        text: { type: 'string' },
        payload: {},
      },
    },
  },
  px_validate_cascade: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_validate_cascade')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        data: {},
        pack: { type: 'string', default: 'oteemo' },
        className: { type: 'string', default: 'Engagement' },
        layers: {
          type: 'array',
          items: { type: 'string', enum: ['shacl', 'lean', 'graphql'] },
        },
        shortCircuit: { type: 'boolean', default: true },
        force: { type: 'boolean', default: false },
      },
      required: ['data'],
    },
  },
  px_ontology_mode: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_ontology_mode')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['enforce', 'edit'], default: 'enforce' },
        action: { type: 'string', enum: ['on', 'off', 'status', 'toggle'], default: 'status' },
      },
    },
  },
  px_ontology_suggest: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_ontology_suggest')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        violations: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              title: { type: 'string' },
              reason: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
  px_ontology_ui_preview: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_ontology_ui_preview')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        expiresInSeconds: { type: 'number', default: 300 },
        role: { type: 'string', enum: ['formal', 'legacy-packed'], default: 'formal' },
      },
    },
  },
  px_formal_create: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_formal_create')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string', default: 'acme-fleet' },
        pxRoot: { type: 'string' },
        ontologyPort: { type: 'number' },
        fleetPort: { type: 'number' },
        assistantUiOrigin: { type: 'string' },
        forceLocal: {
          type: 'boolean',
          default: false,
          description: 'Skip Daytona; use local formal-equivalent only',
        },
        forceMock: { type: 'boolean', default: false },
      },
    },
  },
  px_formal_ingest: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_formal_ingest')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        customerId: { type: 'string' },
        pxRoot: { type: 'string' },
        ontologyPort: { type: 'number' },
        fleetPort: { type: 'number' },
      },
    },
  },
  px_formal_preview: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_formal_preview')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        app: { type: 'string', enum: ['ontology', 'validate', 'fleet'], default: 'ontology' },
        expiresInSeconds: { type: 'number', default: 300 },
      },
    },
  },
  px_formal_fleet_preview: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_formal_fleet_preview')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        expiresInSeconds: { type: 'number', default: 300 },
      },
    },
  },
  px_sandbox_types: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_sandbox_types')!.description,
    inputSchema: { type: 'object', properties: {} },
  },
  px_linkml_usage: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_linkml_usage')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 50 },
        pack: { type: 'string' },
      },
    },
  },
  px_validation_calls: {
    description: VERIFICATION_MCP_TOOLS.find((t) => t.name === 'px_validation_calls')!.description,
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', default: 40 },
        pack: { type: 'string' },
        tool: { type: 'string' },
        ok: { type: 'boolean' },
        callId: { type: 'string' },
        includeEndpointIo: { type: 'boolean', default: true },
      },
    },
  },
};

export async function callVerificationMcpTool(
  name: string,
  args: Record<string, unknown> = {},
): Promise<unknown> {
  switch (name) {
    case 'px_load':
      return verificationMcpManifest();
    case 'px_sandbox_create':
      return handlePxSandboxCreate({
        provider: args.provider as 'daytona' | 'e2b' | 'mock' | undefined,
        forceMock: Boolean(args.forceMock),
        pxRoot: args.pxRoot as string | undefined,
        skipShacl: Boolean(args.skipShacl),
      });
    case 'px_upload_linkml':
      return handlePxUploadLinkml({
        pxRoot: args.pxRoot as string | undefined,
        regenerate: args.regenerate as boolean | undefined,
      });
    case 'px_shacl_validate':
      return handlePxShaclValidate({
        data: args.data,
        pack: args.pack as string | undefined,
        className: args.className as string | undefined,
        force: Boolean(args.force),
      });
    case 'px_shacl_preview':
      return handlePxShaclPreview({
        expiresInSeconds: args.expiresInSeconds as number | undefined,
      });
    case 'px_sandbox_destroy':
      return handlePxSandboxDestroy();
    case 'fleet_run':
      return handleFleetRun({
        forceMock: args.forceMock !== false,
        maxRetries: args.maxRetries as number | undefined,
        forceFail: Boolean(args.forceFail),
        backends: args.backends as string[] | undefined,
      });
    case 'tool_io_guard':
      return handleToolIoGuard({
        tool: args.tool as string | undefined,
        phase: args.phase as 'pre' | 'post' | 'both' | undefined,
        payload: args.payload,
        result: args.result,
        // default true when omitted
        enforceSchema: args.enforceSchema === undefined ? true : Boolean(args.enforceSchema),
        pack: args.pack as string | undefined,
        className: args.className as string | undefined,
        layers: args.layers as Array<'shacl' | 'lean' | 'graphql'> | undefined,
        shortCircuit: args.shortCircuit !== false,
      });
    case 'px_validate_cascade':
      return handlePxValidateCascade({
        data: args.data,
        pack: args.pack as string | undefined,
        className: args.className as string | undefined,
        layers: args.layers as Array<'shacl' | 'lean' | 'graphql'> | undefined,
        shortCircuit: args.shortCircuit !== false,
        force: Boolean(args.force),
      });
    case 'px_ontology_scope':
      return handlePxOntologyScope({
        pack: args.pack as string | undefined,
        className: args.className as string | undefined,
        tool: args.tool as string | undefined,
        text: args.text as string | undefined,
        payload: args.payload,
        phase: args.phase as 'pre' | 'post' | undefined,
      });
    case 'px_pipeline_ready':
      return handlePxPipelineReady({
        packs: args.packs as string[] | undefined,
        live: Boolean(args.live),
        text: args.text as string | undefined,
      });
    case 'px_pack_resolve':
      return handlePxPackResolve({
        pack: args.pack as string | undefined,
        className: args.className as string | undefined,
        tool: args.tool as string | undefined,
        text: args.text as string | undefined,
        payload: args.payload,
      });
    case 'px_ontology_mode':
      return handleOntologyMode({
        target: args.target as 'enforce' | 'edit' | undefined,
        action: args.action as string | undefined,
      });
    case 'px_ontology_suggest':
      return handlePxOntologySuggest({
        violations: args.violations as
          | Array<{ id?: string; title?: string; reason?: string; message?: string }>
          | undefined,
      });
    case 'px_ontology_ui_preview':
      return handlePxOntologyUiPreview({
        expiresInSeconds: args.expiresInSeconds as number | undefined,
        role: args.role as 'formal' | 'legacy-packed' | undefined,
      });
    case 'px_formal_create':
      return handlePxFormalCreate({
        customerId: args.customerId as string | undefined,
        pxRoot: args.pxRoot as string | undefined,
        ontologyPort: args.ontologyPort as number | undefined,
        fleetPort: args.fleetPort as number | undefined,
        assistantUiOrigin: args.assistantUiOrigin as string | undefined,
        forceLocal: Boolean(args.forceLocal),
        forceMock: Boolean(args.forceMock),
        provider: args.provider as 'daytona' | 'e2b' | 'mock' | undefined,
      });
    case 'px_formal_ingest':
      return handlePxFormalIngest({
        customerId: args.customerId as string | undefined,
        pxRoot: args.pxRoot as string | undefined,
        ontologyPort: args.ontologyPort as number | undefined,
        fleetPort: args.fleetPort as number | undefined,
        assistantUiOrigin: args.assistantUiOrigin as string | undefined,
        forceLocal: Boolean(args.forceLocal),
        forceMock: Boolean(args.forceMock),
      });
    case 'px_formal_preview':
      return handlePxFormalPreview({
        expiresInSeconds: args.expiresInSeconds as number | undefined,
        app: args.app as 'ontology' | 'validate' | 'fleet' | undefined,
      });
    case 'px_formal_fleet_preview':
      return handlePxFormalFleetPreview({
        expiresInSeconds: args.expiresInSeconds as number | undefined,
      });
    case 'px_sandbox_types':
      return {
        ok: true,
        version: SANDBOX_TYPES_VERSION,
        snapshot: registrySyncSnapshot(),
        domainMatrix: describeDomainMatrix(),
      };
    case 'px_linkml_usage':
      return handlePxLinkmlUsage({
        limit: args.limit as number | undefined,
        pack: args.pack as string | undefined,
      });
    case 'px_validation_calls':
      return handlePxValidationCalls({
        limit: args.limit as number | undefined,
        pack: args.pack as string | undefined,
        tool: args.tool as string | undefined,
        ok: args.ok as boolean | undefined,
        callId: args.callId as string | undefined,
        includeEndpointIo:
          args.includeEndpointIo === undefined
            ? true
            : Boolean(args.includeEndpointIo),
      });
    default:
      return { ok: false, error: `unknown verification tool: ${name}` };
  }
}
