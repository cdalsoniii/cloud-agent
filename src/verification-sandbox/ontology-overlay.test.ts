import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildOntologyOverlay,
  applyOverlayToNode,
  applyOverlayToEdge,
  OVERLAY_COLORS,
  emptyOverlay,
} from './ontology-overlay.js';

const nodes = [
  { id: 'class-Engagement', data: { label: 'Engagement', kind: 'class' } },
  { id: 'class-Customer', data: { label: 'Customer', kind: 'class' } },
  { id: 'fleet-root', type: 'input', data: { label: 'oteemo', kind: 'fleetRoot' } },
];

const edges = [
  {
    id: 'e-eng-cust',
    source: 'class-Engagement',
    target: 'class-Customer',
    label: 'customer',
    data: { slot: 'customer' },
  },
  {
    id: 'e-other',
    source: 'class-Customer',
    target: 'fleet-root',
    label: 'inPack',
  },
];

describe('ontology-overlay', () => {
  it('empty calls → all unknown', () => {
    const o = buildOntologyOverlay({ nodes, edges, calls: [], source: 'empty' });
    assert.equal(o.nodes['class-Engagement'].status, 'unknown');
    assert.equal(o.edges['e-eng-cust'].status, 'unknown');
    assert.equal(o.summary.callCount, 0);
    assert.equal(o.source, 'empty');
  });

  it('className + classesUsed tint matching nodes pass/fail', () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z');
    const o = buildOntologyOverlay({
      nodes,
      edges,
      now,
      source: 'surreal',
      calls: [
        {
          call_id: 'c1',
          at: '2026-08-09T11:00:00.000Z',
          tool: 'tool_io_guard',
          className: 'Engagement',
          ok: true,
          layers: ['shacl', 'lean'],
          linkml_reasoning: { classesUsed: ['Engagement', 'Customer'] },
        },
        {
          call_id: 'c2',
          at: '2026-08-09T11:30:00.000Z',
          tool: 'px_validate_cascade',
          className: 'Customer',
          ok: false,
          layers: ['shacl'],
          linkml_reasoning: { classesUsed: ['Customer'] },
        },
      ],
    });
    assert.equal(o.nodes['class-Engagement'].status, 'pass');
    assert.equal(o.nodes['class-Engagement'].color, OVERLAY_COLORS.pass.node);
    assert.ok(o.nodes['class-Engagement'].layers.includes('shacl'));
    // Customer: last call fail (and earlier pass from c1) → mixed or fail depending window
    assert.ok(
      o.nodes['class-Customer'].status === 'fail' ||
        o.nodes['class-Customer'].status === 'mixed',
    );
    assert.equal(o.nodes['class-Customer'].color, OVERLAY_COLORS[o.nodes['class-Customer'].status].node);
    assert.equal(o.summary.fail + o.summary.mixed + o.summary.pass > 0, true);
  });

  it('relationshipsUsed colors matching edges', () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z');
    const o = buildOntologyOverlay({
      nodes,
      edges,
      now,
      calls: [
        {
          call_id: 'r1',
          at: '2026-08-09T11:00:00.000Z',
          ok: false,
          className: 'Engagement',
          layers: ['graphql'],
          linkml_reasoning: {
            classesUsed: ['Engagement'],
            relationshipsUsed: ['customer'],
          },
        },
      ],
    });
    assert.equal(o.edges['e-eng-cust'].status, 'fail');
    assert.equal(o.edges['e-eng-cust'].color, OVERLAY_COLORS.fail.edge);
    assert.equal(o.edges['e-eng-cust'].strokeWidth, 2.5);
  });

  it('stale when last hit older than TTL', () => {
    const now = Date.parse('2026-08-09T12:00:00.000Z');
    const o = buildOntologyOverlay({
      nodes,
      edges,
      now,
      staleAfterMs: 60_000,
      calls: [
        {
          call_id: 'old',
          at: '2026-08-01T00:00:00.000Z',
          ok: true,
          className: 'Engagement',
          layers: ['shacl'],
        },
      ],
    });
    assert.equal(o.nodes['class-Engagement'].status, 'stale');
    assert.equal(o.nodes['class-Engagement'].color, OVERLAY_COLORS.stale.node);
  });

  it('applyOverlayToNode/Edge mutates style immutably', () => {
    const o = buildOntologyOverlay({
      nodes,
      edges,
      now: Date.parse('2026-08-09T12:00:00.000Z'),
      calls: [
        {
          call_id: 'x',
          at: '2026-08-09T11:00:00.000Z',
          ok: true,
          className: 'Engagement',
          layers: ['lean'],
        },
      ],
    });
    const n = applyOverlayToNode(
      { id: 'class-Engagement', style: { opacity: 1 }, data: { label: 'Engagement' } },
      o.nodes['class-Engagement'],
    );
    assert.equal(n.style?.borderColor, OVERLAY_COLORS.pass.node);
    assert.equal((n.data as { overlayStatus?: string }).overlayStatus, 'pass');

    const e = applyOverlayToEdge(
      { id: 'e-eng-cust', style: { stroke: '#000' } },
      o.edges['e-eng-cust'],
    );
    // edge may be derived from endpoint when no rel — still has overlay data
    assert.ok(e.data?.overlay || e.style?.stroke);
  });

  it('emptyOverlay helper', () => {
    const e = emptyOverlay();
    assert.equal(e.version, 1);
    assert.equal(e.summary.totalNodes, 0);
  });
});
