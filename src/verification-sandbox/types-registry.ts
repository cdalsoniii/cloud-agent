/**
 * Single source of truth: sandbox roles, ports, egress, MCP tools, domains.
 * Ontology lifecycle + sandbox lifecycle + public edge MUST stay in sync.
 *
 * Bump SANDBOX_TYPES_VERSION when changing ports/domains/egress.
 */
import {
  ASSISTANT_UI_WEB_PORT,
  FLEET_UI_PORT,
  GUARDRAILS_PORT,
  ONTOLOGY_UI_PORT,
  OPENCODE_SERVE_PORT,
  SERVICE_PORTS,
  SHACL_PORT,
} from './types.js';

/** Bump with any role/port/domain/egress change — CI sandbox-type-sync checks this. */
export const SANDBOX_TYPES_VERSION = '2026.08.08.3';

export type SandboxRole = 'editor' | 'formal' | 'agent' | 'legacy-packed';

export type SandboxEgress =
  | 'none'
  | 'surreal-write'
  | 'formal-validate'
  | 'mcp-gated'
  | 'demo';

export type DomainAuth = 'none' | 'signed-preview' | 'session-jwt' | 'mtls';

export type PublicSurface =
  | 'none'
  | 'ontology_ui'
  | 'validate_api'
  | 'fleet_ui'
  | 'agent_app'
  | 'opencode_serve';

export type OntologyStage = 'edit' | 'stabilize' | 'consume' | 'demo';

export interface DomainTemplate {
  /** e.g. ontology.{env}.px.example.com — {env} and {base} substituted */
  hostTemplate: string;
  pathPrefix?: string;
  port: number;
  /** If false, mintPreviewUrl must reject public minting */
  public: boolean;
  auth: DomainAuth;
  surface: PublicSurface;
  corsOrigins: string[];
  maxSignedTtlSec: number;
  app: 'ontology' | 'validate' | 'fleet' | 'agent' | 'edit' | 'opencode';
}

export interface SandboxTypeSpec {
  role: SandboxRole;
  ontologyStage: OntologyStage;
  ports: number[];
  egress: SandboxEgress;
  mcpTools: string[];
  domains: DomainTemplate[];
  healthPaths: Record<number, string>;
  description: string;
}

function envName(): string {
  return (process.env.SANDBOX_ENV || process.env.NODE_ENV || 'local').toLowerCase();
}

function domainBase(): string {
  return (
    process.env.SANDBOX_DOMAIN_BASE ||
    process.env.PX_SANDBOX_DOMAIN_BASE ||
    'px.example.com'
  ).replace(/^\./, '');
}

/** Substitute {env} and {base} in host templates. */
export function resolveHostTemplate(template: string): string {
  return template
    .replace(/\{env\}/g, envName())
    .replace(/\{base\}/g, domainBase());
}

export function previewMode(): 'friendly' | 'raw' {
  const m = (process.env.PREVIEW_MODE || 'friendly').toLowerCase();
  return m === 'raw' ? 'raw' : 'friendly';
}

const FORMAL_PORTS = [
  SERVICE_PORTS.lean,
  SERVICE_PORTS.haskell,
  SERVICE_PORTS.boundaryml,
  GUARDRAILS_PORT,
  SHACL_PORT,
  ONTOLOGY_UI_PORT,
  FLEET_UI_PORT,
  ASSISTANT_UI_WEB_PORT,
  OPENCODE_SERVE_PORT,
];

