export type OpenRouterTier = 'triage' | 'bulk' | 'coding' | 'frontier';

export type OpenRouterDataCollection = 'allow' | 'deny';

export interface OpenRouterProviderPrefs {
  zdr?: boolean;
  data_collection?: OpenRouterDataCollection;
  sort?: 'price' | 'throughput' | 'latency';
  allow_fallbacks?: boolean;
  order?: string[];
  only?: string[];
  ignore?: string[];
  max_price?: { prompt?: number; completion?: number };
}

export interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenRouterChatRequest {
  model: string;
  models?: string[];
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  provider?: OpenRouterProviderPrefs;
}

export interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface OpenRouterChatResult {
  ok: boolean;
  content: string;
  modelUsed: string;
  usage: OpenRouterUsage;
  latencyMs: number;
  cost: number;
  requestBody?: OpenRouterChatRequest;
  raw?: unknown;
  error?: string;
}

export interface OpenRouterRoutingConfig {
  providerDefaults: OpenRouterProviderPrefs;
  tiers: Record<
    OpenRouterTier,
    { description: string; models: string[]; max_tokens: number }
  >;
  specialtyTierMap: Record<string, OpenRouterTier>;
  defaultTier: OpenRouterTier;
}

export interface RouteOpenRouterOptions {
  tier?: OpenRouterTier;
  specialty?: string;
  messages: OpenRouterMessage[];
  max_tokens?: number;
  temperature?: number;
  provider?: Partial<OpenRouterProviderPrefs>;
  dry_run?: boolean;
  correlation_id?: string;
  timeout_sec?: number;
}
