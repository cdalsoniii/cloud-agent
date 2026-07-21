/**
 * Type declarations for @mastra/core to fix missing exports.
 * This module uses a version of @mastra/core that may have different exports.
 * These declarations bridge the gap to allow compilation while preserving functionality.
 */

declare module '@mastra/core' {
  import { z } from 'zod';

  export type InferZod<T> = T extends z.ZodType<infer O, any, any> ? O : never;

  /** Minimal Agent class stub for compilation */
  export class Agent {
    constructor(config: {
      name: string;
      description: string;
      instructions: string;
      model: {
        provider: string;
        name: string;
      };
      tools?: Record<string, unknown>;
    });
    generate(input: string): Promise<{ text: string }>;
  }

  /** Minimal createTool stub for compilation */
  export function createTool<TInput extends z.ZodTypeAny>(config: {
    id: string;
    description: string;
    inputSchema: TInput;
    execute: (args: { context: InferZod<TInput> }) => Promise<Record<string, unknown>>;
  }): { execute: (args: { context: any }) => Promise<any> };

  /** Minimal Workflow class stub for compilation */
  export class Workflow {
    constructor(config: { name: string; triggerSchema: z.ZodTypeAny });
    step(step: any, config?: { variables?: Record<string, any> }): this;
    after(step: any): { step(next: any, config?: { variables?: Record<string, any>; when?: Record<string, any> }): this };
    then(step: any, config?: { variables?: Record<string, any>; when?: Record<string, any> }): this;
    commit(): this;
    createRun(): { runId: string; start(triggerData: { triggerData: unknown }): Promise<unknown> };
  }

  /** Minimal Step class stub for compilation */
  export class Step<TInput extends z.ZodTypeAny> {
    constructor(config: {
      id: string;
      description?: string;
      inputSchema?: TInput;
      outputSchema?: z.ZodTypeAny;
      execute: (args: { context: InferZod<TInput> & { stepResults?: Record<string, unknown>; inputData: Record<string, unknown> } }) => Promise<Record<string, unknown>>;
    });
  }

  /** Minimal Mastra class stub for compilation */
  export class Mastra {
    constructor(config: {
      agents?: Record<string, Agent>;
      workflows?: Record<string, Workflow>;
    });
    get workflows(): Record<string, Workflow>;
  }
}
