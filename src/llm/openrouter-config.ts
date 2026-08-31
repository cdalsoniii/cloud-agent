import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OpenRouterRoutingConfig, OpenRouterTier } from './openrouter-types.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG_PATH = path.resolve(__dirname, '../../config/openrouter-routing.json');

let cachedConfig: OpenRouterRoutingConfig | null = null;

export function getRoutingConfigPath(): string {
  return process.env.OPENROUTER_ROUTING_CONFIG || DEFAULT_CONFIG_PATH;
}

export function loadRoutingConfig(configPath?: string): OpenRouterRoutingConfig {
  if (!configPath && cachedConfig) return cachedConfig;
  const resolved = configPath || getRoutingConfigPath();
  const raw = fs.readFileSync(resolved, 'utf-8');
  const config = JSON.parse(raw) as OpenRouterRoutingConfig;
  if (!configPath) cachedConfig = config;
  return config;
}

export function tierForSpecialty(specialty: string, config?: OpenRouterRoutingConfig): OpenRouterTier {
  const cfg = config || loadRoutingConfig();
  return cfg.specialtyTierMap[specialty] || cfg.defaultTier;
}

export function modelsForTier(tier: OpenRouterTier, config?: OpenRouterRoutingConfig): string[] {
  const cfg = config || loadRoutingConfig();
  const entry = cfg.tiers[tier];
  if (!entry?.models?.length) {
    throw new Error(`No models configured for OpenRouter tier: ${tier}`);
  }
  return [...entry.models];
}

export function maxTokensForTier(tier: OpenRouterTier, config?: OpenRouterRoutingConfig): number {
  const cfg = config || loadRoutingConfig();
  return cfg.tiers[tier]?.max_tokens ?? 4096;
}

export function providerDefaults(config?: OpenRouterRoutingConfig) {
  const cfg = config || loadRoutingConfig();
  const zdrEnabled = process.env.OPENROUTER_ZDR_DEFAULT !== '0';
  return {
    ...cfg.providerDefaults,
    zdr: zdrEnabled ? cfg.providerDefaults.zdr !== false : false,
  };
}
