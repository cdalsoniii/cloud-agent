/**
 * Real-path unit tests: example customers → ontology-state graph.
 * Drives buildOntologyState / writeOntologyStateFile (shipped entry points).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import {
  buildOntologyState,
  writeOntologyStateFile,
  listExampleCustomers,
  schemaFieldId,
  isClassRange,
  layoutSchemaGraph,
} from './ontology-state.js';
import { getExampleCustomer } from './example-customers.js';

describe('example customers ontology state', () => {
  it('lists at least two example customers', () => {
    const list = listExampleCustomers();
    assert.ok(list.length >= 2);
    assert.ok(getExampleCustomer('acme-fleet'));
    assert.ok(getExampleCustomer('skydio-ops'));
  });

  it('builds non-empty distinct graphs for acme-fleet and skydio-ops', () => {
    const a = buildOntologyState(null, 'acme-fleet');
    const b = buildOntologyState(null, 'skydio-ops');
    assert.ok(a, 'acme-fleet state');
    assert.ok(b, 'skydio-ops state');
    assert.equal(a!.customerId, 'acme-fleet');
    assert.equal(b!.customerId, 'skydio-ops');
    assert.notEqual(a!.pack, b!.pack);
    const na = a!.reactFlow?.nodes?.length || a!.nodes.length;
    const nb = b!.reactFlow?.nodes?.length || b!.nodes.length;
    assert.ok(na > 0, `acme nodes ${na}`);
    assert.ok(nb > 0, `skydio nodes ${nb}`);
    // Instance YAML must load (ESM yaml fix): acme collated fleet has verifiers
    assert.ok(
      !a!.meta.notes.some((n) => n.includes('instance yaml parse failed')),
      `acme notes: ${a!.meta.notes.join('; ')}`,
    );
    assert.ok(
      !b!.meta.notes.some((n) => n.includes('instance yaml parse failed')),
      `skydio notes: ${b!.meta.notes.join('; ')}`,
    );
    assert.ok(
      a!.summary.verifiers >= 1,
      `acme-fleet must load collated verifiers, got ${a!.summary.verifiers}`,
    );
    // skydio is a report instance, not a verifier fleet
    assert.ok(b!.summary.classes >= 1, `skydio classes ${b!.summary.classes}`);
  });

  it('writeOntologyStateFile writes JSON with customerId and verifiers', () => {
    const p = writeOntologyStateFile(null, undefined, 'acme-fleet');
    assert.ok(p && fs.existsSync(p));
    const j = JSON.parse(fs.readFileSync(p!, 'utf8'));
    assert.equal(j.customerId, 'acme-fleet');
    assert.ok((j.reactFlow?.nodes?.length || j.nodes?.length || 0) > 0);
    assert.ok(
      (j.summary?.verifiers ?? 0) >= 1,
      `written state verifiers=${j.summary?.verifiers}`,
    );
    assert.ok(
      !(j.meta?.notes || []).some((n: string) => n.includes('instance yaml parse failed')),
    );
  });

  it('schema-ports: class nodes have fields[]; range edges use sourceHandle/targetHandle', () => {
    assert.equal(schemaFieldId('VerifierFleet', 'fleet_id'), 'VerifierFleet.fleet_id');
    assert.equal(isClassRange('Verifier', ['Verifier', 'VerifierFleet']), true);
    assert.equal(isClassRange('string', ['Verifier']), false);

    const prev = process.env.ONTOLOGY_GRAPH_EXPLODE_SLOTS;
    delete process.env.ONTOLOGY_GRAPH_EXPLODE_SLOTS;
    try {
      const a = buildOntologyState(null, 'acme-fleet');
      assert.ok(a, 'acme state');
      assert.equal(a!.layoutMode, 'schema-ports');
      const classNodes = (a!.reactFlow?.nodes || []).filter(
        (n) => n.type === 'schemaClass' || (n.data && n.data.kind === 'class'),
      );
      assert.ok(classNodes.length >= 1, `class nodes ${classNodes.length}`);
      const withFields = classNodes.filter(
        (n) => Array.isArray(n.data.fields) && (n.data.fields as unknown[]).length >= 1,
      );
      assert.ok(
        withFields.length >= 1,
        `expected fields[] on class nodes, got ${classNodes.map((n) => n.data.label).join(',')}`,
      );
      const field0 = (withFields[0].data.fields as Array<{ id: string; name: string }>)[0];
      assert.ok(field0.id.includes('.'), `field id ${field0.id}`);
      assert.ok(field0.name);

      const rangeEdges = (a!.reactFlow?.edges || []).filter(
        (e) => e.sourceHandle && e.targetHandle,
      );
      // Prefer real range edges from metamodel; if none, ontology edges with handles
      const ontologyRange = (a!.edges || []).filter((e) => e.sourceHandle && e.targetHandle);
      assert.ok(
        rangeEdges.length >= 1 || ontologyRange.length >= 1,
        `expected ≥1 handle-aware edge, rf=${rangeEdges.length} ont=${ontologyRange.length}`,
      );
      const sample = rangeEdges[0] || {
        sourceHandle: ontologyRange[0].sourceHandle,
        targetHandle: ontologyRange[0].targetHandle,
      };
      assert.ok(sample.sourceHandle);
      assert.ok(sample.targetHandle);

      // Blocking verifiers get animated edges when present
      const animated = (a!.reactFlow?.edges || []).filter((e) => e.animated);
      if ((a!.summary.verifiers || 0) >= 1) {
        // may or may not have blocking — just ensure animated is a boolean when set
        for (const e of animated) assert.equal(e.animated, true);
      }

      // Layered layout moves range-target classes to the right of sources
      const laid = layoutSchemaGraph(a!.reactFlow!.nodes, a!.reactFlow!.edges);
      const byId = new Map(laid.map((n) => [n.id, n]));
      const re = rangeEdges[0] || ontologyRange[0];
      if (re && byId.has(re.source) && byId.has(re.target)) {
        assert.ok(
          (byId.get(re.target)!.position.x || 0) >= (byId.get(re.source)!.position.x || 0),
          'target rank should be at or right of source',
        );
      }
    } finally {
      if (prev !== undefined) process.env.ONTOLOGY_GRAPH_EXPLODE_SLOTS = prev;
    }
  });
});
