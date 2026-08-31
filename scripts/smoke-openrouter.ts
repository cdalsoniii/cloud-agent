#!/usr/bin/env npx tsx
/**
 * Live OpenRouter ZDR smoke test — exercises triage, bulk, and coding tiers.
 */
import { loadEnv } from '../src/types.js';
import { routeOpenRouter } from '../src/llm/route-request.js';
import type { OpenRouterTier } from '../src/llm/openrouter-types.js';

loadEnv(process.cwd());

const TIERS: OpenRouterTier[] = ['triage', 'bulk', 'coding'];

async function smokeTier(tier: OpenRouterTier): Promise<void> {
  const result = await routeOpenRouter({
    tier,
    messages: [{ role: 'user', content: 'Reply with one word: OK' }],
    max_tokens: 128,
    timeout_sec: 60,
    specialty: `smoke-${tier}`,
  });

  const provider = result.requestBody?.provider;
  console.log(`[${tier}] model=${result.modelUsed} latency=${result.latencyMs}ms tokens=${result.usage.total_tokens}`);
  console.log(`  zdr=${provider?.zdr} data_collection=${provider?.data_collection} models=${result.requestBody?.models?.join(' -> ')}`);
  console.log(`  content=${result.content.trim().slice(0, 80)}`);

  if (provider?.zdr !== true || provider?.data_collection !== 'deny') {
    throw new Error(`[${tier}] ZDR payload not enforced: ${JSON.stringify(provider)}`);
  }
}

async function main(): Promise<void> {
  if (!process.env.OPENROUTER_API_KEY) {
    console.error('OPENROUTER_API_KEY required');
    process.exit(1);
  }

  console.log('OpenRouter ZDR smoke — tiers:', TIERS.join(', '));
  for (const tier of TIERS) {
    await smokeTier(tier);
  }
  console.log('\nAll OpenRouter smoke tiers passed.');
}

main().catch((err) => {
  console.error('smoke-openrouter failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