export const SANDBOX_TYPE_REGISTRY: Record<SandboxRole, SandboxTypeSpec> = {
  editor: {
    role: 'editor',
    ontologyStage: 'edit',
    ports: [],
    egress: 'surreal-write',
    mcpTools: [
      'px_editor_create',
      'px_editor_commit',
      'px_ontology_mode',
      'px_load',
    ],
    // No public domains — IP: LinkML edit must not be world-browsable
    domains: [],
    healthPaths: {},
    description:
      'S1: LinkML edit only. Egress: Surreal RC write or host-mediated pull. No public DNS.',
  },

  formal: {
    role: 'formal',
    ontologyStage: 'stabilize',
    ports: FORMAL_PORTS,
    egress: 'formal-validate',
    mcpTools: [
      'px_formal_create',
      'px_formal_ingest',
      'px_formal_validate',
      'px_formal_preview',
      'px_ontology_ui_preview',
      'px_formal_fleet_preview',
      'px_shacl_validate',
      'px_shacl_preview',
      'px_sandbox_create',
      'px_upload_linkml',
      'px_sandbox_destroy',
      'px_load',
      'tool_io_guard',
      'px_validate_cascade',
      'px_opencode_preview',
      'px_sandbox_health',
    ],
    domains: [
      {
        app: 'ontology',
        hostTemplate: 'ontology.{env}.{base}',
        port: ONTOLOGY_UI_PORT,
        public: true,
        auth: 'session-jwt',
        surface: 'ontology_ui',
        corsOrigins: ['*'], // tightened per env in mint layer
        maxSignedTtlSec: 3600,
      },
      {
        app: 'validate',
        hostTemplate: 'validate.{env}.{base}',
        port: SHACL_PORT,
        public: false, // prefer host BFF; machine mint only
        auth: 'signed-preview',
        surface: 'validate_api',
        corsOrigins: [],
        maxSignedTtlSec: 900,
      },
      {
        app: 'fleet',
        hostTemplate: 'fleet.{env}.{base}',
        port: FLEET_UI_PORT,
        public: true,
        auth: 'session-jwt',
        surface: 'fleet_ui',
        corsOrigins: ['*'],
        maxSignedTtlSec: 3600,
      },
      {
        app: 'opencode',
        hostTemplate: 'opencode.{env}.{base}',
        port: OPENCODE_SERVE_PORT,
        public: false, // signed preview only — local agent entry
        auth: 'signed-preview',
        surface: 'opencode_serve',
        corsOrigins: [],
        maxSignedTtlSec: 3600,
      },
    ],
    healthPaths: {
      [SHACL_PORT]: '/health',
      [ONTOLOGY_UI_PORT]: '/health',
      [FLEET_UI_PORT]: '/health',
      [SERVICE_PORTS.lean]: '/health',
      [OPENCODE_SERVE_PORT]: '/global/health',
      [ASSISTANT_UI_WEB_PORT]: '/',
    },
    description:
      'S2 (2nd lifecycle sandbox): SHACL/GraphQL/Lean + diagram (7005) + fleet (7006) + assistant-ui (3010) + OpenCode serve (4096) for local agent.',
  },

  agent: {
    role: 'agent',
    ontologyStage: 'consume',
    ports: [OPENCODE_SERVE_PORT, ASSISTANT_UI_WEB_PORT],
    egress: 'mcp-gated',
    mcpTools: [
      'tool_io_guard',
      'fleet_run',
      'px_shacl_validate',
      'px_validation_token',
      'mastra-orchestrate',
      'px_opencode_preview',
      'px_sandbox_health',
    ],
    domains: [
      {
        app: 'agent',
        hostTemplate: 'agent.{env}.{base}',
        port: ASSISTANT_UI_WEB_PORT,
        public: true,
        auth: 'session-jwt',
        surface: 'agent_app',
        corsOrigins: [],
        maxSignedTtlSec: 1800,
      },
      {
        app: 'opencode',
        hostTemplate: 'opencode.{env}.{base}',
        port: OPENCODE_SERVE_PORT,
        public: false,
        auth: 'signed-preview',
        surface: 'opencode_serve',
        corsOrigins: [],
        maxSignedTtlSec: 3600,
      },
    ],
    healthPaths: {},
    description: 'S3+: product agent after ValidationToken; no LinkML compiler.',
  },

  'legacy-packed': {
    role: 'legacy-packed',
    ontologyStage: 'demo',
    ports: FORMAL_PORTS,
    egress: 'demo',
    mcpTools: ['*'],
    domains: [
      {
        app: 'ontology',
        hostTemplate: 'ontology.{env}.{base}',
        port: ONTOLOGY_UI_PORT,
        public: true,
        auth: 'signed-preview',
        surface: 'ontology_ui',
        corsOrigins: ['*'],
        maxSignedTtlSec: 7200,
      },
      {
        app: 'validate',
        hostTemplate: 'validate.{env}.{base}',
        port: SHACL_PORT,
        public: true,
        auth: 'signed-preview',
        surface: 'validate_api',
        corsOrigins: ['*'],
        maxSignedTtlSec: 3600,
      },
    ],
    healthPaths: {
      [SHACL_PORT]: '/health',
      [ONTOLOGY_UI_PORT]: '/health',
    },
    description: 'Demo single-box (current behavior). Not production IP profile.',
  },
};

export function getSandboxType(role: SandboxRole): SandboxTypeSpec {
  return SANDBOX_TYPE_REGISTRY[role];
}

export function listSandboxRoles(): SandboxRole[] {
  return Object.keys(SANDBOX_TYPE_REGISTRY) as SandboxRole[];
}

export function domainTemplateFor(
  role: SandboxRole,
  app: DomainTemplate['app'],
): DomainTemplate | null {
  const spec = getSandboxType(role);
  return spec.domains.find((d) => d.app === app) || null;
}

export function assertNoPublicEditorDomains(): void {
  const ed = getSandboxType('editor');
  if (ed.domains.some((d) => d.public)) {
    throw new Error('sandbox-type-sync: editor must not have public domains');
  }
  // Editor must not own formal diagram/fleet ports
  for (const p of [ONTOLOGY_UI_PORT, FLEET_UI_PORT, SHACL_PORT]) {
    if (ed.ports.includes(p)) {
      throw new Error(`sandbox-type-sync: editor must not own port ${p}`);
    }
  }
}

