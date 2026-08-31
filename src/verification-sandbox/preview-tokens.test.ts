/**
 * Unit tests for pure preview token mint/refresh helpers (shipped path).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  PREVIEW_TOKEN_PORTS,
  buildPreviewTokenSet,
  didTokensRotate,
  extractTokenFromPreviewUrl,
  formatOpenUrlsText,
  hostFetchTargets,
  mintAllPreviewPorts,
  nextGeneration,
  refreshPreviewTokenSet,
  writePreviewTokenArtifacts,
  allFetchesOk,
  type PreviewFetchResult,
} from './preview-tokens.js';

describe('preview-tokens pure helpers', () => {
  it('covers formal ports 3010/7005/7006/7004/4096', () => {
    assert.deepEqual([...PREVIEW_TOKEN_PORTS], [3010, 7005, 7006, 7004, 4096]);
  });

  it('extractTokenFromPreviewUrl parses Daytona host', () => {
    assert.equal(
      extractTokenFromPreviewUrl('https://3010-abc123xyz.daytonaproxy01.net/'),
      'abc123xyz',
    );
    assert.equal(
      extractTokenFromPreviewUrl('https://7005-tok_en-1.proxy.daytona.work/health'),
      'tok_en-1',
    );
  });

  it('mintAllPreviewPorts builds set with tokens and open-urls shape', async () => {
    let n = 0;
    const set = await mintAllPreviewPorts({
      sandboxId: 'sb-test-1',
      generation: 1,
      expiresInSeconds: 1800,
      mintPort: async (port) => {
        n++;
        const token = `tok${port}g1`;
        return { url: `https://${port}-${token}.daytonaproxy01.net`, token };
      },
    });
    assert.equal(n, 5);
    assert.equal(set.sandboxId, 'sb-test-1');
    assert.equal(set.generation, 1);
    assert.equal(set.ports.length, 5);
    assert.ok(set.ports.every((p) => !p.skipped && p.token && p.url.includes(String(p.port))));
    const aui = set.ports.find((p) => p.port === 3010)!;
    assert.deepEqual(aui.extraPaths, ['/verifier-fleet']);
    const targets = hostFetchTargets(set);
    assert.ok(targets.some((t) => t.path === '/verifier-fleet'));
    assert.ok(targets.some((t) => t.port === 7005 && t.path === '/health'));
    const text = formatOpenUrlsText(set);
    assert.match(text, /assistant-ui-web/);
    assert.match(text, /3010-tok3010g1/);
  });

  it('refreshPreviewTokenSet increments generation and rotates tokens', async () => {
    const first = await mintAllPreviewPorts({
      sandboxId: 'sb-rot',
      generation: 1,
      mintPort: async (port) => ({
        url: `https://${port}-old${port}.daytonaproxy01.net`,
        token: `old${port}`,
      }),
    });
    const second = await refreshPreviewTokenSet(first, async (port) => ({
      url: `https://${port}-new${port}.daytonaproxy01.net`,
      token: `new${port}`,
    }));
    assert.equal(nextGeneration(first), 2);
    assert.equal(second.generation, 2);
    assert.equal(second.sandboxId, first.sandboxId);
    assert.ok(didTokensRotate(first, second));
    assert.notEqual(first.ports[0].url, second.ports[0].url);
    assert.notEqual(first.ports[0].token, second.ports[0].token);
  });

  it('writePreviewTokenArtifacts writes mint json and open-urls', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ptok-'));
    const set = buildPreviewTokenSet({
      sandboxId: 'sb-write',
      generation: 3,
      mints: [
        { port: 3010, url: 'https://3010-t.daytonaproxy01.net', token: 't' },
        { port: 7005, url: 'https://7005-u.daytonaproxy01.net', token: 'u' },
        { port: 7006, url: 'https://7006-v.daytonaproxy01.net', token: 'v' },
        { port: 7004, url: 'https://7004-w.daytonaproxy01.net', token: 'w' },
        { port: 4096, url: 'https://4096-x.daytonaproxy01.net', token: 'x' },
      ],
    });
    const paths = writePreviewTokenArtifacts(dir, set);
    assert.ok(fs.existsSync(paths.mintJson));
    assert.ok(fs.existsSync(paths.openUrls));
    assert.ok(fs.existsSync(path.join(dir, 'preview-tokens-latest.json')));
    const loaded = JSON.parse(fs.readFileSync(paths.mintJson, 'utf8'));
    assert.equal(loaded.generation, 3);
    assert.equal(loaded.ports.length, 5);
    assert.match(fs.readFileSync(paths.openUrls, 'utf8'), /OPENCODE_BASE_URL=/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('allFetchesOk requires every result ok', () => {
    const good: PreviewFetchResult[] = [
      { port: 3010, path: '/', url: 'u', status: 200, ok: true },
    ];
    assert.equal(allFetchesOk(good), true);
    assert.equal(
      allFetchesOk([{ port: 3010, path: '/', url: 'u', status: 401, ok: false }]),
      false,
    );
    assert.equal(allFetchesOk([]), false);
  });

  it('skips ports when isPortReady is false', async () => {
    const set = await mintAllPreviewPorts({
      sandboxId: 'sb-skip',
      mintPort: async (port) => ({
        url: `https://${port}-x.daytonaproxy01.net`,
        token: 'x',
      }),
      isPortReady: async (port) => port !== 7004,
    });
    const shacl = set.ports.find((p) => p.port === 7004)!;
    assert.equal(shacl.skipped, true);
    assert.ok(set.ports.filter((p) => !p.skipped).length === 4);
  });
});
