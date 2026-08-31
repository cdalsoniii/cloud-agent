import * as crypto from 'node:crypto';
import fetch, { type RequestInit } from 'node-fetch';
import { logChainExecution } from '../event-logger.js';
import type { ChainExecutionLog } from '../sdlc-types.js';
import { loadRoutingConfig, providerDefaults } from './openrouter-config.js';
import type {
  OpenRouterChatRequest,
  OpenRouterChatResult,
  OpenRouterMessage,
  OpenRouterProviderPrefs,
} from './openrouter-types.js';

const INPUT_PRICE_PER_TOK = 0.000_0005;
const OUTPUT_PRICE_PER_TOK = 0.000_002;

export type FetchFn = (url: string, init?: RequestInit) => Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>;

let fetchImpl: FetchFn = fetch as unknown as FetchFn;

/** Test hook: override fetch implementation */
export function setOpenRouterFetch(impl: FetchFn): void {
  fetchImpl = impl;
}

export function resetOpenRouterFetch(): void {
  fetchImpl = fetch as unknown as FetchFn;
}

export function getOpenRouterBaseUrl(): string {
  return (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/$/, '');
}

export function getOpenRouterApiKey(): string {
  return process.env.OPENROUTER_API_KEY || '';
}

export function buildOpenRouterHeaders(): Record<string, string> {
  const key = getOpenRouterApiKey();
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'HTTP-Referer': process.env.OPENROUTER_HTTP_REFERER || 'https://brightforestx.com',
    'X-Title': process.env.OPENROUTER_APP_TITLE || 'cloud-agent',
  };
}

export function mergeProviderPrefs(overrides?: Partial<OpenRouterProviderPrefs>): OpenRouterProviderPrefs {
  const defaults = providerDefaults(loadRoutingConfig());
  if (!overrides) return defaults;
  return { ...defaults, ...overrides };
}

function estimateCost(promptTokens: number, completionTokens: number): number {
  return promptTokens * INPUT_PRICE_PER_TOK + completionTokens * OUTPUT_PRICE_PER_TOK;
}

function extractContent(body: Record<string, unknown>): string {
  const choices = body.choices as Array<{ message?: Record<string, unknown> }> | undefined;
  const message = choices?.[0]?.message;
  if (!message) return '';

  const content = message.content;
  if (typeof content === 'string' && content.length > 0) return content;

  const reasoning = message.reasoning;
  if (typeof reasoning === 'string' && reasoning.length > 0) return reasoning;

  const details = message.reasoning_details as Array<{ text?: string }> | undefined;
  const detailText = details?.map((d) => d.text).filter(Boolean).join('\n');
  if (detailText) return detailText;

  return '';
}

export interface ChatCompletionOptions {
  model: string;
  models?: string[];
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  provider?: Partial<OpenRouterProviderPrefs>;
  dry_run?: boolean;
  specialty?: string;
  correlation_id?: string;
  timeout_sec?: number;
}

export async function chatCompletion(opts: ChatCompletionOptions): Promise<OpenRouterChatResult> {
  const execId = crypto.randomUUID();
  const start = Date.now();
  const apiKey = getOpenRouterApiKey();

  const provider = mergeProviderPrefs(opts.provider);
  const models = opts.models?.length ? opts.models : [opts.model];
  const requestBody: OpenRouterChatRequest = {
    model: models[0],
    models,
    messages: opts.messages,
    max_tokens: opts.max_tokens ?? 1024,
    temperature: opts.temperature ?? 0.2,
    provider,
  };

  if (!apiKey || opts.dry_run) {
    return {
      ok: false,
      content: '',
      modelUsed: models[0],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      latencyMs: 0,
      cost: 0,
      requestBody,
      error: opts.dry_run ? 'dry_run' : 'missing_OPENROUTER_API_KEY',
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    (opts.timeout_sec ?? 120) * 1000,
  );

  try {
    const response = await fetchImpl(`${getOpenRouterBaseUrl()}/chat/completions`, {
      method: 'POST',
      headers: buildOpenRouterHeaders(),
      body: JSON.stringify(requestBody),
      signal: controller.signal as RequestInit['signal'],
    });
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    const raw = (await response.json()) as Record<string, unknown>;
    const content = extractContent(raw);
    const usageRaw = (raw.usage || {}) as Record<string, number>;
    const usage = {
      prompt_tokens: Number(usageRaw.prompt_tokens || 0),
      completion_tokens: Number(usageRaw.completion_tokens || 0),
      total_tokens: Number(usageRaw.total_tokens || 0),
    };
    const modelUsed = String(raw.model || models[0]);
    const ok = response.ok && content.length > 0;
    const cost = estimateCost(usage.prompt_tokens, usage.completion_tokens);

    const log: ChainExecutionLog = {
      execution_id: execId,
      chain_specialty: opts.specialty || 'openrouter-chat',
      input_payload: { messages: opts.messages, models, provider },
      output_payload: { content: content.slice(0, 500), model: modelUsed },
      model_id: modelUsed,
      tokens_in: usage.prompt_tokens,
      tokens_out: usage.completion_tokens,
      latency_ms: latencyMs,
      cost_usd: cost,
      dry_run: !!opts.dry_run,
      success: ok,
      error: ok ? undefined : `HTTP ${response.status}`,
    };
    try {
      await logChainExecution(log);
    } catch {
      /* non-fatal */
    }

    return {
      ok,
      content,
      modelUsed,
      usage,
      latencyMs,
      cost,
      requestBody,
      raw,
      error: ok ? undefined : `HTTP ${response.status}: ${JSON.stringify(raw).slice(0, 200)}`,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      content: '',
      modelUsed: models[0],
      usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      latencyMs,
      cost: 0,
      requestBody,
      error: message,
    };
  }
}
