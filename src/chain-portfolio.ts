// src/chain-portfolio.ts — Baseten chain portfolio manager + OpenRouter ZDR routing
import fetch from 'node-fetch';
import * as crypto from 'node:crypto';
import { logChainExecution } from './event-logger.js';
import { routeOpenRouterForSpecialty } from './llm/route-request.js';
import { getDefaultConfig } from './types.js';
import type { ChainExecutionLog } from './sdlc-types.js';

const BASETEN_URL = `https://model-${process.env.BASETEN_CHAIN_PORTFOLIO_ID || 'qelg6953'}.api.baseten.co/environments/production/sync`;
const API_KEY = process.env.BASETEN_API_KEY || '';
const INPUT_PRICE_PER_TOK = 0.000_002;
const OUTPUT_PRICE_PER_TOK = 0.000_008;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export async function callChain(
  specialty: string,
  input: Record<string, unknown>,
  opts?: { timeout_sec?: number; dry_run?: boolean; correlation_id?: string }
): Promise<{ success: boolean; output: Record<string, unknown>; latency_ms: number; tokens: number; cost: number }> {
  const execId = crypto.randomUUID();
  const start = Date.now();

  if (!API_KEY || opts?.dry_run) {
    return {
      success: false,
      output: { error: opts?.dry_run ? 'dry_run' : 'missing_BASETEN_API_KEY', specialty },
      latency_ms: 0,
      tokens: 0,
      cost: 0,
    };
  }

  const payload = {
    messages: [{ role: 'user' as const, content: JSON.stringify(input) }],
    max_tokens: 4096,
  };
  const inputTokens = estimateTokens(JSON.stringify(payload));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), (opts?.timeout_sec || 60) * 1000);

  try {
    const resp = await fetch(BASETEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Api-Key ${API_KEY}`,
        'Content-Type': 'application/json',
        'X-Baseten-Chain-Specialty': specialty,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    const text = await resp.text();
    clearTimeout(timeout);
    const latency = Date.now() - start;
    const outputTokens = estimateTokens(text);
    const cost = (inputTokens * INPUT_PRICE_PER_TOK) + (outputTokens * OUTPUT_PRICE_PER_TOK);
    const success = resp.ok && text.length > 0;

    let output: Record<string, unknown> = {};
    try { output = JSON.parse(text) as Record<string, unknown>; } catch { output = { text }; }

    const log: ChainExecutionLog = {
      execution_id: execId,
      chain_specialty: specialty,
      input_payload: input,
      output_payload: output,
      model_id: process.env.BASETEN_MODEL_ID || 'qelg6953',
      tokens_in: inputTokens,
      tokens_out: outputTokens,
      latency_ms: latency,
      cost_usd: cost,
      dry_run: !!opts?.dry_run,
      success,
    };

    try { await logChainExecution(log); } catch { /* non-fatal */ }
    return { success, output, latency_ms: latency, tokens: inputTokens + outputTokens, cost };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const latency = Date.now() - start;
    return { success: false, output: {}, latency_ms: latency, tokens: 0, cost: 0 };
  }
}

async function callOpenRouterChain(
  specialty: string,
  input: Record<string, unknown>,
  opts?: { timeout_sec?: number; correlation_id?: string; dry_run?: boolean },
): Promise<{ success: boolean; output: Record<string, unknown>; latency_ms: number; tokens: number; cost: number } | null> {
  const config = getDefaultConfig();
  if (!config.openrouterApiKey || !config.llmFallbackOrder.includes('openrouter')) {
    return null;
  }

  try {
    const result = await routeOpenRouterForSpecialty(specialty, input, {
      timeout_sec: opts?.timeout_sec,
      correlation_id: opts?.correlation_id,
      dry_run: opts?.dry_run,
    });

    let output: Record<string, unknown> = {};
    try {
      output = JSON.parse(result.content) as Record<string, unknown>;
    } catch {
      output = { text: result.content, model: result.modelUsed };
    }

    return {
      success: true,
      output,
      latency_ms: result.latencyMs,
      tokens: result.usage.total_tokens,
      cost: result.cost,
    };
  } catch {
    return null;
  }
}

export async function smartCallChain(
  specialty: string,
  input: Record<string, unknown>,
  opts?: {
    timeout_sec?: number;
    fallback_fn?: (i: Record<string, unknown>) => Promise<Record<string, unknown>>;
    correlation_id?: string;
    dry_run?: boolean;
  },
): Promise<{ success: boolean; output: Record<string, unknown>; provider: string; latency_ms: number; tokens: number; cost: number }> {
  const config = getDefaultConfig();
  const order = config.llmFallbackOrder;

  for (const provider of order) {
    if (provider === 'openrouter') {
      const orResult = await callOpenRouterChain(specialty, input, opts);
      if (orResult?.success) {
        return { ...orResult, provider: 'openrouter' };
      }
      continue;
    }

    if (provider === 'baseten') {
      const result = await callChain(specialty, input, {
        timeout_sec: opts?.timeout_sec,
        correlation_id: opts?.correlation_id,
        dry_run: opts?.dry_run,
      });
      if (result.success) return { ...result, provider: 'baseten' };
      continue;
    }

    if (provider === 'local' && opts?.fallback_fn) {
      const start = Date.now();
      const local = await opts.fallback_fn(input);
      return {
        success: true,
        output: local,
        provider: 'local',
        latency_ms: Date.now() - start,
        tokens: 0,
        cost: 0,
      };
    }
  }

  const fallback = await callChain(specialty, input, {
    timeout_sec: opts?.timeout_sec,
    correlation_id: opts?.correlation_id,
    dry_run: opts?.dry_run,
  });
  return { ...fallback, provider: 'baseten' };
}

export async function researchTask(task: string, correlationId: string): Promise<{ research: Record<string, unknown> }> {
  const r = await smartCallChain('deep-research-brief', { task }, {
    correlation_id: correlationId,
    fallback_fn: async (i) => ({ research: { task: i.task, summary: `Research brief for: ${i.task}`, sources: [] } }),
  });
  return { research: r.output };
}

export async function generateSpec(research: Record<string, unknown>, correlationId: string): Promise<{ spec: string }> {
  const r = await smartCallChain('spec-from-research', { research }, {
    correlation_id: correlationId,
    fallback_fn: async (i) => ({ spec: `predicate RuleHolds() { true } // generated for: ${JSON.stringify(i.research).substring(0, 100)}` }),
  });
  return { spec: String(r.output.spec || r.output.text || '') };
}

