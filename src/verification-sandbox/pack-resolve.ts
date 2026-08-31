/**
 * Resolve LinkML pack + root class from free text, tool name, or explicit pack.
 */
export interface PackResolveResult {
  pack: string;
  className: string;
  reason: string;
  confidence: 'high' | 'medium' | 'low';
}

let lastPack: PackResolveResult | null = null;

const RULES: Array<{
  pack: string;
  className: string;
  keywords: RegExp;
  reason: string;
}> = [
  {
    pack: 'skydio',
    className: 'IncidentPostmortemReport',
    keywords:
      /\b(skydio|drone|x10|x2|dock|remote\s*ops|dfr|postmortem|fleet\s*readiness|autonomy)\b/i,
    reason: 'keyword match → skydio-ops pack',
  },
  {
    pack: 'oteemo',
    className: 'Engagement',
    keywords:
      /\b(oteemo|devsecops|engagement|axiom|pipeline\s*gate|security\s*control|client-state)\b/i,
    reason: 'keyword match → oteemo-devsecops pack',
  },
  {
    pack: 'verifier-fleet',
    className: 'VerifierFleet',
    keywords: /\b(verifier-fleet|verifier_fleet|lean\s*proof|fleet_id|dafny)\b/i,
    reason: 'keyword match → verifier-fleet pack',
  },
];

const TOOL_PACK: Record<string, PackResolveResult> = {
  deploy_manifest: {
    pack: 'oteemo',
    className: 'Engagement',
    reason: 'tool deploy_manifest → oteemo',
    confidence: 'high',
  },
  scan_image: {
    pack: 'oteemo',
    className: 'Engagement',
    reason: 'tool scan_image → oteemo',
    confidence: 'high',
  },
  schedule_internal_client_state_meeting: {
    pack: 'oteemo',
    className: 'Engagement',
    reason: 'tool client-state meeting → oteemo',
    confidence: 'high',
  },
  request_promotion_review: {
    pack: 'oteemo',
    className: 'Engagement',
    reason: 'default promotion tool map (override pack for skydio)',
    confidence: 'medium',
  },
};

export function getLastResolvedPack(): PackResolveResult | null {
  return lastPack;
}

export function setLastResolvedPack(r: PackResolveResult): void {
  lastPack = r;
}

export function resolvePack(opts: {
  pack?: string;
  className?: string;
  tool?: string;
  text?: string;
  payload?: unknown;
}): PackResolveResult {
  if (opts.pack && String(opts.pack).trim()) {
    const pack = String(opts.pack).toLowerCase().replace(/_/g, '-');
    const className =
      opts.className ||
      (pack === 'skydio'
        ? 'IncidentPostmortemReport'
        : pack === 'oteemo' || pack === 'oteemo-devsecops'
          ? 'Engagement'
          : 'VerifierFleet');
    const r: PackResolveResult = {
      pack: pack === 'oteemo-devsecops' ? 'oteemo' : pack,
      className,
      reason: 'explicit pack argument',
      confidence: 'high',
    };
    lastPack = r;
    return r;
  }

  const tool = (opts.tool || '').toLowerCase();

  // Free-text / payload keywords beat generic tool→pack maps (e.g. promotion + "Skydio")
  const blob = [
    opts.text || '',
    typeof opts.payload === 'string' ? opts.payload : JSON.stringify(opts.payload || {}),
  ].join(' ');

  for (const rule of RULES) {
    if (rule.keywords.test(blob)) {
      const r: PackResolveResult = {
        pack: rule.pack,
        className: opts.className || rule.className,
        reason: rule.reason,
        confidence: 'high',
      };
      lastPack = r;
      return r;
    }
  }

  if (tool && TOOL_PACK[tool]) {
    const r = { ...TOOL_PACK[tool] };
    if (opts.className) r.className = opts.className;
    lastPack = r;
    return r;
  }

  // tool name alone as weak keyword signal
  for (const rule of RULES) {
    if (rule.keywords.test(tool)) {
      const r: PackResolveResult = {
        pack: rule.pack,
        className: opts.className || rule.className,
        reason: rule.reason + ' (tool name)',
        confidence: 'medium',
      };
      lastPack = r;
      return r;
    }
  }

  if (lastPack) {
    return {
      ...lastPack,
      reason: `session last pack (${lastPack.reason})`,
      confidence: 'medium',
    };
  }

  const r: PackResolveResult = {
    pack: 'verifier-fleet',
    className: opts.className || 'VerifierFleet',
    reason: 'default pack',
    confidence: 'low',
  };
  lastPack = r;
  return r;
}

/** Tools that must pass tool_io_guard pre when enforcement is on. */
export const GATED_MCP_TOOLS = new Set([
  'daytona-exec',
  'daytona-shell',
  'daytona-bootstrap',
  'daytona-create',
  'opencode-loop',
  'sdlc-batch',
  'mastra-orchestrate',
  // Host shell surfaces (harness PreToolUse)
  'run_terminal_command',
  'Bash',
  'bash',
  'shell',
]);

/** Tools that must never be double-gated / blocked by middleware. */
export const UNGATED_MCP_TOOLS = new Set([
  'px_load',
  'px_pipeline_ready',
  'px_ontology_scope',
  'px_pack_resolve',
  'px_ontology_mode',
  'px_sandbox_types',
  'px_shacl_preview',
  'px_ontology_ui_preview',
  'px_formal_preview',
  'px_formal_fleet_preview',
  'tool_io_guard',
  'px_validate_cascade',
  'px_linkml_usage',
  'px_validation_calls',
  'env-validation',
  'px_sandbox_destroy',
]);

export function isGatedMcpTool(name: string): boolean {
  const bare = name.includes('__') ? name.split('__').pop() || name : name;
  if (UNGATED_MCP_TOOLS.has(name) || UNGATED_MCP_TOOLS.has(bare)) return false;
  if (GATED_MCP_TOOLS.has(name) || GATED_MCP_TOOLS.has(bare)) return true;
  // Host editor tools are NOT cascade-gated (harness may still run danger checks)
  if (/^(write_file|search_replace|read_file|grep|list_dir|Edit|Write|Read|MultiEdit)$/i.test(bare)) {
    return false;
  }
  // heuristic: exec/shell/batch/orchestrate/deploy/terminal (not generic "write")
  return /exec|shell|batch|orchestrat|bootstrap|deploy|sdlc|terminal_command|run_terminal/i.test(
    bare,
  );
}