/** Formal (S2) owns ontology UI + fleet UI surfaces — 2nd lifecycle sandbox. */
export function assertFormalOwnsDiagramAndFleet(): void {
  const formal = getSandboxType('formal');
  if (!formal.ports.includes(ONTOLOGY_UI_PORT)) {
    throw new Error('formal role must own ONTOLOGY_UI_PORT (7005)');
  }
  if (!formal.ports.includes(FLEET_UI_PORT)) {
    throw new Error('formal role must own FLEET_UI_PORT (7006)');
  }
  const surfaces = formal.domains.map((d) => d.surface);
  if (!surfaces.includes('ontology_ui')) {
    throw new Error('formal role must expose ontology_ui domain');
  }
  if (!surfaces.includes('fleet_ui')) {
    throw new Error('formal role must expose fleet_ui domain');
  }
  const editor = getSandboxType('editor');
  if (editor.domains.some((d) => d.surface === 'ontology_ui' || d.surface === 'fleet_ui')) {
    throw new Error('editor must not expose ontology_ui or fleet_ui');
  }
}

export interface MintedPreviewUrl {
  url: string;
  rawUrl?: string;
  host: string;
  port: number;
  role: SandboxRole;
  app: DomainTemplate['app'];
  surface: PublicSurface;
  mode: 'friendly' | 'raw' | 'localhost';
  expiresInSeconds: number;
  expiresAt: string;
}

/**
 * Build friendly or raw preview URL from a Daytona (or mock) base signed URL.
 */
export function mintPreviewUrl(opts: {
  role: SandboxRole;
  app: DomainTemplate['app'];
  /** Raw signed Daytona URL if available */
  rawSignedUrl?: string | null;
  /** Fallback localhost when no signed URL (mock/local) */
  localhostFallback?: boolean;
  expiresInSeconds?: number;
  sessionId?: string;
}): MintedPreviewUrl {
  if (opts.role === 'editor' && (opts.app === 'ontology' || opts.app === 'fleet' || opts.app === 'validate')) {
    throw new Error('IP policy: editor role cannot mint formal diagram/fleet/validate URLs');
  }
  const tpl = domainTemplateFor(opts.role, opts.app);
  if (!tpl) {
    throw new Error(`No domain template for role=${opts.role} app=${opts.app}`);
  }
  if (!tpl.public && opts.app === 'edit') {
    throw new Error('Refusing to mint public URL for non-public editor surface');
  }
  // validate app is non-public: still allow mint for machine use but mark host private
  const ttl = Math.min(
    opts.expiresInSeconds ?? tpl.maxSignedTtlSec,
    tpl.maxSignedTtlSec,
  );
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();
  const mode = previewMode();
  const port = tpl.port;

  if (opts.localhostFallback && !opts.rawSignedUrl) {
    const host = `127.0.0.1:${port}`;
    return {
      url: `http://${host}`,
      host,
      port,
      role: opts.role,
      app: opts.app,
      surface: tpl.surface,
      mode: 'localhost',
      expiresInSeconds: ttl,
      expiresAt,
    };
  }

  if (mode === 'raw' && opts.rawSignedUrl) {
    let host = '';
    try {
      host = new URL(opts.rawSignedUrl).host;
    } catch {
      host = opts.rawSignedUrl;
    }
    return {
      url: opts.rawSignedUrl,
      rawUrl: opts.rawSignedUrl,
      host,
      port,
      role: opts.role,
      app: opts.app,
      surface: tpl.surface,
      mode: 'raw',
      expiresInSeconds: ttl,
      expiresAt,
    };
  }

  // Friendly rewrite
  const friendlyHost = resolveHostTemplate(tpl.hostTemplate);
  const path =
    tpl.pathPrefix ||
    (opts.sessionId ? `/s/${opts.sessionId}` : '');
  const proxy = process.env.PREVIEW_PROXY_URL?.replace(/\/$/, '');
  let url: string;
  if (proxy) {
    // Proxy style: https://preview.example.com/r/{role}/{app}/{session}
    url = `${proxy}/r/${opts.role}/${opts.app}${opts.sessionId ? `/${opts.sessionId}` : ''}`;
  } else {
    url = `https://${friendlyHost}${path}`;
  }

  return {
    url,
    rawUrl: opts.rawSignedUrl || undefined,
    host: friendlyHost,
    port,
    role: opts.role,
    app: opts.app,
    surface: tpl.surface,
    mode: 'friendly',
    expiresInSeconds: ttl,
    expiresAt,
  };
}

/** Snapshot for CI / smoke-type-sync */
export function registrySyncSnapshot(): {
  version: string;
  roles: Array<{
    role: SandboxRole;
    ports: number[];
    egress: SandboxEgress;
    publicApps: string[];
    domainHosts: string[];
  }>;
} {
  return {
    version: SANDBOX_TYPES_VERSION,
    roles: listSandboxRoles().map((role) => {
      const s = getSandboxType(role);
      return {
        role,
        ports: s.ports,
        egress: s.egress,
        publicApps: s.domains.filter((d) => d.public).map((d) => d.app),
        domainHosts: s.domains.map((d) => resolveHostTemplate(d.hostTemplate)),
      };
    }),
  };
}
