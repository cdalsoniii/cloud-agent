import { Agent } from '@mastra/core/agent';
import { dafnyVerifyTool } from '../tools/dafny-verify.js';
import { midspiralVerifyTool } from '../tools/midspiral-verify.js';

export const verifyAgent = new Agent({
  id: 'verify-agent',
  name: 'Verify Agent',
  instructions: 'You are a verification agent. Use Dafny formal verification and Midspiral runtime checks to verify MCP tool definitions, UI state consistency, and diagram validity.',
  model: 'openai/gpt-4o',
  tools: { dafnyVerifyTool, midspiralVerifyTool },
});
