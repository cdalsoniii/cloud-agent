/**
 * Human-readable chain-of-thought summaries for SHACL / tool-io gates.
 * Agents MUST surface `cot` to the user when present.
 */
import {
  isOntologyEditingEnabled,
  isOntologyEnforcementEnabled,
  readPxOntologyConfig,
} from './px-config.js';

export interface CotViolation {
  id?: string;
  title?: string;
  reason?: string;
  severity?: string;
  message?: string;
}

export interface OntologySuggestion {
  kind: 'data' | 'schema' | 'enum' | 'required' | 'other';
  title: string;
  detail: string;
  linkmlHint?: string;
  surrealHint?: string;
}

export function formatShaclCot(opts: {
  phase: 'pre' | 'post' | 'both' | string;
  ok: boolean;
  skipped?: boolean;
  skipReason?: string;
  engine?: string;
  violations?: CotViolation[];
  explanations?: Array<{
    natural_language_explanation?: string;
    correction_suggestions?: string[];
  }>;
  suggestions?: OntologySuggestion[];
}): string {
  const lines: string[] = [];
  const phase = opts.phase || 'both';
  lines.push(`### Ontology check (${phase})`);

  if (opts.skipped) {
    lines.push(`- Status: **SKIPPED**`);
    lines.push(`- Reason: ${opts.skipReason || 'ontologyEnforcement=false'}`);
    lines.push(`- Pre/post SHACL and sandboxed MCP validate are not blocking.`);
    lines.push(`- Re-enable with: \`/ontology on\` or \`bash scripts/px-ontology-mode.sh on\``);
    return lines.join('\n');
  }

  lines.push(`- Status: **${opts.ok ? 'PASS' : 'FAIL'}**`);
  if (opts.engine) lines.push(`- Engine: ${opts.engine}`);

  const viols = opts.violations || [];
  if (!opts.ok && viols.length) {
    lines.push(`- Violations (${viols.length}):`);
    viols.slice(0, 8).forEach((v, i) => {
      const title = v.title || v.id || `v${i}`;
      const reason = v.reason || v.message || '';
      lines.push(`  ${i + 1}. ${title}${reason ? ` — ${reason.slice(0, 240)}` : ''}`);
    });
  } else if (opts.ok) {
    lines.push(`- No blocking violations.`);
  }

  if (opts.explanations?.length) {
    lines.push(`- Explain-on-fail:`);
    for (const e of opts.explanations.slice(0, 3)) {
      if (e.natural_language_explanation) {
        lines.push(`  - ${e.natural_language_explanation.slice(0, 400)}`);
      }
      for (const s of e.correction_suggestions || []) {
        lines.push(`  - Fix: ${s.slice(0, 200)}`);
      }
    }
  }

  const editing = isOntologyEditingEnabled();
  if (!opts.ok) {
    if (editing) {
      lines.push(`- Suggestion mode: **ON** (/ontology-edit)`);
      const sug = opts.suggestions || [];
      if (sug.length) {
        lines.push(`- Ontology suggestions:`);
        sug.slice(0, 6).forEach((s, i) => {
          lines.push(`  ${i + 1}. [${s.kind}] ${s.title}: ${s.detail.slice(0, 200)}`);
          if (s.linkmlHint) lines.push(`     LinkML: ${s.linkmlHint.slice(0, 160)}`);
          if (s.surrealHint) lines.push(`     Surreal: ${s.surrealHint.slice(0, 160)}`);
        });
        lines.push(`- Apply only after user confirms (do not auto-DDL).`);
      } else {
        lines.push(`- No structured suggestions generated; propose LinkML slot/enum fixes from violations.`);
      }
    } else {
      lines.push(
        `- Suggestion mode: **OFF** — repair the **instance data** only. Use \`/ontology-edit on\` to propose schema changes.`,
      );
    }
  }

  return lines.join('\n');
}

/**
 * Heuristic ontology suggestions from violation text (edit mode).
 */
export function buildOntologySuggestions(violations: CotViolation[]): OntologySuggestion[] {
  if (!isOntologyEditingEnabled()) return [];
  const out: OntologySuggestion[] = [];
  for (const v of violations) {
    const text = `${v.title || ''} ${v.reason || v.message || ''}`.toLowerCase();
    if (/required|mincount|missing/.test(text)) {
      const field =
        text.match(/fleet_id|verifier_id|name|environment|revision|report_id/)?.[0] || 'field';
      out.push({
        kind: 'required',
        title: `Required property: ${field}`,
        detail: `Instance missing or invalid required property matching "${field}". Either populate the instance or relax the shape.`,
        linkmlHint: `slots:\n  ${field}:\n    required: false  # only if product accepts optional`,
        surrealHint: `DEFINE FIELD ${field} ON your_table TYPE option<string>;`,
      });
    } else if (/not in list|enum|inconstraint|sh:in/.test(text)) {
      out.push({
        kind: 'enum',
        title: 'Enum / allowed-value mismatch',
        detail: v.reason || v.message || 'Value not in SHACL sh:in list',
        linkmlHint: `enums:\n  YourEnum:\n    permissible_values:\n      NewValue:\n        description: added for agent compatibility`,
        surrealHint: `-- extend CHECK or document allowed literals in schema comments`,
      });
    } else if (/datatype|xsd:|type/.test(text)) {
      out.push({
        kind: 'schema',
        title: 'Datatype mismatch',
        detail: v.reason || 'Instance datatype does not match shape',
        linkmlHint: `range: string  # or integer/boolean to match consumers`,
      });
    } else if (text.trim()) {
      out.push({
        kind: 'data',
        title: v.title || 'Constraint violation',
        detail: (v.reason || v.message || 'See SHACL report').slice(0, 400),
      });
    }
  }
  // de-dupe by title
  const seen = new Set<string>();
  return out.filter((s) => {
    if (seen.has(s.title)) return false;
    seen.add(s.title);
    return true;
  });
}

export function enforcementSkipPayload(phase: string = 'both') {
  const cfg = readPxOntologyConfig();
  const cot = formatShaclCot({
    phase,
    ok: true,
    skipped: true,
    skipReason: 'ontologyEnforcement=false',
  });
  return {
    ok: true,
    skipped: true,
    ontologyEnforcement: false,
    ontologyEditing: cfg.ontologyEditing,
    reason: 'ontologyEnforcement=false',
    cot,
    reasoningSummary: cot,
  };
}

export { isOntologyEnforcementEnabled, isOntologyEditingEnabled, readPxOntologyConfig };
