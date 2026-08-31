// lib/midspiral-rules.ts

export interface Rule {
  ruleId: string;
  spec: string;
  code: string;
  severity: "error" | "warning" | "info";
}

export const RULES: Rule[] = [
  {
    ruleId: "rule-mcp-schema-valid",
    spec: "MCP schema must have valid JSON Schema type definitions with all required properties present in the properties map",
    code: "schema.type IN [object, array, string, number, integer, boolean, null] AND forall r in schema.required: r IN schema.properties",
    severity: "error",
  },
  {
    ruleId: "rule-diagram-renders",
    spec: "Diagram must render without errors and all nodes and edges must be visible in the rendered output",
    code: "nodes.length > 0 AND svg.contains(node.id) AND edges.length == rendered_edges",
    severity: "error",
  },
  {
    ruleId: "rule-ui-state-consistent",
    spec: "UI state must be consistent across all components with no contradictory values and must be serializable to JSON",
    code: "JSON.stringify(state) !== undefined AND no_contradictory_values(state)",
    severity: "warning",
  },
  {
    ruleId: "rule-sandbox-alive",
    spec: "Sandbox must respond to health checks with HTTP 200 status and all required services must be running",
    code: "health.status == 200 AND services.all(s => s.status == running)",
    severity: "error",
  },
  {
    ruleId: "rule-mcp-server-executes",
    spec: "Generated MCP server must start successfully and respond to tool requests with correct output schema",
    code: "server.start() AND tool.execute(input).schema == output_schema",
    severity: "error",
  },
];

export function getRuleById(ruleId: string): Rule | undefined {
  return RULES.find((r) => r.ruleId === ruleId);
}

export function getAllRules(): Rule[] {
  return RULES.slice();
}

/**
 * Simple keyword‑based evaluation.
 */
export function evaluateRule(
  ruleId: string,
  state: Record<string, unknown>,
): boolean {
  const rule = getRuleById(ruleId);
  if (!rule) return false;
  const keywords = rule.spec
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !["must", "have", "with", "and", "all", "the"].includes(w));
  const stateStr = JSON.stringify(state).toLowerCase();
  return keywords.some((k) => stateStr.includes(k));
}

export interface MidspiralVerifyResult {
  verified: boolean;
  coverage: number;
  matched: string[];
  missing: string[];
}

export function validateAllRules(
  state: Record<string, unknown>,
): MidspiralVerifyResult[] {
  return RULES.map((rule) => {
    const result = evaluateRule(rule.ruleId, state);
    const keywords = rule.spec
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    const stateStr = JSON.stringify(state).toLowerCase();
    const matched = keywords.filter((k) => stateStr.includes(k));
    const missing = keywords.filter((k) => !matched.includes(k));
    const coverage = keywords.length ? (matched.length / keywords.length) * 100 : 0;
    return {
      verified: result,
      coverage,
      matched,
      missing,
    };
  });
}
