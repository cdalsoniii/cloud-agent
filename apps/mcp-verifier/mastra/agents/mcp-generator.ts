import { Agent } from '@mastra/core/agent';
import { mcpGenerateTool } from '../tools/mcp-generate.js';

export const mcpGeneratorAgent = new Agent({
  id: 'mcp-generator',
  name: 'MCP Generator',
  instructions: 'You are an MCP tool generator. Given a user description, generate a complete MCP tool definition including name, description, input schema, output schema, implementation code, and test cases. Always return valid JSON.',
  model: 'openai/gpt-4o',
  tools: { mcpGenerateTool },
});
