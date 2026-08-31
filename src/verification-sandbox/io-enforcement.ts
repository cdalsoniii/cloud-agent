/**
 * Shared pre/post I/O enforcement helpers for MCP middleware and harness plugin hooks.
 * Same decision surface: tool_io_guard via callVerificationMcpTool.
 */
import { isGatedMcpTool, resolvePack, UNGATED_MCP_TOOLS } from './pack-resolve.js';
import { isOntologyEnforcementEnabled } from './px-config.js';
import { callVerificationMcpTool } from './mcp-tools.js';

export type IoPhase = 'pre' | 'post';

export interface IoEnforcementInput {
  toolName: string;
  phase: IoPhase;
  toolInput?: unknown;
  toolResult?: unknown;
  pack?: string;
  className?: string;
  text?: string;
  /** When true, even ungated tools run danger-pattern checks (shell). Default false for ungated. */
  force?: boolean;
}

export interface IoEnforcementDecision {
  ok: boolean;
  decision: 'allow' | 'deny';
  reason?: string;
  tool: string;
  phase: IoPhase;
  gated: boolean;
  pack?: string;
  className?: string;
  validation?: Record<string, unknown>;
  skipped?: boolean;
  skipReason?: string;
}

/** Normalize MCP qualified names: cloud-agent-mastra__daytona-exec → daytona-exec */
export function bareToolName(name: string): string {
  const s = String(name || '');
  if (s.includes('__')) return s.split('__').pop() || s;
  if (s.includes('/')) return s.split('/').pop() || s;
  return s;
}

export function isValidationSurfaceTool(name: string): boolean {
  const bare = bareToolName(name);
  if (UNGATED_MCP_TOOLS.has(bare)) return true;
  return /^(tool_io_guard|px_validate|px_ontology|px_pipeline|px_pack|px_load|px_shacl|px_sandbox|px_formal|fleet_run)/i.test(
    bare,
  );
}

/**
 * Extract a payload suitable for tool_io_guard from host tool envelopes.
 * Shell-like tools → { command }; structured → payload/data/body or full input.
 */
export function extractToolPayload(toolName: string, toolInput: unknown): unknown {
  const bare = bareToolName(toolName);
  if (toolInput == null) return { tool: bare };
  if (typeof toolInput === 'string') {
    return { command: toolInput, tool: bare };
  }
  if (typeof toolInput !== 'object' || Array.isArray(toolInput)) {
    return { value: toolInput, tool: bare };
  }
  const o = toolInput as Record<string, unknown>;
  if (o.payload !== undefined) return o.payload;
  if (o.data !== undefined) return o.data;
  if (o.body !== undefined) return o.body;
  if (typeof o.command === 'string') {
    return {
      command: o.command,
      ...(o.args !== undefined ? { args: o.args } : {}),
      tool: bare,
    };
  }
  // Prefer nested arguments from MCP-style envelopes
  if (o.arguments && typeof o.arguments === 'object') {
    const a = o.arguments as Record<string, unknown>;
    if (a.payload !== undefined) return a.payload;
    if (a.data !== undefined) return a.data;
    return { ...a, tool: bare };
  }
  return { ...o, tool: bare };
}

export function extractToolResult(toolResult: unknown): unknown {
  if (toolResult == null) return null;
  if (typeof toolResult === 'string') {
    try {
      return JSON.parse(toolResult);
    } catch {
      return { value: toolResult };
    }
  }
  if (typeof toolResult === 'object' && !Array.isArray(toolResult)) {
    const o = toolResult as Record<string, unknown>;
    // MCP content blocks
    if (Array.isArray(o.content)) {
      const texts = (o.content as Array<{ type?: string; text?: string }>)
        .filter((c) => c && (c.type === 'text' || c.text))
        .map((c) => c.text || '');
      if (texts.length === 1) {
        try {
          return JSON.parse(texts[0]!);
        } catch {
          return { value: texts[0] };
        }
      }
      if (texts.length > 1) return { texts };
    }
    if (o.result !== undefined) return o.result;
    return o;
  }
  return { value: toolResult };
}

/**
 * Run pre or post I/O enforcement. Source of truth: tool_io_guard MCP handler.
 */
export async function enforceToolIo(input: IoEnforcementInput): Promise<IoEnforcementDecision> {
  const tool = bareToolName(input.toolName);
  const phase = input.phase;

  if (isValidationSurfaceTool(tool) && !input.force) {
    return {
      ok: true,
      decision: 'allow',
      tool,
      phase,
      gated: false,
      skipped: true,
      skipReason: 'validation surface tool (ungated)',
    };
  }

  if (!isOntologyEnforcementEnabled()) {
    return {
      ok: true,
      decision: 'allow',
      tool,
      phase,
      gated: isGatedMcpTool(tool),
      skipped: true,
      skipReason: 'ontologyEnforcement off',
    };
  }

  const gated = isGatedMcpTool(tool);
  // Non-gated tools: only danger-pattern / empty checks via tool_io_guard without full cascade
  // unless force or structured ontology payload present
  const payload =
    phase === 'pre'
      ? extractToolPayload(tool, input.toolInput)
      : extractToolPayload(tool, input.toolInput);
  const result = phase === 'post' ? extractToolResult(input.toolResult) : undefined;

  const resolved = resolvePack({
    pack: input.pack,
    className: input.className,
    tool,
    text: input.text || '',
    payload: phase === 'pre' ? payload : result ?? payload,
  });

  /** Domain instances get full SHACL→Lean→GraphQL; shell {command} only gets danger rules. */
  const looksLikeDomainInstance = (p: unknown): boolean => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false;
    const o = p as Record<string, unknown>;
    const keys = Object.keys(o);
    const shellOnly = keys.every((k) =>
      ['command', 'cmd', 'script', 'args', 'tool', 'cwd', 'timeout', 'env'].includes(k),
    );
    if (shellOnly && (o.command || o.cmd || o.script)) return false;
    return keys.some(
      (k) =>
        ![
          'tool',
          'args',
          'command',
          'cmd',
          'script',
          'cwd',
          'timeout',
          'env',
        ].includes(k),
    );
  };

  const candidate = phase === 'pre' ? payload : result ?? payload;
  const structured = looksLikeDomainInstance(candidate);

  // Danger patterns always run inside tool_io_guard; cascade only for domain JSON
  const enforceSchema = input.force === true || structured;

  const validation = (await callVerificationMcpTool('tool_io_guard', {
    tool,
    phase,
    pack: resolved.pack,
    className: resolved.className,
    payload: phase === 'pre' ? payload : payload,
    result: phase === 'post' ? result : undefined,
    enforceSchema,
  })) as Record<string, unknown>;

  const ok = validation?.ok !== false;
  if (!ok) {
    const violations = Array.isArray(validation.violations) ? validation.violations : [];
    const blocking = violations.filter(
      (v: any) => v && (v.severity === 'blocking' || !v.severity),
    );
    const first = (blocking[0] || violations[0]) as { title?: string; reason?: string } | undefined;
    return {
      ok: false,
      decision: 'deny',
      reason:
        first?.reason ||
        first?.title ||
        `tool_io_guard ${phase} failed for ${tool}`,
      tool,
      phase,
      gated,
      pack: resolved.pack,
      className: resolved.className,
      validation,
    };
  }

  return {
    ok: true,
    decision: 'allow',
    tool,
    phase,
    gated,
    pack: resolved.pack,
    className: resolved.className,
    validation,
  };
}
