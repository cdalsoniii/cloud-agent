/**
 * Durable host-side log of LinkML validation usage (when / how).
 */
import fs from 'fs';
import path from 'path';
import type { LinkmlReasoning } from './linkml-reasoning.js';

export interface LinkmlUsageEntry {
  at: string;
  tool: string;
  phase: string;
  pack: string;
  className: string;
  ok: boolean;
  layers?: string[];
  classesUsed: string[];
  resolversUsed: string[];
  mutationsReferenced: string[];
  relationshipsUsed: string[];
  sandboxId?: string | null;
  narrative?: string;
}

function defaultLogPath(): string {
  const root = process.env.GROK_PROJECT_DIR || process.env.GROK_WORKSPACE_ROOT || process.cwd();
  return path.join(root, '.px/session/linkml-usage.jsonl');
}

export function appendLinkmlUsageLog(
  entry: LinkmlUsageEntry,
  logPath?: string,
): { path: string; ok: boolean } {
  const p = logPath || defaultLogPath();
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.appendFileSync(p, `${JSON.stringify(entry)}\n`, 'utf8');
    // also keep last full entry for UI
    fs.writeFileSync(
      path.join(path.dirname(p), 'last-linkml-reasoning.json'),
      JSON.stringify(entry, null, 2),
    );
    return { path: p, ok: true };
  } catch {
    return { path: p, ok: false };
  }
}

export function readLinkmlUsageLog(opts?: {
  limit?: number;
  pack?: string;
  logPath?: string;
}): { ok: boolean; path: string; entries: LinkmlUsageEntry[]; count: number } {
  const p = opts?.logPath || defaultLogPath();
  const limit = opts?.limit ?? 50;
  if (!fs.existsSync(p)) {
    return { ok: true, path: p, entries: [], count: 0 };
  }
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  let entries: LinkmlUsageEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as LinkmlUsageEntry);
    } catch {
      /* skip */
    }
  }
  if (opts?.pack) {
    const want = opts.pack.toLowerCase().replace(/_/g, '-');
    entries = entries.filter((e) => (e.pack || '').toLowerCase().replace(/_/g, '-') === want);
  }
  const sliced = entries.slice(-limit);
  return { ok: true, path: p, entries: sliced, count: entries.length };
}

export function usageFromReasoning(
  reasoning: LinkmlReasoning,
  extra: {
    phase: string;
    ok: boolean;
    layers?: string[];
    sandboxId?: string | null;
  },
): LinkmlUsageEntry {
  return {
    at: new Date().toISOString(),
    tool: reasoning.tool,
    phase: extra.phase,
    pack: reasoning.pack,
    className: reasoning.rootClass,
    ok: extra.ok,
    layers: extra.layers,
    classesUsed: reasoning.classesUsed,
    resolversUsed: reasoning.resolversUsed,
    mutationsReferenced: reasoning.mutationsReferenced,
    relationshipsUsed: reasoning.relationshipsUsed,
    sandboxId: extra.sandboxId,
    narrative: reasoning.narrative,
  };
}
