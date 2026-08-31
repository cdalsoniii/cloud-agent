/**
 * Product-owned SHACL sandbox lifecycle handlers.
 * MCP / HTTP adapters call these; agents never hold DAYTONA_API_KEY.
 */
import type { VerificationSandbox } from './types.js';
import { createPackedSandbox } from './provider.js';
import { resolvePxRoot } from './px-pack.js';
import type { SelectableVerifier } from './packing.js';
import { verifyUntilPass } from './retry-loop.js';
import { hostRegenerateLinkmlArtifacts } from './host-rebuild.js';
import {
  buildOntologySuggestions,
  enforcementSkipPayload,
  formatShaclCot,
  isOntologyEnforcementEnabled,
  isOntologyEditingEnabled,
  readPxOntologyConfig,
} from './shacl-cot.js';

/** Session-scoped active pack sandbox (single fleet / SHACL box). */
let active: VerificationSandbox | null = null;

const DEFAULT_SELECTED: SelectableVerifier[] = [
  { verifier_id: 'safety', backend: 'lean' },
];

export function getActiveShaclSandbox(): VerificationSandbox | null {
  return active;
}

export async function handlePxSandboxCreate(args: {
  provider?: 'daytona' | 'e2b' | 'mock';
  forceMock?: boolean;
  pxRoot?: string;
  skipShacl?: boolean;
}): Promise<Record<string, unknown>> {
  if (active) {
    try {
      await active.destroy();
    } catch {
      /* replace */
    }
    active = null;
  }
  const box = await createPackedSandbox({
    selected: DEFAULT_SELECTED,
    provider: args.provider,
    forceMock: args.forceMock,
    pxRoot: args.pxRoot,
    skipShacl: args.skipShacl,
  });
  active = box;
  let preview: unknown = null;
  if (box.getShaclPreviewUrl) {
    try {
      preview = await box.getShaclPreviewUrl(300);
    } catch {
      preview = null;
    }
  }
  return {
    ok: true,
    sandboxId: box.sandboxId,
    provider: box.provider,
    shaclPort: 7004,
    pack: box.pack,
    preview,
    pxRoot: resolvePxRoot(args.pxRoot),
  };
}

export async function handlePxUploadLinkml(args: {
  pxRoot?: string;
  regenerate?: boolean;
}): Promise<Record<string, unknown>> {
  if (!active) {
    return { ok: false, error: 'no active sandbox — call px_sandbox_create first' };
  }
  if (!active.uploadLinkmlPack) {
    return { ok: false, error: 'upload not supported on this provider' };
  }
  let hostRegen: unknown = null;
  if (args.regenerate !== false) {
    hostRegen = hostRegenerateLinkmlArtifacts(args.pxRoot);
  }
  const result = await active.uploadLinkmlPack(args.pxRoot);
  return { ok: true, sandboxId: active.sandboxId, hostRegen, ...result };
}

export async function handlePxShaclValidate(args: {
  data: unknown;
  pack?: string;
  className?: string;
  force?: boolean;
}): Promise<Record<string, unknown>> {
  if (!isOntologyEnforcementEnabled() && !args.force) {
    return {
      ...enforcementSkipPayload('both'),
      note: 'pass force:true to validate while enforcement is off',
    };
  }
  if (!active) {
    return { ok: false, error: 'no active sandbox — call px_sandbox_create first' };
  }
  if (!active.invokeShacl) {
    return { ok: false, error: 'SHACL invoke not supported on this provider' };
  }
  if (args.data === undefined) {
    return { ok: false, error: 'data is required' };
  }
  const result = await active.invokeShacl({
    data: args.data,
    pack: args.pack,
    className: args.className,
  });
  const viols = result.violations || [];
  const suggestions = buildOntologySuggestions(viols);
  const cot = formatShaclCot({
    phase: 'both',
    ok: result.ok,
    engine: result.engine,
    violations: viols,
    suggestions,
  });
  return {
    ok: result.ok,
    sandboxId: active.sandboxId,
    ...result,
    ontologySuggestions: suggestions,
    ontologyEditing: isOntologyEditingEnabled(),
    ontologyEnforcement: true,
    cot,
    reasoningSummary: cot,
  };
}

export async function handlePxShaclPreview(args?: {
  expiresInSeconds?: number;
}): Promise<Record<string, unknown>> {
  if (!active) {
    return { ok: false, error: 'no active sandbox — call px_sandbox_create first' };
  }
  if (!active.getShaclPreviewUrl) {
    return { ok: false, error: 'signed preview not supported on this provider' };
  }
  const preview = await active.getShaclPreviewUrl(args?.expiresInSeconds ?? 300);
  return {
    ok: Boolean(preview),
    sandboxId: active.sandboxId,
    preview,
  };
}

/** Signed preview for React Flow ontology viewer (port 7005). */
export async function handlePxOntologyUiPreview(args?: {
  expiresInSeconds?: number;
  role?: 'formal' | 'legacy-packed';
}): Promise<Record<string, unknown>> {
  if (!active) {
    return { ok: false, error: 'no active sandbox — call px_sandbox_create first' };
  }
  const role = args?.role || 'formal';
  let raw = null as Awaited<ReturnType<NonNullable<typeof active.getOntologyUiPreviewUrl>>> | null;
  if (active.getOntologyUiPreviewUrl) {
    raw = await active.getOntologyUiPreviewUrl(args?.expiresInSeconds ?? 300);
  } else {
    raw = {
      url: 'http://127.0.0.1:7005',
      port: 7005,
      expiresInSeconds: args?.expiresInSeconds ?? 300,
    };
  }

  const { mintSandboxAppUrl } = await import('./preview-urls.js');
  let friendly;
  try {
    friendly = mintSandboxAppUrl({
      role,
      app: 'ontology',
      raw,
      sessionId: active.sandboxId,
      expiresInSeconds: args?.expiresInSeconds,
    });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      sandboxId: active.sandboxId,
    };
  }

  return {
    ok: true,
    sandboxId: active.sandboxId,
    role,
    preview: {
      url: friendly.url,
      rawUrl: friendly.rawUrl,
      host: friendly.host,
      port: friendly.port,
      mode: friendly.mode,
      expiresInSeconds: friendly.expiresInSeconds,
      expiresAt: friendly.expiresAt,
      surface: friendly.surface,
    },
    paths: {
      ui: '/',
      state: '/api/ontology/state',
      health: '/health',
    },
    note: 'Friendly domain from SandboxTypeRegistry; PREVIEW_MODE=raw uses Daytona signed URL only',
  };
}

