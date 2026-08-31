import {
  loadRoutingConfig,
  maxTokensForTier,
  modelsForTier,
  tierForSpecialty,
} from './openrouter-config.js';
import { chatCompletion } from './openrouter-client.js';
import type { OpenRouterChatResult, OpenRouterTier, RouteOpenRouterOptions } from './openrouter-types.js';

export class OpenRouterRouteError extends Error {
  constructor(
    message: string,
    public readonly result?: OpenRouterChatResult,
  ) {
    super(message);
    this.name = 'OpenRouterRouteError';
  }
}

export function resolveTier(opts: RouteOpenRouterOptions): OpenRouterTier {
  if (opts.tier) return opts.tier;
  if (opts.specialty) return tierForSpecialty(opts.specialty);
  const envTier = process.env.OPENROUTER_DEFAULT_TIER as OpenRouterTier | undefined;
  if (envTier) return envTier;
  return loadRoutingConfig().defaultTier;
}

export async function routeOpenRouter(opts: RouteOpenRouterOptions): Promise<OpenRouterChatResult> {
  const tier = resolveTier(opts);
  const models = modelsForTier(tier);
  const max_tokens = opts.max_tokens ?? maxTokensForTier(tier);

  const result = await chatCompletion({
    model: models[0],
    models,
    messages: opts.messages,
    max_tokens,
    temperature: opts.temperature,
    provider: opts.provider,
    dry_run: opts.dry_run,
    specialty: opts.specialty || `openrouter-${tier}`,
    correlation_id: opts.correlation_id,
    timeout_sec: opts.timeout_sec,
  });

  if (!result.ok) {
    throw new OpenRouterRouteError(result.error || 'OpenRouter request failed', result);
  }

  return result;
}

export async function routeOpenRouterForSpecialty(
  specialty: string,
  input: Record<string, unknown>,
  opts?: Omit<RouteOpenRouterOptions, 'specialty' | 'messages'>,
): Promise<OpenRouterChatResult> {
  return routeOpenRouter({
    ...opts,
    specialty,
    messages: [
      {
        role: 'user',
        content: JSON.stringify({ specialty, ...input }),
      },
    ],
  });
}
