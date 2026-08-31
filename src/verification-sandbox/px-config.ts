/**
 * Shared .px/config.json gates for ontology enforcement vs editing.
 *
 * - ontologyEnforcement: pre/post SHACL + sandboxed MCP validate may block
 * - ontologyEditing: schema/DDL/LinkML mutation + suggestion apply path
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface PxOntologyConfig {
  ontologyEditing: boolean;
  ontologyEnforcement: boolean;
  updatedAt?: string;
  path: string;
}

function truthyEnv(v: string | undefined): boolean | null {
  if (v === undefined || v === '') return null;
  const s = v.toLowerCase();
  if (s === '1' || s === 'true' || s === 'on' || s === 'yes') return true;
  if (s === '0' || s === 'false' || s === 'off' || s === 'no') return false;
  return null;
}

export function resolvePxConfigPath(explicitRoot?: string): string {
  const candidates = [
    explicitRoot && path.join(explicitRoot, '.px/config.json'),
    process.env.PX_ROOT && path.join(process.env.PX_ROOT, 'config.json'),
    process.env.PX_ROOT && path.join(process.env.PX_ROOT, '../config.json'),
    path.resolve(process.cwd(), '.px/config.json'),
    path.resolve(__dirname, '../../../.px/config.json'),
    path.resolve(
      process.env.HOME || '',
      'Documents/Personal/employment/partners/experiments/01-platform/cloud-agent/.px/config.json',
    ),
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return path.resolve(c);
    } catch {
      /* */
    }
  }
  // default write location: cloud-agent .px
  return path.resolve(__dirname, '../../../.px/config.json');
}

export function readPxOntologyConfig(explicitRoot?: string): PxOntologyConfig {
  const cfgPath = resolvePxConfigPath(explicitRoot);
  let ontologyEditing = false;
  let ontologyEnforcement = true;
  let updatedAt: string | undefined;

  if (fs.existsSync(cfgPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
      ontologyEditing = Boolean(raw.ontologyEditing);
      if (raw.ontologyEnforcement !== undefined) {
        ontologyEnforcement = Boolean(raw.ontologyEnforcement);
      }
      if (typeof raw.updatedAt === 'string') updatedAt = raw.updatedAt;
    } catch {
      /* defaults */
    }
  }

  const editEnv = truthyEnv(process.env.PX_ONTOLOGY_EDIT);
  if (editEnv !== null) ontologyEditing = editEnv;
  const enfEnv = truthyEnv(process.env.PX_ONTOLOGY_ENFORCE);
  if (enfEnv !== null) ontologyEnforcement = enfEnv;

  return { ontologyEditing, ontologyEnforcement, updatedAt, path: cfgPath };
}

export function writePxOntologyConfig(
  partial: { ontologyEditing?: boolean; ontologyEnforcement?: boolean },
  explicitRoot?: string,
): PxOntologyConfig {
  const profile = (process.env.PX_VALIDATION_PROFILE || 'dev').toLowerCase();
  if (
    profile === 'strict' &&
    partial.ontologyEnforcement === false &&
    process.env.PX_ALLOW_ENFORCE_OFF !== '1'
  ) {
    throw new Error(
      'PX_VALIDATION_PROFILE=strict forbids turning ontologyEnforcement off without PX_ALLOW_ENFORCE_OFF=1',
    );
  }
  const cfgPath = resolvePxConfigPath(explicitRoot);
  fs.mkdirSync(path.dirname(cfgPath), { recursive: true });
  let cur: Record<string, unknown> = {};
  if (fs.existsSync(cfgPath)) {
    try {
      cur = JSON.parse(fs.readFileSync(cfgPath, 'utf8')) as Record<string, unknown>;
    } catch {
      cur = {};
    }
  }
  if (partial.ontologyEditing !== undefined) cur.ontologyEditing = partial.ontologyEditing;
  if (partial.ontologyEnforcement !== undefined) {
    cur.ontologyEnforcement = partial.ontologyEnforcement;
  }
  if (cur.ontologyEditing === undefined) cur.ontologyEditing = false;
  if (cur.ontologyEnforcement === undefined) cur.ontologyEnforcement = true;
  cur.updatedAt = new Date().toISOString();
  fs.writeFileSync(cfgPath, JSON.stringify(cur, null, 2) + '\n');
  return readPxOntologyConfig(explicitRoot);
}

export function isOntologyEnforcementEnabled(explicitRoot?: string): boolean {
  return readPxOntologyConfig(explicitRoot).ontologyEnforcement;
}

export function isOntologyEditingEnabled(explicitRoot?: string): boolean {
  return readPxOntologyConfig(explicitRoot).ontologyEditing;
}
