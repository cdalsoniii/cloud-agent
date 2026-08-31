export interface DiagramNode {
  id: string;
  label: string;
  type?: string;
  position?: { x: number; y: number };
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
}

export interface DiagramData {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

export function generateMermaidFromMCP(mcpDefinition: unknown): string {
  const mcp = mcpDefinition as Record<string, unknown> | null;
  if (!mcp) {
    return "flowchart TD\n  A[No MCP Definition]";
  }

  const name = (mcp.name as string) || "MCP Tool";
  const description = (mcp.description as string) || "";

  const inputSchema = mcp.inputSchema as Record<string, unknown> | undefined;
  const outputSchema = mcp.outputSchema as Record<string, unknown> | undefined;

  const inputProps = inputSchema
    ? Object.keys((inputSchema.properties as Record<string, unknown>) || {})
    : [];
  const outputProps = outputSchema
    ? Object.keys((outputSchema.properties as Record<string, unknown>) || {})
    : [];

  let diagram = `flowchart TD\n`;
  diagram += `  Start([Start]) --> InputValidation[Input Validation]\n`;
  diagram += `  InputValidation --> InputSchema[Input Schema\\n${inputProps.join(", ") || "none"}]\n`;
  diagram += `  InputSchema --> ToolExecution[${name}\\n${description}]\n`;
  diagram += `  ToolExecution --> OutputValidation[Output Validation]\n`;
  diagram += `  OutputValidation --> OutputSchema[Output Schema\\n${outputProps.join(", ") || "none"}]\n`;
  diagram += `  OutputSchema --> End([End])\n`;

  return diagram;
}

export function validateDiagramData(data: DiagramData): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!data.nodes || data.nodes.length === 0) {
    errors.push("Diagram must have at least one node");
  }

  if (!data.edges) {
    errors.push("Diagram must have edges array");
  }

  const nodeIds = new Set<string>();
  const duplicateIds = new Set<string>();
  for (const node of data.nodes || []) {
    if (nodeIds.has(node.id)) {
      duplicateIds.add(node.id);
    }
    nodeIds.add(node.id);
  }
  if (duplicateIds.size > 0) {
    errors.push(`Duplicate node IDs: ${Array.from(duplicateIds).join(", ")}`);
  }

  for (const edge of data.edges || []) {
    if (!nodeIds.has(edge.source)) {
      errors.push(`Edge source '${edge.source}' does not exist in nodes`);
    }
    if (!nodeIds.has(edge.target)) {
      errors.push(`Edge target '${edge.target}' does not exist in nodes`);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function generateFlowNodes(
  mcpDefinition: unknown
): { nodes: DiagramNode[]; edges: DiagramEdge[] } {
  const mcp = mcpDefinition as Record<string, unknown> | null;
  if (!mcp) {
    return {
      nodes: [{ id: "empty", label: "No MCP Definition", position: { x: 0, y: 0 } }],
      edges: [],
    };
  }

  const name = (mcp.name as string) || "MCP Tool";
  const description = (mcp.description as string) || "";

  const inputSchema = mcp.inputSchema as Record<string, unknown> | undefined;
  const outputSchema = mcp.outputSchema as Record<string, unknown> | undefined;
  const inputProps = inputSchema
    ? Object.keys((inputSchema.properties as Record<string, unknown>) || {})
    : [];
  const outputProps = outputSchema
    ? Object.keys((outputSchema.properties as Record<string, unknown>) || {})
    : [];

  const nodes: DiagramNode[] = [
    { id: "start", label: "Start", position: { x: 100, y: 0 } },
    { id: "input-validation", label: "Input Validation", position: { x: 100, y: 100 } },
    {
      id: "input-schema",
      label: `Input Schema\n${inputProps.join(", ") || "none"}`,
      position: { x: 100, y: 200 },
    },
    {
      id: "tool-execution",
      label: `${name}\n${description}`,
      position: { x: 300, y: 150 },
    },
    { id: "output-validation", label: "Output Validation", position: { x: 500, y: 100 } },
    {
      id: "output-schema",
      label: `Output Schema\n${outputProps.join(", ") || "none"}`,
      position: { x: 500, y: 200 },
    },
    { id: "end", label: "End", position: { x: 500, y: 300 } },
  ];

  const edges: DiagramEdge[] = [
    { id: "e1", source: "start", target: "input-validation" },
    { id: "e2", source: "input-validation", target: "input-schema" },
    { id: "e3", source: "input-schema", target: "tool-execution" },
    { id: "e4", source: "tool-execution", target: "output-validation" },
    { id: "e5", source: "output-validation", target: "output-schema" },
    { id: "e6", source: "output-schema", target: "end" },
  ];

  return { nodes, edges };
}
