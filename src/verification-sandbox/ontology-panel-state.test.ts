import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PANEL_TABS,
  isPanelTab,
  selectNode,
  selectNodeToggle,
  addNodeTag,
  removeNodeTag,
  getNodeTags,
  loadTagsFromStorage,
  saveTagsToStorage,
  normalizeTag,
  defaultGuardrailsCatalog,
  selectGuardrailsServer,
  removeActiveGuardrailsServer,
  addActiveGuardrailsServer,
  listActiveGuardrailsServers,
  FORMAL_GUARDRAILS_PORT,
  mergeNodeOverlay,
  mergeEdgeOverlay,
  MIDSPIRAL_TOOL_ORDER,
  OVERLAY_STATUS_COLORS,
  type GuardrailsServer,
} from './ontology-panel-state.js';

describe('ontology-panel-state', () => {
  it('exposes Search, Logs, Summary, Guardrails, and Midspiral tabs', () => {
    const labels = PANEL_TABS.map((t) => t.label);
    assert.ok(labels.includes('Search'));
    assert.ok(labels.includes('Logs'));
    assert.ok(labels.includes('Summary'));
    assert.ok(labels.includes('Guardrails'));
    assert.ok(labels.includes('Midspiral'));
    assert.equal(isPanelTab('search'), true);
    assert.equal(isPanelTab('summary'), true);
    assert.equal(isPanelTab('guardrails'), true);
    assert.equal(isPanelTab('midspiral'), true);
    assert.equal(isPanelTab('overview'), false);
  });

  it('selectNode updates selection for click path', () => {
    assert.equal(selectNode(null, 'class-Engagement'), 'class-Engagement');
    assert.equal(selectNode('class-A', 'class-B'), 'class-B');
    assert.equal(selectNode('class-A', null), null);
    assert.equal(selectNodeToggle('class-A', 'class-A'), null);
    assert.equal(selectNodeToggle(null, 'class-A'), 'class-A');
  });

  it('add/remove tags on node id (session map)', () => {
    let tags = {};
    tags = addNodeTag(tags, 'class-Customer', 'critical');
    tags = addNodeTag(tags, 'class-Customer', 'reviewed');
    tags = addNodeTag(tags, 'class-Customer', 'critical'); // dup
    assert.deepEqual(getNodeTags(tags, 'class-Customer'), ['critical', 'reviewed']);
    tags = removeNodeTag(tags, 'class-Customer', 'critical');
    assert.deepEqual(getNodeTags(tags, 'class-Customer'), ['reviewed']);
    tags = removeNodeTag(tags, 'class-Customer', 'reviewed');
    assert.deepEqual(getNodeTags(tags, 'class-Customer'), []);
    assert.equal(tags['class-Customer'], undefined);
  });

  it('normalizeTag trims and bounds', () => {
    assert.equal(normalizeTag('  foo bar  '), 'foo-bar');
    assert.equal(normalizeTag(''), '');
  });

  it('persists tags via storage interface', () => {
    const mem: Record<string, string> = {};
    const storage = {
      getItem: (k: string) => mem[k] ?? null,
      setItem: (k: string, v: string) => {
        mem[k] = v;
      },
    };
    let tags = addNodeTag({}, 'n1', 'alpha');
    assert.equal(saveTagsToStorage(storage, tags), true);
    const loaded = loadTagsFromStorage(storage);
    assert.deepEqual(getNodeTags(loaded, 'n1'), ['alpha']);
  });

  it('mergeNodeOverlay / mergeEdgeOverlay apply Surreal colors', () => {
    const n = mergeNodeOverlay(
      { id: 'class-A', data: { label: 'A' } },
      { status: 'fail', color: OVERLAY_STATUS_COLORS.fail.color, failCount: 1 },
    );
    assert.equal(n.style?.borderColor, OVERLAY_STATUS_COLORS.fail.color);
    assert.equal((n.data as { overlayStatus?: string }).overlayStatus, 'fail');
    const e = mergeEdgeOverlay(
      { id: 'e1', style: { stroke: '#000' } },
      { status: 'pass', color: OVERLAY_STATUS_COLORS.pass.color },
    );
    assert.equal(e.style?.stroke, OVERLAY_STATUS_COLORS.pass.color);
    assert.equal(MIDSPIRAL_TOOL_ORDER.length, 6);
  });

  it('default catalog includes formal :7003 and GuardrailsAI labels', () => {
    const cat = defaultGuardrailsCatalog({ healthOk: true });
    assert.ok(cat.some((s) => s.id === 'formal.guardrails.content'));
    assert.ok(cat.some((s) => s.port === FORMAL_GUARDRAILS_PORT && s.inSandbox));
    assert.ok(cat.some((s) => s.kind === 'guardrails_ai'));
    assert.equal(
      cat.find((s) => s.id === 'formal.guardrails.content')?.status,
      'active',
    );
  });

  it('select and remove active Guardrails servers', () => {
    let active = defaultGuardrailsCatalog({ healthOk: true });
    assert.ok(active.length >= 2);
    const first = active[0]!.id;
    const second = active[1]!.id;
    let selected = selectGuardrailsServer(null, first);
    assert.equal(selected, first);
    selected = selectGuardrailsServer(selected, second);
    assert.equal(selected, second);
    const before = active.length;
    active = removeActiveGuardrailsServer(active, first);
    assert.equal(active.length, before - 1);
    assert.ok(!active.some((s) => s.id === first));
    assert.ok(active.some((s) => s.id === second));
    // re-add
    const catalog = defaultGuardrailsCatalog();
    const restored = catalog.find((s) => s.id === first)!;
    active = addActiveGuardrailsServer(active, restored);
    assert.ok(active.some((s) => s.id === first));
    const listed = listActiveGuardrailsServers(active);
    assert.ok(listed.length >= 1);
  });
});
