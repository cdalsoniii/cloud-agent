/** Local createTool shim for @mastra/core v0.1.26 which does not export createTool */
import { z } from 'zod';

type InferZod<T> = T extends z.ZodType<infer O, any, any> ? O : never;

export function createTool<TInput extends z.ZodTypeAny>(config: {
  id: string;
  description: string;
  inputSchema: TInput;
  execute: (args: { context: InferZod<TInput> }) => Promise<Record<string, unknown>>;
}): {
  id: string;
  description: string;
  inputSchema: TInput;
  execute: (args: { context: any }) => Promise<any>;
} {
  return {
    id: config.id,
    description: config.description,
    inputSchema: config.inputSchema,
    execute: async (args: { context: any }) => {
      const parsed = config.inputSchema.safeParse(args.context);
      if (!parsed.success) {
        throw new Error(`Tool ${config.id} input validation failed: ${parsed.error.message}`);
      }
      return config.execute({ context: parsed.data as any });
    },
  };
}