/** Active formal Daytona (or mock packed) box for formal-role create/ingest. */
let activeFormalBox: import('./types.js').VerificationSandbox | null = null;
let activeFormalCustomerId = 'acme-fleet';

export function getActiveFormalBox(): import('./types.js').VerificationSandbox | null {
  return activeFormalBox;
}

function wantDaytonaFormal(args?: { forceLocal?: boolean; forceMock?: boolean }): boolean {
  if (args?.forceLocal) return false;
  if (args?.forceMock) return false;
  if (process.env.FORMAL_FORCE_LOCAL === '1' || process.env.FORMAL_FORCE_LOCAL === 'true') {
    return false;
  }
  return Boolean(process.env.DAYTONA_API_KEY);
}

/**
 * Formal (S2) create — start LinkML diagram + verifier-fleet under formal role.
 * Default: live Daytona when DAYTONA_API_KEY is set; otherwise local formal-equivalent.
 */
export async function handlePxFormalCreate(args?: {
  customerId?: string;
  pxRoot?: string;
  ontologyPort?: number;
  fleetPort?: number;
  assistantUiOrigin?: string;
  forceLocal?: boolean;
  forceMock?: boolean;
  provider?: 'daytona' | 'e2b' | 'mock';
  /** Start full assistant-ui Next web from 02-products (Daytona only). Default: env FORMAL_START_ASSISTANT_UI !== '0' */
  startAssistantUiWeb?: boolean;
  /** Start OpenCode serve :4096 for local agent. Default on unless FORMAL_START_OPENCODE=0 */
  startOpenCode?: boolean;
  assistantUiRoot?: string;
}): Promise<Record<string, unknown>> {
  const { formalSurfaceOwnership, formalDestroy } = await import('./formal-stack.js');
  const ownership = formalSurfaceOwnership();
  const customerId = args?.customerId || 'acme-fleet';
  activeFormalCustomerId = customerId;

  if (wantDaytonaFormal(args)) {
    // tear down local formal stack if any
    formalDestroy();
    if (activeFormalBox) {
      try {
        await activeFormalBox.destroy();
      } catch {
        /* */
      }
      activeFormalBox = null;
    }
    const { createPackedSandbox } = await import('./provider.js');
    const { ONTOLOGY_UI_PORT, FLEET_UI_PORT, SHACL_PORT } = await import('./types.js');
    const box = await createPackedSandbox({
      selected: DEFAULT_SELECTED,
      provider: args?.provider || 'daytona',
      forceMock: false,
      pxRoot: args?.pxRoot,
      customerId,
    });
    activeFormalBox = box;
    // also set legacy active for preview helpers that still look there
    active = box;

    let probe: unknown = null;
    if (typeof (box as { probeFormalUi?: () => Promise<unknown> }).probeFormalUi === 'function') {
      probe = await (box as { probeFormalUi: () => Promise<unknown> }).probeFormalUi();
    }

    const ontologyPreview = box.getOntologyUiPreviewUrl
      ? await box.getOntologyUiPreviewUrl(3600)
      : null;
    const fleetPreview = box.getFleetUiPreviewUrl
      ? await box.getFleetUiPreviewUrl(3600)
      : null;
    const shaclPreview = box.getShaclPreviewUrl ? await box.getShaclPreviewUrl(900) : null;

    // Full product Next app from 02-products/assistant-ui (optional; default on)
    const wantAui =
      args?.startAssistantUiWeb !== false &&
      process.env.FORMAL_START_ASSISTANT_UI !== '0' &&
      process.env.FORMAL_START_ASSISTANT_UI !== 'false';
    let assistantUiWeb: unknown = null;
    let assistantUiPreview: { url?: string; port?: number; token?: string } | null = null;
    if (wantAui && typeof box.ensureAssistantUiWeb === 'function') {
      try {
        assistantUiWeb = await box.ensureAssistantUiWeb({
          assistantUiRoot: args?.assistantUiRoot,
        });
        if (box.getAssistantUiWebPreviewUrl) {
          assistantUiPreview = await box.getAssistantUiWebPreviewUrl(3600);
        }
      } catch (e) {
        assistantUiWeb = {
          ok: false,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }

    // OpenCode serve — local agent entry (default on)
    const wantOpencode =
      args?.startOpenCode !== false &&
      process.env.FORMAL_START_OPENCODE !== '0' &&
      process.env.FORMAL_START_OPENCODE !== 'false';
    let opencode: unknown = null;
    let opencodePreview: { url?: string; port?: number; token?: string } | null = null;
    if (wantOpencode && typeof box.ensureOpenCodeServe === 'function') {
      try {
        opencode = await box.ensureOpenCodeServe({});
        if (box.getOpenCodePreviewUrl) {
          opencodePreview = await box.getOpenCodePreviewUrl(3600);
        }
      } catch (e) {
        opencode = { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    }

    let processBoard: unknown = null;
    if (typeof box.probeProcesses === 'function') {
      try {
        processBoard = await box.probeProcesses({
          includeAssistantUi: wantAui,
          includeOpencode: wantOpencode,
        });
      } catch {
        processBoard = null;
      }
    }

    const { ASSISTANT_UI_WEB_PORT, OPENCODE_SERVE_PORT } = await import('./types.js');

    return {
      ok: true,
      role: 'formal',
      stage: 'stabilize',
      runtime: 'daytona',
      provider: box.provider,
      sandboxId: box.sandboxId,
      customerId,
      pack: box.pack,
      ownership,
      urls: {
        ontology: ontologyPreview?.url || null,
        fleet: fleetPreview?.url || null,
        shacl: shaclPreview?.url || null,
        assistantUiWeb: assistantUiPreview?.url || null,
        opencode: opencodePreview?.url || null,
        ontologyInSandbox: `http://127.0.0.1:${ONTOLOGY_UI_PORT}/`,
        fleetInSandbox: `http://127.0.0.1:${FLEET_UI_PORT}/`,
        assistantUiWebInSandbox: `http://127.0.0.1:${ASSISTANT_UI_WEB_PORT}/`,
        verifierFleetInSandbox: `http://127.0.0.1:${ASSISTANT_UI_WEB_PORT}/verifier-fleet`,
        opencodeInSandbox: `http://127.0.0.1:${OPENCODE_SERVE_PORT}/global/health`,
      },
      ports: {
        ontology: ONTOLOGY_UI_PORT,
        fleet: FLEET_UI_PORT,
        shacl: SHACL_PORT,
        assistantUiWeb: ASSISTANT_UI_WEB_PORT,
        opencode: OPENCODE_SERVE_PORT,
      },
      previews: {
        ontology: ontologyPreview,
        fleet: fleetPreview,
        shacl: shaclPreview,
        assistantUiWeb: assistantUiPreview,
        opencode: opencodePreview,
      },
      probe,
      assistantUiWeb,
      opencode,
      processBoard,
      note: 'Formal apps + OpenCode serve (4096) for local agent; refresh signed URLs with npm run previews:mint',
    };
  }

  // Local formal-equivalent (no Daytona key or forceLocal)
  const { formalCreate } = await import('./formal-stack.js');
  const handle = await formalCreate({
    customerId,
    pxRoot: args?.pxRoot,
    ontologyPort: args?.ontologyPort,
    fleetPort: args?.fleetPort,
    assistantUiOrigin: args?.assistantUiOrigin,
  });
  return {
    ok: true,
    role: 'formal',
    stage: 'stabilize',
    runtime: 'local-formal-equivalent',
    customerId: handle.customerId,
    pack: handle.pack,
    ownership,
    urls: {
      ontology: handle.ontologyUrl,
      fleet: handle.fleetUrl,
      ontologyState: `http://127.0.0.1:${handle.ontologyPort}/api/ontology/state`,
      ontologyHealth: `http://127.0.0.1:${handle.ontologyPort}/health`,
      fleetHealth: `http://127.0.0.1:${handle.fleetPort}/health`,
    },
    ports: {
      ontology: handle.ontologyPort,
      fleet: handle.fleetPort,
      shacl: handle.shaclPort,
    },
    previews: handle.previews,
    note: 'Formal-equivalent local stack when Daytona unavailable; diagram+fleet owned by formal role',
  };
}

/**
 * Formal ingest — rebuild ontology-state for customer pack and re-serve diagram/fleet.
 * On Daytona: re-upload pack + restart formal UIs inside the sandbox.
 */
export async function handlePxFormalIngest(args?: {
  customerId?: string;
  pxRoot?: string;
  ontologyPort?: number;
  fleetPort?: number;
  assistantUiOrigin?: string;
  forceLocal?: boolean;
  forceMock?: boolean;
}): Promise<Record<string, unknown>> {
  const customerId = args?.customerId || activeFormalCustomerId || 'acme-fleet';
  activeFormalCustomerId = customerId;

  if (activeFormalBox && wantDaytonaFormal(args)) {
    const box = activeFormalBox;
    if ('customerId' in box) {
      (box as { customerId: string | null }).customerId = customerId;
    }
    if (!box.uploadLinkmlPack) {
      return { ok: false, error: 'upload not supported on formal box', role: 'formal' };
    }
    const upload = await box.uploadLinkmlPack(args?.pxRoot);
    let probe: unknown = null;
    if (typeof (box as { probeFormalUi?: () => Promise<unknown> }).probeFormalUi === 'function') {
      probe = await (box as { probeFormalUi: () => Promise<unknown> }).probeFormalUi();
    }
    const ontologyPreview = box.getOntologyUiPreviewUrl
      ? await box.getOntologyUiPreviewUrl(3600)
      : null;
    const fleetPreview = box.getFleetUiPreviewUrl
      ? await box.getFleetUiPreviewUrl(3600)
      : null;

    let stateSummary: unknown = null;
    if (probe && typeof probe === 'object') {
      const p = probe as {
        ontology?: { ok?: boolean; body?: string };
        fleet?: { ok?: boolean; body?: string };
        stateSnippet?: string;
      };
      try {
        const st = p.stateSnippet ? JSON.parse(p.stateSnippet) : null;
        if (st) {
          stateSummary = {
            summary: st.summary,
            nodes: st.reactFlow?.nodes?.length ?? 0,
          };
        }
      } catch {
        stateSummary = { raw: p.stateSnippet?.slice(0, 200) };
      }
      if (!p.ontology?.ok || !p.fleet?.ok) {
        return {
          ok: false,
          error: 'formal UI health failed inside Daytona after ingest',
          role: 'formal',
          runtime: 'daytona',
          sandboxId: box.sandboxId,
          probe,
          upload,
        };
      }
    }

    return {
      ok: true,
      role: 'formal',
      runtime: 'daytona',
      provider: box.provider,
      sandboxId: box.sandboxId,
      customerId,
      urls: {
        ontology: ontologyPreview?.url || null,
        fleet: fleetPreview?.url || null,
      },
      previews: { ontology: ontologyPreview, fleet: fleetPreview },
      probe,
      stateSummary,
      upload,
      active: true,
    };
  }

  const { formalIngest, getActiveFormalStack } = await import('./formal-stack.js');
  const handle = await formalIngest({
    customerId,
    pxRoot: args?.pxRoot,
    ontologyPort: args?.ontologyPort,
    fleetPort: args?.fleetPort,
    assistantUiOrigin: args?.assistantUiOrigin,
  });
  let health: unknown = null;
  let stateSummary: unknown = null;
  try {
    health = await fetch(`http://127.0.0.1:${handle.ontologyPort}/health`).then((r) => r.json());
    const st = (await fetch(`http://127.0.0.1:${handle.ontologyPort}/api/ontology/state`).then((r) =>
      r.json(),
    )) as { summary?: unknown; reactFlow?: { nodes?: unknown[] } };
    stateSummary = {
      summary: st.summary,
      nodes: st.reactFlow?.nodes?.length ?? 0,
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      role: 'formal',
    };
  }
  return {
    ok: true,
    role: 'formal',
    runtime: 'local-formal-equivalent',
    customerId: handle.customerId,
    pack: handle.pack,
    urls: {
      ontology: handle.ontologyUrl,
      fleet: handle.fleetUrl,
    },
    health,
    stateSummary,
    active: Boolean(getActiveFormalStack()),
  };
}

/** Mint formal-role preview for ontology UI, validate API, or fleet UI. */
export async function handlePxFormalPreview(args?: {
  expiresInSeconds?: number;
  app?: 'ontology' | 'validate' | 'fleet';
}): Promise<Record<string, unknown>> {
  const { getActiveFormalStack } = await import('./formal-stack.js');
  const formal = getActiveFormalStack();
  const app = args?.app || 'ontology';

  // Prefer Daytona formal box signed previews
  if (activeFormalBox) {
    const box = activeFormalBox;
    let raw: { url: string; port: number; expiresInSeconds?: number; token?: string } | null = null;
    if (app === 'fleet' && box.getFleetUiPreviewUrl) {
      raw = await box.getFleetUiPreviewUrl(args?.expiresInSeconds ?? 3600);
    } else if (app === 'ontology' && box.getOntologyUiPreviewUrl) {
      raw = await box.getOntologyUiPreviewUrl(args?.expiresInSeconds ?? 3600);
    } else if (app === 'validate' && box.getShaclPreviewUrl) {
      raw = await box.getShaclPreviewUrl(args?.expiresInSeconds ?? 900);
    }
    if (raw) {
      return {
        ok: true,
        role: 'formal',
        runtime: box.provider,
        sandboxId: box.sandboxId,
        customerId: activeFormalCustomerId,
        preview: {
          url: raw.url,
          host: (() => {
            try {
              return new URL(raw.url).host;
            } catch {
              return raw.url;
            }
          })(),
          port: raw.port,
          role: 'formal' as const,
          app,
          surface: app === 'fleet' ? 'fleet_ui' : app === 'validate' ? 'validate_api' : 'ontology_ui',
          mode: 'raw' as const,
          expiresInSeconds: raw.expiresInSeconds ?? args?.expiresInSeconds ?? 3600,
          expiresAt: new Date(
            Date.now() + (raw.expiresInSeconds ?? 3600) * 1000,
          ).toISOString(),
          token: raw.token,
        },
        urls: {
          ontology: (await box.getOntologyUiPreviewUrl?.(3600))?.url || null,
          fleet: (await box.getFleetUiPreviewUrl?.(3600))?.url || null,
        },
      };
    }
  }

  // Prefer live formal stack ports when create/ingest already ran (use real listen ports)
  if (formal) {
    const port =
      app === 'fleet' ? formal.fleetPort : app === 'validate' ? formal.shaclPort : formal.ontologyPort;
    const openUrl =
      app === 'fleet'
        ? formal.fleetUrl
        : app === 'validate'
          ? `http://127.0.0.1:${port}/`
          : formal.ontologyUrl;
    const ttl = args?.expiresInSeconds ?? 3600;
    return {
      ok: true,
      role: 'formal',
      customerId: formal.customerId,
      pack: formal.pack,
      preview: {
        url: openUrl,
        host: `127.0.0.1:${port}`,
        port,
        role: 'formal' as const,
        app,
        surface: app === 'fleet' ? 'fleet_ui' : app === 'validate' ? 'validate_api' : 'ontology_ui',
        mode: 'localhost' as const,
        expiresInSeconds: ttl,
        expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
      },
      urls: { ontology: formal.ontologyUrl, fleet: formal.fleetUrl },
    };
  }

  if (!active) {
    return {
      ok: false,
      error: 'no formal stack or packed sandbox — call px_formal_create or px_sandbox_create first',
    };
  }
  let raw = null as { url: string; port: number; expiresInSeconds?: number; token?: string } | null;
  if (app === 'ontology' && active.getOntologyUiPreviewUrl) {
    raw = await active.getOntologyUiPreviewUrl(args?.expiresInSeconds ?? 300);
  } else if (app !== 'fleet' && active.getShaclPreviewUrl) {
    raw = await active.getShaclPreviewUrl(args?.expiresInSeconds ?? 300);
  }
  if (!raw) {
    raw = {
      url:
        app === 'ontology'
          ? 'http://127.0.0.1:7005'
          : app === 'fleet'
            ? 'http://127.0.0.1:7006'
            : 'http://127.0.0.1:7004',
      port: app === 'ontology' ? 7005 : app === 'fleet' ? 7006 : 7004,
      expiresInSeconds: args?.expiresInSeconds ?? 300,
    };
  }
  const { mintSandboxAppUrl } = await import('./preview-urls.js');
  try {
    const friendly = mintSandboxAppUrl({
      role: 'formal',
      app: app === 'fleet' ? 'fleet' : app === 'validate' ? 'validate' : 'ontology',
      raw,
      sessionId: active.sandboxId,
      expiresInSeconds: args?.expiresInSeconds,
    });
    return { ok: true, sandboxId: active.sandboxId, role: 'formal', preview: friendly };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Mint fleet UI preview from formal stack. */
export async function handlePxFormalFleetPreview(args?: {
  expiresInSeconds?: number;
}): Promise<Record<string, unknown>> {
  return handlePxFormalPreview({ ...args, app: 'fleet' });
}

export async function handlePxSandboxDestroy(): Promise<Record<string, unknown>> {
  const { formalDestroy } = await import('./formal-stack.js');
  const formal = formalDestroy();
  let formalBoxDestroyed = false;
  let formalBoxId: string | undefined;
  if (activeFormalBox) {
    formalBoxId = activeFormalBox.sandboxId;
    try {
      await activeFormalBox.destroy();
      formalBoxDestroyed = true;
    } catch {
      /* best-effort */
    }
    activeFormalBox = null;
  }
  if (!active) {
    return {
      ok: true,
      destroyed: false,
      formalDestroyed: formal.destroyed,
      formalBoxDestroyed,
      formalBoxId,
      note: formal.destroyed || formalBoxDestroyed ? 'formal stack stopped' : 'no active sandbox',
    };
  }
  const id = active.sandboxId;
  try {
    await active.destroy();
  } finally {
    active = null;
  }
  return {
    ok: true,
    destroyed: true,
    sandboxId: id,
    formalDestroyed: formal.destroyed,
    formalBoxDestroyed,
    formalBoxId,
  };
}

export async function handleFleetRun(args: {
  forceMock?: boolean;
  maxRetries?: number;
  forceFail?: boolean;
  backends?: string[];
}): Promise<Record<string, unknown>> {
  const backends = (args.backends as Array<'lean' | 'haskell' | 'boundaryml'>) || ['lean'];
  const selected: SelectableVerifier[] = backends.map((b, i) => ({
    verifier_id: `v-${b}-${i}`,
    backend: b,
  }));
  const result = await verifyUntilPass({
    selected,
    forceMock: args.forceMock ?? true,
    maxRetries: args.maxRetries ?? 3,
    failFirstAttempts: args.forceFail ? 1 : 0,
    payloadForAttempt: (attempt) => ({
      attempt,
      force_fail: args.forceFail && attempt === 0,
    }),
  });
  return { ok: result.ok, ...result };
}

/**
 * Tool-io pre/post guard. When enforceSchema + ontologyEnforcement:
 * cascade SHACL → Lean → GraphQL (LinkML-derived) on structured payloads.
 */
export async function handleToolIoGuard(args: {
  tool?: string;
  phase?: 'pre' | 'post' | 'both';
  payload?: unknown;
  result?: unknown;
  /** Default true — always-on cascade when enforcement is enabled */
  enforceSchema?: boolean;
  pack?: string;
  /** Validation layers; default shacl→lean→graphql when enforceSchema */
  layers?: Array<'shacl' | 'lean' | 'graphql'>;
  shortCircuit?: boolean;
  className?: string;
}): Promise<Record<string, unknown>> {
  const phase = args.phase || 'both';
  const tool = args.tool || 'unknown';
  const cfg = readPxOntologyConfig();
  // Always-on: omit enforceSchema → true (opt-out only with enforceSchema: false)
  const enforceSchema = args.enforceSchema !== false;

  if (enforceSchema && !isOntologyEnforcementEnabled()) {
    const { buildOntologyHookContext } = await import('./ontology-hook-context.js');
    const skippedCtx = buildOntologyHookContext({
      phase: phase === 'post' ? 'post' : 'pre',
      tool,
      pack: args.pack,
      className: args.className,
      data: args.payload,
      endpoint: active
        ? {
            provider: active.provider,
            sandboxId: active.sandboxId,
            shaclPort: 7004,
            guardrailsPort: 7003,
          }
        : undefined,
    });
    return {
      ...enforcementSkipPayload(phase),
      tool,
      phase,
      violations: [],
      schema: {},
      cascade: {},
      ontologyHookContext: skippedCtx,
      sandboxId: active?.sandboxId ?? null,
    };
  }

  const violations: Array<{
    id: string;
    severity: string;
    title: string;
    reason: string;
    phase: string;
    layer?: string;
  }> = [];

  const dangerRe = /rm\s+-rf\s+\/(?:\s|$)|rm\s+-rf\s+\/\s*;|curl\s+[^\n]*\|\s*(?:ba)?sh|:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;|mkfs\.|dd\s+if=\/dev\/zero/i;
  const checkPayload = (p: unknown, ph: string) => {
    if (p === undefined || p === null) {
      violations.push({
        id: `${ph}-empty`,
        severity: 'important',
        title: `[${ph}] empty payload`,
        reason: 'payload is null/undefined',
        phase: ph,
      });
      return;
    }
    const asText =
      typeof p === 'string'
        ? p
        : typeof p === 'object' && p !== null && !Array.isArray(p)
          ? [
              (p as Record<string, unknown>).command,
              (p as Record<string, unknown>).script,
              (p as Record<string, unknown>).cmd,
              JSON.stringify(p),
            ]
              .filter((x) => typeof x === 'string')
              .join('\n')
          : String(p);
    if (dangerRe.test(asText)) {
      violations.push({
        id: `${ph}-danger`,
        severity: 'blocking',
        title: `[${ph}] dangerous command pattern`,
        reason: 'payload matches high-risk shell pattern',
        phase: ph,
      });
    }
  };

  if (phase === 'pre' || phase === 'both') checkPayload(args.payload, 'pre');
  if (phase === 'post' || phase === 'both') checkPayload(args.result ?? args.payload, 'post');

  let schema: { pre?: unknown; post?: unknown } = {};
  let cascade: { pre?: unknown; post?: unknown } = {};
  let engine = 'rules';

  const { runValidationCascade } = await import('./validation-cascade.js');
  const { hostInvokeShacl } = await import('./provider.js');
  // Prefer remote sandbox SHACL; fall back to host unit so MCP/plugin enforce without sandbox create
  const resolveInvokeShacl = () =>
    active?.invokeShacl
      ? (body: { data: unknown; pack?: string; className?: string }) => active!.invokeShacl!(body)
      : (body: { data: unknown; pack?: string; className?: string }) => hostInvokeShacl(body);

  if (enforceSchema) {
    const layers = args.layers?.length
      ? args.layers
      : (['shacl', 'lean', 'graphql'] as Array<'shacl' | 'lean' | 'graphql'>);
    const structuredPre =
      args.payload && typeof args.payload === 'object' && !Array.isArray(args.payload)
        ? args.payload
        : undefined;
    const structuredPost =
      args.result && typeof args.result === 'object' && !Array.isArray(args.result)
        ? args.result
        : undefined;

    const runPhase = async (ph: 'pre' | 'post', data: unknown) => {
      const result = await runValidationCascade({
        data,
        pack: args.pack || 'verifier-fleet',
        className: args.className,
        layers,
        shortCircuit: args.shortCircuit !== false,
        invokeShacl: resolveInvokeShacl(),
      });
      for (const v of result.violations) {
        violations.push({
          id: `${ph}-${v.id}`,
          severity: v.severity,
          title: `[${v.layer} ${ph}] ${v.title.replace(/^\[(SHACL|Lean|GraphQL)\]\s*/i, '')}`,
          reason: v.reason,
          phase: ph,
          layer: v.layer,
        });
      }
      return result;
    };

    if ((phase === 'pre' || phase === 'both') && structuredPre) {
      const preCascade = await runPhase('pre', structuredPre);
      cascade.pre = preCascade;
      schema.pre = preCascade.layers.shacl?.raw ?? preCascade.layers.shacl;
      engine = preCascade.layers.graphql?.engine
        || preCascade.layers.lean?.engine
        || preCascade.layers.shacl?.engine
        || engine;
    }
    if ((phase === 'post' || phase === 'both') && structuredPost) {
      const postCascade = await runPhase('post', structuredPost);
      cascade.post = postCascade;
      schema.post = postCascade.layers.shacl?.raw ?? postCascade.layers.shacl;
      engine = postCascade.layers.graphql?.engine
        || postCascade.layers.lean?.engine
        || postCascade.layers.shacl?.engine
        || engine;
    }
  }

  const blocking = violations.filter((v) => v.severity === 'blocking');
  const ok = blocking.length === 0;
  const suggestions = buildOntologySuggestions(violations);

  const { buildOntologyHookContext, formatOntologyHookContextScope } = await import(
    './ontology-hook-context.js'
  );
  const endpoint =
    active
      ? {
          provider: active.provider,
          sandboxId: active.sandboxId,
          shaclPort: 7004,
          guardrailsPort: 7003,
        }
      : undefined;

  const layerSnap = (c: any) =>
    c
      ? (['shacl', 'lean', 'graphql'] as const)
          .map((layer) => {
            const L = c.layers?.[layer];
            return L
              ? { layer, engine: L.engine as string | undefined, ok: L.ok as boolean | undefined }
              : null;
          })
          .filter(Boolean) as Array<{ layer: string; engine?: string; ok?: boolean }>
      : undefined;

  let ontologyHookContext: unknown;
  if (phase === 'both') {
    ontologyHookContext = {
      pre:
        args.payload && typeof args.payload === 'object'
          ? buildOntologyHookContext({
              phase: 'pre',
              tool,
              pack: args.pack,
              className: args.className,
              data: args.payload,
              endpoint,
              cascadeLayers: layerSnap(cascade.pre),
            })
          : undefined,
      post:
        (args.result || args.payload) && typeof (args.result || args.payload) === 'object'
          ? buildOntologyHookContext({
              phase: 'post',
              tool,
              pack: args.pack,
              className: args.className,
              data: args.result ?? args.payload,
              endpoint,
              cascadeLayers: layerSnap(cascade.post),
            })
          : undefined,
    };
  } else if (phase === 'post') {
    ontologyHookContext = buildOntologyHookContext({
      phase: 'post',
      tool,
      pack: args.pack,
      className: args.className,
      data: args.result ?? args.payload,
      endpoint,
      cascadeLayers: layerSnap(cascade.post),
    });
  } else {
    ontologyHookContext = buildOntologyHookContext({
      phase: 'pre',
      tool,
      pack: args.pack,
      className: args.className,
      data: args.payload,
      endpoint,
      cascadeLayers: layerSnap(cascade.pre),
    });
  }

  const scopeMd = formatOntologyHookContextScope(ontologyHookContext as any);
  const cotBase = formatShaclCot({
    phase,
    ok,
    engine,
    violations,
    suggestions,
  });
  const { buildLinkmlReasoning } = await import('./linkml-reasoning.js');
  const { appendLinkmlUsageLog, usageFromReasoning } = await import('./linkml-usage-log.js');
  const dataForReason =
    phase === 'post' ? args.result ?? args.payload : args.payload;
  const linkmlReasoning = buildLinkmlReasoning({
    pack: args.pack,
    className: args.className,
    tool,
    data: dataForReason,
  });
  // attach on context for consumers that only read ontologyHookContext
  if (ontologyHookContext && typeof ontologyHookContext === 'object' && !Array.isArray(ontologyHookContext)) {
    if ((ontologyHookContext as any).phase) {
      (ontologyHookContext as any).linkmlReasoning = linkmlReasoning;
    } else {
      if ((ontologyHookContext as any).pre) {
        (ontologyHookContext as any).pre.linkmlReasoning = linkmlReasoning;
      }
      if ((ontologyHookContext as any).post) {
        (ontologyHookContext as any).post.linkmlReasoning = linkmlReasoning;
      }
    }
  }
  appendLinkmlUsageLog(
    usageFromReasoning(linkmlReasoning, {
      phase,
      ok,
      layers: args.layers || ['shacl', 'lean', 'graphql'],
      sandboxId: active?.sandboxId ?? null,
    }),
  );

  // Host Surreal: full I/O for cascade layers + call envelope
  const { recordValidationCall, endpointIosFromCascade } = await import(
    './validation-io-store.js'
  );
  const cascadeForIo =
    phase === 'post'
      ? (cascade as any)?.post || cascade
      : (cascade as any)?.pre || cascade;
  const ioLayers = endpointIosFromCascade(
    cascadeForIo,
    dataForReason,
    phase,
  );
  // Always log a rules/danger layer if no cascade layers but violations exist
  if (!ioLayers.length && violations.length) {
    ioLayers.push({
      layer: 'rules',
      phase,
      ok,
      engine: engine || 'rules',
      request: dataForReason,
      response: { violations },
      violations,
    });
  }
  // Guardrails routing labels as synthetic endpoint row when context present
  const guardNames =
    (ontologyHookContext as any)?.guardrails ||
    (ontologyHookContext as any)?.pre?.guardrails ||
    [];
  if (Array.isArray(guardNames) && guardNames.length) {
    ioLayers.push({
      layer: 'guardrails',
      phase,
      ok: true,
      engine: 'routing-labels',
      request: { tool },
      response: {
        names: guardNames.map((g: { name?: string }) => g.name).filter(Boolean),
      },
    });
  }
  const persisted = await recordValidationCall({
    tool,
    phase,
    pack: String(args.pack || linkmlReasoning.pack || 'verifier-fleet'),
    className: args.className || linkmlReasoning.rootClass,
    ok,
    layers: args.layers || ['shacl', 'lean', 'graphql'],
    sandbox_id: active?.sandboxId ?? null,
    provider: active?.provider ?? null,
    input: args.payload,
    output: {
      ok,
      violations,
      cascade: truncateForStore(cascade),
      schema: truncateForStore(schema),
    },
    violations,
    linkml_reasoning: {
      classesUsed: linkmlReasoning.classesUsed,
      resolversUsed: linkmlReasoning.resolversUsed,
      mutationsReferenced: linkmlReasoning.mutationsReferenced,
      relationshipsUsed: linkmlReasoning.relationshipsUsed,
      narrative: linkmlReasoning.narrative,
    },
    endpoint_ios: ioLayers,
    source: 'tool_io_guard',
  });

  const cot = `${cotBase}\n\n${scopeMd}\n\n${linkmlReasoning.narrative}`;
  return {
    ok,
    tool,
    phase,
    violations,
    schema,
    cascade,
    ontologyHookContext,
    linkmlReasoning,
    validationCallId: persisted.call_id,
    validationIoSurreal: persisted.surreal,
    layers: args.layers || ['shacl', 'lean', 'graphql'],
    sandboxId: active?.sandboxId ?? null,
    ontologyEnforcement: cfg.ontologyEnforcement,
    ontologyEditing: cfg.ontologyEditing,
    ontologySuggestions: suggestions,
    cot,
    reasoningSummary: cot,
  };
}

function truncateForStore(value: unknown, max = 24_000): unknown {
  try {
    const s = JSON.stringify(value);
    if (s.length <= max) return value;
    return { _truncated: true, preview: s.slice(0, max), bytes: s.length };
  } catch {
    return null;
  }
}

/** Explicit full-stack validate: SHACL → Lean → GraphQL. */
export async function handlePxValidateCascade(args: {
  data: unknown;
  pack?: string;
  className?: string;
  layers?: Array<'shacl' | 'lean' | 'graphql'>;
  shortCircuit?: boolean;
  force?: boolean;
}): Promise<Record<string, unknown>> {
  if (!isOntologyEnforcementEnabled() && !args.force) {
    return {
      ...enforcementSkipPayload('both'),
      note: 'pass force:true to validate while enforcement is off',
    };
  }
  const { runValidationCascade } = await import('./validation-cascade.js');
  const { hostInvokeShacl } = await import('./provider.js');
  const result = await runValidationCascade({
    data: args.data,
    pack: args.pack,
    className: args.className,
    layers: args.layers,
    shortCircuit: args.shortCircuit,
    invokeShacl: active?.invokeShacl
      ? (body) => active!.invokeShacl!(body)
      : (body) => hostInvokeShacl(body),
  });
  const suggestions = buildOntologySuggestions(result.violations);
  const { buildOntologyHookContext, formatOntologyHookContextScope } = await import(
    './ontology-hook-context.js'
  );
  const ontologyHookContext = buildOntologyHookContext({
    phase: 'pre',
    tool: 'px_validate_cascade',
    pack: args.pack,
    className: args.className || result.className,
    data: args.data,
    endpoint: active
      ? {
          provider: active.provider,
          sandboxId: active.sandboxId,
          shaclPort: 7004,
          guardrailsPort: 7003,
        }
      : undefined,
    cascadeLayers: (['shacl', 'lean', 'graphql'] as const)
      .map((layer) => {
        const L = (result.layers as any)?.[layer];
        return L ? { layer, engine: L.engine, ok: L.ok } : null;
      })
      .filter(Boolean) as Array<{ layer: string; engine?: string; ok?: boolean }>,
  });
  const { buildLinkmlReasoning } = await import('./linkml-reasoning.js');
  const { appendLinkmlUsageLog, usageFromReasoning } = await import('./linkml-usage-log.js');
  const linkmlReasoning = buildLinkmlReasoning({
    pack: args.pack,
    className: args.className || result.className,
    tool: 'px_validate_cascade',
    data: args.data,
  });
  (ontologyHookContext as any).linkmlReasoning = linkmlReasoning;
  appendLinkmlUsageLog(
    usageFromReasoning(linkmlReasoning, {
      phase: 'both',
      ok: result.ok,
      layers: args.layers || ['shacl', 'lean', 'graphql'],
      sandboxId: active?.sandboxId ?? null,
    }),
  );
  const { recordValidationCall, endpointIosFromCascade } = await import(
    './validation-io-store.js'
  );
  const cascadePersisted = await recordValidationCall({
    tool: 'px_validate_cascade',
    phase: 'both',
    pack: String(args.pack || result.pack || linkmlReasoning.pack),
    className: args.className || result.className,
    ok: result.ok,
    layers: args.layers || ['shacl', 'lean', 'graphql'],
    sandbox_id: active?.sandboxId ?? null,
    provider: active?.provider ?? null,
    input: args.data,
    output: {
      ok: result.ok,
      violations: result.violations,
      layers: result.layers,
      durationMs: result.durationMs,
    },
    violations: result.violations,
    linkml_reasoning: {
      classesUsed: linkmlReasoning.classesUsed,
      resolversUsed: linkmlReasoning.resolversUsed,
      mutationsReferenced: linkmlReasoning.mutationsReferenced,
      relationshipsUsed: linkmlReasoning.relationshipsUsed,
      narrative: linkmlReasoning.narrative,
    },
    endpoint_ios: endpointIosFromCascade(result, args.data, 'both'),
    duration_ms: result.durationMs,
    source: 'px_validate_cascade',
  });
  const cotBase = formatShaclCot({
    phase: 'both',
    ok: result.ok,
    engine: 'cascade',
    violations: result.violations,
    suggestions,
  });
  const cot = `${cotBase}\n\n${formatOntologyHookContextScope(ontologyHookContext)}\n\n${linkmlReasoning.narrative}`;
  return {
    ...result,
    linkmlReasoning,
    validationCallId: cascadePersisted.call_id,
    validationIoSurreal: cascadePersisted.surreal,
    ontologyHookContext,
    ontologySuggestions: suggestions,
    ontologyEnforcement: isOntologyEnforcementEnabled(),
    cot,
    reasoningSummary: cot,
    sandboxId: active?.sandboxId ?? null,
  };
}

/** Cheap scope tag + shapes/relationships (no pySHACL). */
export async function handlePxOntologyScope(args: {
  pack?: string;
  className?: string;
  tool?: string;
  text?: string;
  payload?: unknown;
  phase?: 'pre' | 'post';
}): Promise<Record<string, unknown>> {
  const { resolvePack } = await import('./pack-resolve.js');
  const resolved = resolvePack({
    pack: args.pack,
    className: args.className,
    tool: args.tool,
    text: args.text,
    payload: args.payload,
  });
  const { buildOntologyHookContext } = await import('./ontology-hook-context.js');
  const ontologyHookContext = buildOntologyHookContext({
    phase: args.phase || 'pre',
    tool: args.tool || 'px_ontology_scope',
    pack: resolved.pack,
    className: resolved.className,
    data: args.payload,
    endpoint: active
      ? {
          provider: active.provider,
          sandboxId: active.sandboxId,
          shaclPort: 7004,
          guardrailsPort: 7003,
        }
      : undefined,
  });
  return {
    ok: true,
    packResolve: resolved,
    relevantOntologyTag: ontologyHookContext.relevantOntologyTag,
    relevantOntologyCount: ontologyHookContext.relevantOntologyCount,
    ontologyHookContext,
    sandboxId: active?.sandboxId ?? null,
  };
}

export async function handlePxPackResolve(args: {
  pack?: string;
  className?: string;
  tool?: string;
  text?: string;
  payload?: unknown;
}): Promise<Record<string, unknown>> {
  const { resolvePack } = await import('./pack-resolve.js');
  const resolved = resolvePack(args);
  return { ok: true, ...resolved };
}

/** Artifact + enforcement readiness for packs. */
export async function handlePxPipelineReady(args?: {
  packs?: string[];
  live?: boolean;
  text?: string;
}): Promise<Record<string, unknown>> {
  const fs = await import('fs');
  const path = await import('path');
  const { resolvePxRoot } = await import('./px-pack.js');
  const { getExampleCustomer, customerPaths, EXAMPLE_CUSTOMERS } = await import(
    './example-customers.js'
  );
  const { resolvePack } = await import('./pack-resolve.js');
  const { buildOntologyHookContext } = await import('./ontology-hook-context.js');
  const { readPxOntologyConfig } = await import('./px-config.js');

  const cfg = readPxOntologyConfig();
  const profile = (process.env.PX_VALIDATION_PROFILE || 'dev').toLowerCase();
  const px = resolvePxRoot();
  const want =
    args?.packs?.length
      ? args.packs
      : args?.text
        ? [resolvePack({ text: args.text }).pack]
        : EXAMPLE_CUSTOMERS.map((c) => c.pack);

  const packs: Record<string, unknown> = {};
  let allReady = true;
  for (const p of want) {
    const c = getExampleCustomer(p);
    if (!c) {
      packs[p] = { ready: false, error: 'unknown pack' };
      allReady = false;
      continue;
    }
    const paths = customerPaths(c, px);
    const checks: Record<string, boolean> = {
      metamodel: Boolean(paths && fs.existsSync(paths.metamodel)),
      shacl: Boolean(paths && fs.existsSync(paths.shacl)),
      leanRules: Boolean(
        px && fs.existsSync(path.join(px, 'generated', `${c.pack}.lean-rules.json`)),
      ),
      graphql: Boolean(px && fs.existsSync(path.join(px, 'generated', `${c.pack}.graphql`))),
      resolvers: Boolean(
        px && fs.existsSync(path.join(px, 'generated', `${c.pack}.resolvers.json`)),
      ),
    };
    // skydio may lack lean-rules — only require metamodel+shacl for ready base
    const ready = checks.metamodel && checks.shacl;
    if (!ready) allReady = false;
    packs[p] = { ready, checks, paths, customerId: c.id };
  }

  let live: unknown = null;
  if (args?.live) {
    if (!active?.invokeShacl) {
      live = { ok: false, error: 'no active sandbox — call px_sandbox_create first' };
      allReady = false;
    } else {
      try {
        const healthPack = want[0] || 'oteemo';
        const r = await active.invokeShacl({
          data: { _health: true },
          pack: healthPack,
        });
        live = {
          ok: r.engine !== 'unavailable',
          engine: r.engine,
          sandboxId: active.sandboxId,
          provider: active.provider,
        };
        if (active.provider === 'mock') {
          live = { ...live, warning: 'provider is mock — not a live Daytona endpoint' };
        }
      } catch (e) {
        live = { ok: false, error: e instanceof Error ? e.message : String(e) };
        allReady = false;
      }
    }
  }

  const scopePack = want[0] || 'oteemo';
  const ontologyHookContext = buildOntologyHookContext({
    phase: 'pre',
    tool: 'px_pipeline_ready',
    pack: scopePack,
    data: {},
    endpoint: active
      ? {
          provider: active.provider,
          sandboxId: active.sandboxId,
          shaclPort: 7004,
          guardrailsPort: 7003,
        }
      : undefined,
  });

  return {
    ok: allReady && cfg.ontologyEnforcement,
    ready: allReady && cfg.ontologyEnforcement,
    profile,
    ontologyEnforcement: cfg.ontologyEnforcement,
    ontologyEditing: cfg.ontologyEditing,
    pxRoot: px,
    packs,
    live,
    relevantOntologyTag: ontologyHookContext.relevantOntologyTag,
    ontologyHookContext,
    note: !cfg.ontologyEnforcement
      ? 'ontologyEnforcement is OFF — pipeline will skip blocking gates'
      : allReady
        ? 'artifacts present; enforcement on'
        : 'missing artifacts — run generate-linkml-artifacts.sh',
  };
}

/** List recent LinkML usage (when/how packs were applied + reasoning summaries). */
export async function handlePxLinkmlUsage(args?: {
  limit?: number;
  pack?: string;
}): Promise<Record<string, unknown>> {
  const { readLinkmlUsageLog } = await import('./linkml-usage-log.js');
  const log = readLinkmlUsageLog({
    limit: args?.limit ?? 50,
    pack: args?.pack,
  });
  return {
    ok: true,
    ...log,
    note: 'Host log at .px/session/linkml-usage.jsonl — appended by tool_io_guard / px_validate_cascade',
  };
}

/**
 * List formal validation I/O from host SurrealDB (validation_call / endpoint_io).
 * Surreal runs outside the sandbox; this is the query surface for UIs and agents.
 */
export async function handlePxValidationCalls(args?: {
  limit?: number;
  pack?: string;
  tool?: string;
  ok?: boolean;
  callId?: string;
  includeEndpointIo?: boolean;
}): Promise<Record<string, unknown>> {
  const { queryValidationCalls, queryEndpointIo } = await import(
    './validation-io-store.js'
  );
  const calls = await queryValidationCalls({
    limit: args?.limit ?? 40,
    pack: args?.pack,
    tool: args?.tool,
    ok: args?.ok,
  });
  let endpointIo: unknown = undefined;
  if (args?.includeEndpointIo !== false) {
    const callId = args?.callId || calls.entries[0]?.call_id;
    if (callId) {
      endpointIo = await queryEndpointIo({
        call_id: callId,
        limit: 50,
      });
    } else {
      endpointIo = await queryEndpointIo({ limit: 30 });
    }
  }
  return {
    ok: true,
    ...calls,
    endpointIo,
    note:
      'Host Surreal tables validation_call + endpoint_io (SHACL/Lean/GraphQL/Guardrails I/O). JSONL mirror: .px/session/validation-calls.jsonl',
  };
}

export async function handlePxOntologySuggest(args: {
  violations?: Array<{ id?: string; title?: string; reason?: string; message?: string }>;
}): Promise<Record<string, unknown>> {
  const cfg = readPxOntologyConfig();
  if (!cfg.ontologyEditing) {
    return {
      ok: false,
      error: 'ontologyEditing is OFF — run /ontology-edit on to enable schema suggestions',
      ontologyEditing: false,
      suggestions: [],
    };
  }
  const suggestions = buildOntologySuggestions(args.violations || []);
  const cot = formatShaclCot({
    phase: 'both',
    ok: false,
    engine: 'suggest',
    violations: args.violations || [],
    suggestions,
  });
  return { ok: true, ontologyEditing: true, suggestions, cot, reasoningSummary: cot };
}

export async function handleOntologyMode(args: {
  action?: string;
  target?: 'enforce' | 'edit';
}): Promise<Record<string, unknown>> {
  const target = args.target || 'enforce';
  const action = (args.action || 'status').toLowerCase();
  const { writePxOntologyConfig, readPxOntologyConfig: read } = await import('./px-config.js');
  if (action === 'status') {
    const c = read();
    return { ok: true, ...c, cot: formatShaclCot({ phase: 'both', ok: true, skipped: !c.ontologyEnforcement, skipReason: c.ontologyEnforcement ? undefined : 'status' }) };
  }
  if (target === 'edit') {
    if (action === 'on') writePxOntologyConfig({ ontologyEditing: true });
    else if (action === 'off') writePxOntologyConfig({ ontologyEditing: false });
    else if (action === 'toggle') {
      const c = read();
      writePxOntologyConfig({ ontologyEditing: !c.ontologyEditing });
    }
  } else {
    if (action === 'on') writePxOntologyConfig({ ontologyEnforcement: true });
    else if (action === 'off') writePxOntologyConfig({ ontologyEnforcement: false });
    else if (action === 'toggle') {
      const c = read();
      writePxOntologyConfig({ ontologyEnforcement: !c.ontologyEnforcement });
    }
  }
  const c = read();
  return {
    ok: true,
    ...c,
    message:
      target === 'edit'
        ? `Ontology editing: ${c.ontologyEditing ? 'ON' : 'OFF'}`
        : `Ontology enforcement: ${c.ontologyEnforcement ? 'ON' : 'OFF'}`,
  };
}
