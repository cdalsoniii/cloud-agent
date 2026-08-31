/**
 * Packed verification sandbox types — fewest sandboxes (one multi-process box).
 */

export type SandboxProviderName = 'daytona' | 'e2b' | 'mock';
export type VerifierBackend = 'lean' | 'haskell' | 'boundaryml';

export interface PackedService {
  backend: VerifierBackend;
  port: number;
  path: string;
  label: string;
}

export interface PackPlan {
  sandboxCount: 1;
  provider: SandboxProviderName;
  services: PackedService[];
  backends: VerifierBackend[];
  verifierIds: string[];
}

export interface VerifierServiceResult {
  pass: boolean;
  detail: string;
  raw?: unknown;
  durationMs: number;
}

export const SERVICE_PORTS: Record<VerifierBackend, number> = {
  lean: 7000,
  haskell: 7001,
  boundaryml: 7002,
};

export const GUARDRAILS_PORT = 7003;

/** SHACL shapes server co-located in the packed sandbox (LinkML → pySHACL). */
export const SHACL_PORT = 7004;

/** React Flow ontology viewer (current .px / LinkML state). */
export const ONTOLOGY_UI_PORT = 7005;

/**
 * Formal-stage verifier-fleet surface (2nd sandbox lifecycle).
 * Served by formal-stack (same process as ontology UI or sibling port).
 */
export const FLEET_UI_PORT = 7006;

/** Product Next.js assistant-ui web app (packages/web). */
export const ASSISTANT_UI_WEB_PORT = 3010;

/** OpenCode serve (in-sandbox agent HTTP API for local agent / SDK). */
export const OPENCODE_SERVE_PORT = Number(process.env.OPENCODE_SERVE_PORT || 4096) || 4096;

/**
 * Daytona auto-stop interval in **minutes**.
 * Max 5 for development cost control (0 = never stop — not allowed for formal creates).
 * Override with DAYTONA_AUTO_STOP_MINUTES (clamped 1–5).
 */
export const DAYTONA_AUTO_STOP_MAX_MINUTES = 5;
export function daytonaAutoStopMinutes(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.DAYTONA_AUTO_STOP_MINUTES ?? DAYTONA_AUTO_STOP_MAX_MINUTES);
  if (!Number.isFinite(raw) || raw <= 0) return DAYTONA_AUTO_STOP_MAX_MINUTES;
  return Math.min(DAYTONA_AUTO_STOP_MAX_MINUTES, Math.max(1, Math.floor(raw)));
}

/**
 * Writable root inside Daytona sandboxes.
 * Stock snapshots run as uid=daytona — /opt is root-owned and not writable.
 * Override with REMOTE_VERIFIER_ROOT if needed.
 */
export const REMOTE_VERIFIER_ROOT =
  process.env.REMOTE_VERIFIER_ROOT ||
  process.env.VERIFIER_REMOTE_ROOT ||
  '/home/daytona/verifier';

export const REMOTE_PX_ROOT = `${REMOTE_VERIFIER_ROOT}/px`;
export const REMOTE_SHACL_SERVER = `${REMOTE_VERIFIER_ROOT}/shacl-server.py`;
export const REMOTE_SHAPES_DIR = `${REMOTE_VERIFIER_ROOT}/px/generated`;
export const REMOTE_ONTOLOGY_UI = `${REMOTE_VERIFIER_ROOT}/ontology-ui`;
export const REMOTE_ONTOLOGY_UI_SERVER = `${REMOTE_VERIFIER_ROOT}/ontology-ui-server.py`;
export const REMOTE_FLEET_UI_SERVER = `${REMOTE_VERIFIER_ROOT}/fleet-ui-server.py`;
export const REMOTE_MULTI_SERVICE = `${REMOTE_VERIFIER_ROOT}/multi-service-server.py`;

/** Remote checkout of assistant-ui monorepo subset (web + workspace deps). */
export const REMOTE_ASSISTANT_UI =
  process.env.REMOTE_ASSISTANT_UI || '/home/daytona/assistant-ui';

export interface ShaclRemoteResult {
  ok: boolean;
  conforms: boolean;
  engine: string;
  violations: Array<{
    id: string;
    severity: 'blocking' | 'important' | string;
    title: string;
    reason: string;
  }>;
  resultsText?: string;
  shapesPath?: string;
  error?: string;
  durationMs: number;
  raw?: unknown;
}

export interface ShaclPreviewUrl {
  url: string;
  token?: string;
  port: number;
  expiresInSeconds?: number;
}

export interface UploadPackResult {
  files: string[];
  remoteRoot: string;
  shapesDir: string;
  ontologyUiPort?: number;
}

export interface VerificationSandbox {
  provider: SandboxProviderName;
  sandboxId: string;
  pack: PackPlan;
  create(opts?: { env?: Record<string, string>; pxRoot?: string; skipShacl?: boolean }): Promise<void>;
  ensureServicesReady(timeoutMs?: number): Promise<void>;
  invoke(backend: VerifierBackend, body: unknown): Promise<VerifierServiceResult>;
  /** Upload LinkML + generated SHACL into the sandbox (product-owned keys). */
  uploadLinkmlPack?(localRoot?: string): Promise<UploadPackResult>;
  /** Validate JSON instance against in-sandbox SHACL server (port 7004). */
  invokeShacl?(body: {
    data: unknown;
    pack?: string;
    className?: string;
  }): Promise<ShaclRemoteResult>;
  /** Daytona signed preview for host→sandbox SHACL HTTP (no agent keys). */
  getShaclPreviewUrl?(expiresInSeconds?: number): Promise<ShaclPreviewUrl | null>;
  /** Signed preview for ontology React Flow UI (port 7005). */
  getOntologyUiPreviewUrl?(expiresInSeconds?: number): Promise<ShaclPreviewUrl | null>;
  /** Signed preview for verifier-fleet UI (port 7006). */
  getFleetUiPreviewUrl?(expiresInSeconds?: number): Promise<ShaclPreviewUrl | null>;
  /** Signed preview for assistant-ui Next web (port 3010). */
  getAssistantUiWebPreviewUrl?(expiresInSeconds?: number): Promise<ShaclPreviewUrl | null>;
  /** Upload/install/start assistant-ui web from host 02-products tree. */
  ensureAssistantUiWeb?(opts?: {
    assistantUiRoot?: string;
    skipInstall?: boolean;
  }): Promise<unknown>;
  /** Start OpenCode serve (local agent API) on OPENCODE_SERVE_PORT. */
  ensureOpenCodeServe?(opts?: { workspace?: string }): Promise<unknown>;
  /** Probe formal + OpenCode + optional Next process board. */
  probeProcesses?(opts?: {
    includeAssistantUi?: boolean;
    includeOpencode?: boolean;
  }): Promise<unknown>;
  getOpenCodePreviewUrl?(expiresInSeconds?: number): Promise<ShaclPreviewUrl | null>;
  destroy(): Promise<void>;
}