export async function analyzeDesign(spec: string, correlationId: string): Promise<{ decision: Record<string, unknown> }> {
  const r = await smartCallChain('design-tradeoff', { spec }, {
    correlation_id: correlationId,
    fallback_fn: async () => ({ decision: { architecture: 'modular', reasoning: 'auto-generated', tradeoffs: ['simplicity vs flexibility'] } }),
  });
  return { decision: r.output };
}

export async function implementFromDesign(design: Record<string, unknown>, sandboxId: string, correlationId: string): Promise<{ code: string; tests: string }> {
  const r = await smartCallChain('impl-from-design', { design, sandbox_id: sandboxId }, { correlation_id: correlationId });
  return { code: String(r.output.code || ''), tests: String(r.output.tests || '') };
}

export async function fullVerification(code: string, spec: string, correlationId: string): Promise<{ report: Record<string, unknown> }> {
  const r = await smartCallChain('verify-full', { code, spec }, { correlation_id: correlationId });
  return { report: r.output };
}

export async function reviewChanges(code: string, verification: Record<string, unknown>, correlationId: string): Promise<{ summary: string; risk: number }> {
  const r = await smartCallChain('review-summarize', { code, verification }, { correlation_id: correlationId });
  return { summary: String(r.output.summary || ''), risk: Number(r.output.risk || 0) };
}

export async function validateDeploy(deployment: Record<string, unknown>, correlationId: string): Promise<{ valid: boolean }> {
  const r = await smartCallChain('deploy-validate', { deployment }, { correlation_id: correlationId });
  return { valid: !!r.output.valid };
}

export async function analyzeTelemetry(telemetry: Record<string, unknown>, correlationId: string): Promise<{ anomalies: unknown[]; suggestions: string[] }> {
  const r = await smartCallChain('monitor-analyze', { telemetry }, { correlation_id: correlationId });
  return { anomalies: (r.output.anomalies as unknown[]) || [], suggestions: (r.output.suggestions as string[]) || [] };
}
