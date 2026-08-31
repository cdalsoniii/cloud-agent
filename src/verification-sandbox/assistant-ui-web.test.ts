import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import {
  assistantUiPackIncludeList,
  buildAssistantUiWebTarball,
  resolveAssistantUiRoot,
} from './assistant-ui-web.js';
import { ASSISTANT_UI_WEB_PORT, REMOTE_ASSISTANT_UI } from './types.js';

describe('assistant-ui web pack (host)', () => {
  it('resolves 02-products/assistant-ui and packs without node_modules', () => {
    const root = resolveAssistantUiRoot();
    assert.ok(root, 'assistant-ui root');
    assert.match(root!, /assistant-ui$/);
    const include = assistantUiPackIncludeList(root!);
    assert.ok(include.includes('packages/web'));
    assert.ok(include.includes('package.json'));
    assert.equal(ASSISTANT_UI_WEB_PORT, 3010);
    assert.match(REMOTE_ASSISTANT_UI, /daytona|assistant-ui/);

    const packed = buildAssistantUiWebTarball(root!);
    assert.ok(fs.existsSync(packed.tarballPath));
    assert.ok(packed.bytes > 1000);
    assert.ok(packed.bytes < 50 * 1024 * 1024, 'tarball should exclude node_modules');
    assert.ok(packed.include.includes('packages/web'));
    try {
      fs.rmSync(path.dirname(packed.tarballPath), { recursive: true, force: true });
    } catch {
      /* */
    }
  });
});
