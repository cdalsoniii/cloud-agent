import type { PackPlan, PackedService, SandboxProviderName, VerifierBackend } from './types.js';
import { SERVICE_PORTS } from './types.js';

const SERVICE_LABEL: Record<VerifierBackend, string> = {
  lean: 'Safety & correctness service',
  haskell: 'Property service',
  boundaryml: 'Structure & content service',
};

export function resolveProvider(env: NodeJS.ProcessEnv = process.env): SandboxProviderName {
  const raw = (env.VERIFIER_SANDBOX_PROVIDER || 'daytona').toLowerCase();
  if (raw === 'e2b') return 'e2b';
  if (raw === 'mock') return 'mock';
  return 'daytona';
}

export interface SelectableVerifier {
  verifier_id: string;
  backend: VerifierBackend;
}

/** Always one sandbox for the selected pipeline. */
export function packVerifiers(
  selected: readonly SelectableVerifier[],
  provider?: SandboxProviderName,
): PackPlan {
  const backends = Array.from(new Set(selected.map((v) => v.backend))) as VerifierBackend[];
  const services: PackedService[] = backends.map((backend) => ({
    backend,
    port: SERVICE_PORTS[backend],
    path: '/verify',
    label: SERVICE_LABEL[backend],
  }));

  return {
    sandboxCount: 1,
    provider: provider ?? resolveProvider(),
    services,
    backends,
    verifierIds: selected.map((v) => v.verifier_id),
  };
}

export function fullTemplateServices(): PackedService[] {
  return (Object.keys(SERVICE_PORTS) as VerifierBackend[]).map((backend) => ({
    backend,
    port: SERVICE_PORTS[backend],
    path: '/verify',
    label: SERVICE_LABEL[backend],
  }));
}
