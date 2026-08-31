import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const mcpGenerateTool = createTool({
  id: 'mcp-generate',
  description: 'Generate MCP tool definition',
  inputSchema: z.object({
    description: z.string(),
    name: z.string().optional(),
    inputSchema: z.record(z.any()).optional(),
  }),
  execute: async (inputData: unknown) => {
    const ctx = inputData as { description: string; name?: string; inputSchema?: Record<string, unknown> };
    const name = ctx.name || 'generated-tool';
    return {
      ok: true,
      mcpDefinition: {
        name,
        description: ctx.description,
        inputSchema: {
          type: 'object' as const,
          properties: ctx.inputSchema || {},
        },
        outputSchema: {
          type: 'object' as const,
        },
        implementation: `// Implementation for ${name}`,
        testCases: [] as string[],
      },
    };
  },
});
