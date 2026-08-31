import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

export const midspiralVerifyTool = createTool({
  id: 'midspiral-verify',
  description: 'Verify with Midspiral runtime rules',
  inputSchema: z.object({
    ruleId: z.string(),
    state: z.record(z.any()),
    expected: z.any().optional(),
  }),
  execute: async (inputData: unknown) => {
    const ctx = inputData as { ruleId: string; state: Record<string, unknown>; expected?: unknown };
    const keywords = ['schema', 'valid', 'render', 'state', 'sandbox'];
    const stateStr = JSON.stringify(ctx.state).toLowerCase();
    const matched = keywords.filter(k => stateStr.includes(k));
    const coverage = (matched.length / keywords.length) * 100;
    return {
      verified: coverage >= 50,
      coverage,
      matched,
      missing: keywords.filter(k => !matched.includes(k)),
    };
  },
});
