/**
 * Host-side LinkML → SHACL regenerate before sandbox upload.
 * Prefer product generate-linkml-artifacts.sh when gen-shacl is available.
 */
import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';

export function findGenerateScript(pxRoot?: string | null): string | null {
  const candidates = [
    pxRoot && path.resolve(pxRoot, '../scripts/generate-linkml-artifacts.sh'),
    path.resolve(
      process.env.HOME || '',
      'Documents/Personal/employment/partners/experiments/02-products/assistant-ui/scripts/generate-linkml-artifacts.sh',
    ),
    path.resolve(process.cwd(), '../02-products/assistant-ui/scripts/generate-linkml-artifacts.sh'),
  ].filter(Boolean) as string[];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function hostRegenerateLinkmlArtifacts(pxRoot?: string | null): {
  ok: boolean;
  script?: string;
  stdout?: string;
  stderr?: string;
  skipped?: boolean;
  reason?: string;
} {
  if (process.env.SHACL_SKIP_HOST_REGEN === '1') {
    return { ok: true, skipped: true, reason: 'SHACL_SKIP_HOST_REGEN=1' };
  }
  const script = findGenerateScript(pxRoot);
  if (!script) {
    return { ok: true, skipped: true, reason: 'generate-linkml-artifacts.sh not found' };
  }
  const r = spawnSync('bash', [script], {
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env },
  });
  return {
    ok: r.status === 0,
    script,
    stdout: (r.stdout || '').slice(0, 2000),
    stderr: (r.stderr || '').slice(0, 1000),
  };
}
