/**
 * Unit tests for formal (S2) stack ownership + create/ingest real path.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  formalSurfaceOwnership,
  startFormalStack,
  formalDestroy,
  type FormalStackHandle,
} from './formal-stack.js';
import { getSandboxType } from './types-registry.js';
import {
  handlePxFormalCreate,
  handlePxFormalIngest,
  handlePxFormalPreview,
  handlePxFormalFleetPreview,
} from './handlers.js';
import { callVerificationMcpTool } from './mcp-tools.js';

describe('formal stack (S2 lifecycle)', () => {
  it('registry: formal owns ontology+fleet; editor owns neither public surface', () => {
    const o = formalSurfaceOwnership();
    assert.equal(o.role, 'formal');
    assert.ok(o.ports.includes(7005));
    assert.ok(o.ports.includes(7006));
    assert.ok(o.surfaces.includes('ontology_ui'));
    assert.ok(o.surfaces.includes('fleet_ui'));
    assert.deepEqual(o.editorPublicApps, []);
    const editor = getSandboxType('editor');
    assert.ok(!editor.ports.includes(7005));
    assert.ok(!editor.ports.includes(7006));
  });

  it('startFormalStack serves diagram state and fleet page under formal role', async () => {
    let handle: FormalStackHandle | null = null;
    try {
      handle = await startFormalStack({
        customerId: 'acme-fleet',
        ontologyPort: 17105,
        fleetPort: 17106,
        assistantUiOrigin: process.env.ASSISTANT_UI_URL || 'http://127.0.0.1:3010',
      });
      assert.equal(handle.role, 'formal');

      const health = await fetch(`http://127.0.0.1:${handle.ontologyPort}/health`).then((r) =>
        r.json(),
      );
      assert.equal(health.ok, true);

      const state = await fetch(`http://127.0.0.1:${handle.ontologyPort}/api/ontology/state`).then(
        (r) => r.json(),
      );
      const nodes = state.reactFlow?.nodes?.length || 0;
      assert.ok(nodes > 0, `nodes ${nodes}`);
      assert.ok((state.summary?.verifiers ?? 0) >= 1 || state.customerId === 'skydio-ops');

      const fleet = await fetch(`http://127.0.0.1:${handle.fleetPort}/`);
      const body = await fleet.text();
      assert.equal(fleet.status, 200);
      assert.match(body, /verifier-fleet|react-flow|Validation checks|formal/i);
      assert.equal(fleet.headers.get('x-formal-sandbox-role'), 'formal');

      const fleetHealth = await fetch(`http://127.0.0.1:${handle.fleetPort}/health`).then((r) =>
        r.json(),
      );
      assert.equal(fleetHealth.role, 'formal');
      assert.ok(fleetHealth.surfaces.includes('fleet_ui'));
    } finally {
      handle?.stop();
    }
  });

  it('px_formal_create + px_formal_ingest start diagram with pack state and mint openable URL', async () => {
    formalDestroy();
    try {
      const created = await handlePxFormalCreate({
        customerId: 'acme-fleet',
        ontologyPort: 17405,
        fleetPort: 17406,
        forceLocal: true,
      });
      assert.equal(created.ok, true);
      assert.equal(created.role, 'formal');
      const urls = created.urls as { ontology: string; fleet: string; ontologyHealth: string };
      assert.match(urls.ontology, /127\.0\.0\.1:17405/);
      assert.match(urls.fleet, /127\.0\.0\.1:17406/);

      const health = await fetch(urls.ontologyHealth).then((r) => r.json());
      assert.equal(health.ok, true);

      const state = await fetch(
        `http://127.0.0.1:17405/api/ontology/state`,
      ).then((r) => r.json());
      assert.ok((state.reactFlow?.nodes?.length || 0) > 0);

      const ingested = await handlePxFormalIngest({
        customerId: 'acme-fleet',
        ontologyPort: 17405,
        fleetPort: 17406,
        forceLocal: true,
      });
      assert.equal(ingested.ok, true);
      const summary = ingested.stateSummary as { nodes: number };
      assert.ok(summary.nodes > 0, `ingest nodes ${summary.nodes}`);

      const prev = await handlePxFormalPreview({ app: 'ontology' });
      assert.equal(prev.ok, true);
      const prevUrl = (prev.preview as { url: string }).url;
      assert.match(prevUrl, /127\.0\.0\.1:17405/);

      const fleetPrev = await handlePxFormalFleetPreview({});
      assert.equal(fleetPrev.ok, true);
      assert.match((fleetPrev.preview as { url: string }).url, /127\.0\.0\.1:17406/);

      // MCP dispatch uses same shipped handlers
      const viaMcp = await callVerificationMcpTool('px_formal_preview', { app: 'ontology' });
      assert.equal((viaMcp as { ok: boolean }).ok, true);
    } finally {
      formalDestroy();
    }
  });
});
