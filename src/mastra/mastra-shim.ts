/**
 * Runtime + type shim for @mastra/core v0.1.26
 * 
 * @mastra/core at this version is CommonJS and does not reliably export
 * named classes (Agent, Mastra, Workflow, Step, createTool) under ESM.
 *
 * This file provides minimal implementations that satisfy the usage in this repo.
 * Types are also re-declared so tsc is happy.
 */
import { z } from 'zod';

export type InferZod<T> = T extends z.ZodType<infer O, any, any> ? O : never;

// -----------------------------
// createTool (used everywhere via tool-shim or direct)
// -----------------------------
export function createTool<TInput extends z.ZodTypeAny>(config: {
  id: string;
  description: string;
  inputSchema: TInput;
  execute: (args: { context: InferZod<TInput> }) => Promise<Record<string, unknown>>;
}) {
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

// -----------------------------
// Agent (used in daytona-agent.ts)
// -----------------------------
export class Agent {
  public readonly name: string;
  public readonly description: string;
  public readonly instructions: string;
  public readonly tools: Record<string, any>;

  constructor(config: {
    name: string;
    description: string;
    instructions: string;
    model?: { provider: string; name: string };
    tools?: Record<string, any>;
  }) {
    this.name = config.name;
    this.description = config.description;
    this.instructions = config.instructions;
    this.tools = config.tools ?? {};
  }

  async generate(input: string): Promise<{ text: string }> {
    // In dry / test scenarios we just echo a structured response.
    // Real usage goes through the tool surface or Baseten.
    return {
      text: `[agent:${this.name}] ${input.slice(0, 180)}${input.length > 180 ? '…' : ''}`,
    };
  }
}

// -----------------------------
// Workflow + Step (used in daytona-workflow.ts)
// -----------------------------
export class Step<TInput extends z.ZodTypeAny = any> {
  public readonly id: string;
  public readonly description?: string;
  public readonly inputSchema?: TInput;
  public readonly outputSchema?: z.ZodTypeAny;
  public readonly execute: (args: any) => Promise<any>;

  constructor(config: {
    id: string;
    description?: string;
    inputSchema?: TInput;
    outputSchema?: z.ZodTypeAny;
    execute: (args: any) => Promise<any>;
  }) {
    this.id = config.id;
    this.description = config.description;
    this.inputSchema = config.inputSchema;
    this.outputSchema = config.outputSchema;
    this.execute = config.execute;
  }
}

export class Workflow {
  public readonly name: string;
  private _steps: any[] = [];
  private _committed = false;

  constructor(config: { name: string; triggerSchema?: z.ZodTypeAny }) {
    this.name = config.name;
  }

  step(step: any, _config?: any) {
    this._steps.push(step);
    return this;
  }

  after(_step: any): { step(next: any, cfg?: any): Workflow } {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      step(next: any, _cfg?: any) {
        self._steps.push(next);
        return self;
      },
    };
  }

  then(step: any, _config?: any) {
    this._steps.push(step);
    return this;
  }

  commit() {
    this._committed = true;
    return this;
  }

  createRun() {
    return {
      runId: `run-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      start: async (_triggerData?: any) => {
        // Execute steps sequentially in a very naive way for local/dev.
        let last: any = null;
        for (const s of this._steps) {
          if (s && typeof s.execute === 'function') {
            last = await s.execute({ context: _triggerData?.triggerData ?? _triggerData ?? {} });
          }
        }
        return { status: 'success', result: last, steps: this._steps.length };
      },
    };
  }
}

// -----------------------------
// Mastra (main container)
// -----------------------------
export class Mastra {
  public readonly agents: Record<string, Agent>;
  public readonly workflows: Record<string, Workflow>;

  constructor(config: {
    agents?: Record<string, Agent>;
    workflows?: Record<string, Workflow>;
  }) {
    this.agents = config.agents ?? {};
    this.workflows = config.workflows ?? {};
  }
}
