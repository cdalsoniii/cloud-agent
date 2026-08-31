import { strict as assert } from 'node:assert';
import { afterEach, describe, it } from 'node:test';
import {
  chatCompletion,
  mergeProviderPrefs,
  resetOpenRouterFetch,
  setOpenRouterFetch,
} from './openrouter-client.js';

describe('openrouter-client', () => {
  const originalKey = process.env.OPENROUTER_API_KEY;

  afterEach(() => {
    resetOpenRouterFetch();
    if (originalKey === undefined) {
      delete process.env.OPENROUTER_API_KEY;
    } else {
      process.env.OPENROUTER_API_KEY = originalKey;
    }
  });

  it('mergeProviderPrefs applies ZDR defaults from routing config', () => {
    const prefs = mergeProviderPrefs();
    assert.equal(prefs.zdr, true);
    assert.equal(prefs.data_collection, 'deny');
    assert.equal(prefs.sort, 'price');
    assert.equal(prefs.allow_fallbacks, true);
  });

  it('chatCompletion dry_run without API key', async () => {
    delete process.env.OPENROUTER_API_KEY;
    const result = await chatCompletion({
      model: 'openai/gpt-oss-20b',
      models: ['openai/gpt-oss-20b', 'meta-llama/llama-3.3-70b-instruct'],
      messages: [{ role: 'user', content: 'hi' }],
      dry_run: true,
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, 'dry_run');
    assert.equal(result.requestBody?.provider?.zdr, true);
    assert.equal(result.requestBody?.provider?.data_collection, 'deny');
    assert.deepEqual(result.requestBody?.models, [
      'openai/gpt-oss-20b',
      'meta-llama/llama-3.3-70b-instruct',
    ]);
  });

  it('chatCompletion sends ZDR provider block and models array via fetch', async () => {
    process.env.OPENROUTER_API_KEY = 'test-key';
    let capturedBody: Record<string, unknown> | undefined;

    setOpenRouterFetch(async (_url, init) => {
      capturedBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            model: 'deepseek/deepseek-v4-flash-0731',
            choices: [{ message: { content: 'ZDR_OK' } }],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          }),
        json: async () => ({
          model: 'deepseek/deepseek-v4-flash-0731',
          choices: [{ message: { content: 'ZDR_OK' } }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        }),
      };
    });

    const result = await chatCompletion({
      model: 'deepseek/deepseek-v4-flash-0731',
      models: ['deepseek/deepseek-v4-flash-0731', 'deepseek/deepseek-v4-flash'],
      messages: [{ role: 'user', content: 'Reply exactly: ZDR_OK' }],
      max_tokens: 16,
    });

    assert.equal(result.ok, true);
    assert.equal(result.content, 'ZDR_OK');
    assert.equal(result.modelUsed, 'deepseek/deepseek-v4-flash-0731');

    const provider = capturedBody?.provider as Record<string, unknown>;
    assert.equal(provider.zdr, true);
    assert.equal(provider.data_collection, 'deny');
    assert.deepEqual(capturedBody?.models, [
      'deepseek/deepseek-v4-flash-0731',
      'deepseek/deepseek-v4-flash',
    ]);
  });
});
