import { BasetenChainSandbox } from './src/baseten-chain-sandbox.js';
import { loadEnv } from './src/types.js';
import * as path from 'node:path';
import * as url from 'node:url';

const envDir = path.dirname(url.fileURLToPath(import.meta.url));
console.log('[LIVE-TEST] Loading env from:', envDir);
loadEnv(envDir);
console.log('[LIVE-TEST] BASETEN_API_KEY after loadEnv:', process.env.BASETEN_API_KEY ? 'SET' : 'NOT SET');

const config = {
  chainPortfolioId: process.env.BASETEN_CHAIN_PORTFOLIO_ID || 'qelg6953',
  basetenApiKey: process.env.BASETEN_API_KEY || '',
  dryRun: false,
  verbose: true,
};

const client = new BasetenChainSandbox(config);
console.log('[LIVE-TEST] Base URL:', (client as any).baseUrl);

// Test 1: Standard chat completion (what the model actually expects)
console.log('[LIVE-TEST] Test 1: Standard chat completion payload');
const chatResult = await client.executeChain({
  specialty: 'dev-router',
  input: {
    messages: [{ role: 'user', content: 'You are a chain router. Sandbox test-live status query received. Respond with JSON: {\"status\":\"running\"}' }],
    max_tokens: 100
  },
  timeout: 30000
});
console.log('[LIVE-TEST] Chat result:', JSON.stringify(chatResult, null, 2));

// Test 2: Chain-specific payload (will fail with 400 because model is not a chain)
console.log('[LIVE-TEST] Test 2: Chain-specific payload (expected to fail)');
const chainResult = await client.executeChain({
  specialty: 'dev-router',
  input: {
    operation: 'query',
    sandbox_id: 'test-live',
    status: true
  },
  timeout: 30000
});
console.log('[LIVE-TEST] Chain result:', JSON.stringify(chainResult, null, 2));

console.log('[LIVE-TEST] Complete.');
