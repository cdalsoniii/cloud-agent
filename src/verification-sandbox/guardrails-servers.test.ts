import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerGuardrailsServer,
  removeGuardrailsServer,
  listGuardrailsServers,
  getGuardrailsServer,
  applyGuardrailsHealth,
  rollupMultiHealth,
  seedGuardrailsAiInstances,
  mergeGuardrailsSets,
  makeGuardrailsServer,
  defaultGuardrailsCatalog,
  guardrailsMaxServers,
  FORMAL_GUARDRAILS_PORT,
} from './guardrails-servers.js';
import {
  addActiveGuardrailsServer,
  removeActiveGuardrailsServer,
  registerActiveGuardrailsServer,
  listAllGuardrailsServers,
  defaultGuardrailsCatalog as panelCatalog,
} from './ontology-panel-state.js';

describe('guardrails-servers multi-instance', () => {
  it('registers N≥2 distinct Guardrails AI servers and removes one independently', () => {
    let set: ReturnType<typeof makeGuardrailsServer>[] = [];
    const a = makeGuardrailsServer({
      id: 'GuardrailsAI.A',
      kind: 'guardrails_ai',
      port: 7101,
    });
    const b = makeGuardrailsServer({
      id: 'GuardrailsAI.B',
      kind: 'guardrails_ai',
      port: 7102,
    });
    const c = makeGuardrailsServer({
      id: 'GuardrailsAI.C',
      kind: 'guardrails_ai',
      port: 7103,
    });
    let r = registerGuardrailsServer(set, a);
    assert.equal(r.ok, true);
    set = r.servers;
    r = registerGuardrailsServer(set, b);
    assert.equal(r.ok, true);
    set = r.servers;
    r = registerGuardrailsServer(set, c);
    assert.equal(r.ok, true);
    set = r.servers;
    assert.equal(listGuardrailsServers(set).length, 3);
    assert.ok(getGuardrailsServer(set, 'GuardrailsAI.B'));

    set = removeGuardrailsServer(set, 'GuardrailsAI.B');
    assert.equal(set.length, 2);
    assert.equal(getGuardrailsServer(set, 'GuardrailsAI.B'), undefined);
    assert.ok(getGuardrailsServer(set, 'GuardrailsAI.A'));
    assert.ok(getGuardrailsServer(set, 'GuardrailsAI.C'));
    assert.equal(getGuardrailsServer(set, 'GuardrailsAI.A')?.port, 7101);
    assert.equal(getGuardrailsServer(set, 'GuardrailsAI.C')?.port, 7103);
  });

  it('panel add/remove path keeps remaining servers (N=3)', () => {
    let active = panelCatalog({ healthOk: true });
    active = registerActiveGuardrailsServer(active, {
      id: 'GuardrailsAI.custom.1',
      name: 'GuardrailsAI.custom.1',
      kind: 'guardrails_ai',
      port: 7201,
      status: 'active',
    });
    active = registerActiveGuardrailsServer(active, {
      id: 'GuardrailsAI.custom.2',
      name: 'GuardrailsAI.custom.2',
      kind: 'guardrails_ai',
      port: 7202,
      status: 'active',
    });
    active = registerActiveGuardrailsServer(active, {
      id: 'GuardrailsAI.custom.3',
      name: 'GuardrailsAI.custom.3',
      kind: 'guardrails_ai',
      port: 7203,
      status: 'active',
    });
    const custom = listAllGuardrailsServers(active).filter((s) =>
      s.id.startsWith('GuardrailsAI.custom.'),
    );
    assert.equal(custom.length, 3);
    active = removeActiveGuardrailsServer(active, 'GuardrailsAI.custom.2');
    const after = listAllGuardrailsServers(active).filter((s) =>
      s.id.startsWith('GuardrailsAI.custom.'),
    );
    assert.equal(after.length, 2);
    assert.deepEqual(
      after.map((s) => s.id).sort(),
      ['GuardrailsAI.custom.1', 'GuardrailsAI.custom.3'],
    );
    // formal slot still present
    assert.ok(active.some((s) => s.id === 'formal.guardrails.content'));
  });

  it('one failed health does not erase the rest of the set', () => {
    let set = seedGuardrailsAiInstances({ count: 3, basePort: 7003 });
    assert.equal(set.length, 3);
    set = set.map((s) => ({ ...s, status: 'active' as const }));
    const updated = rollupMultiHealth(set, {
      [set[0]!.id]: { ok: false, note: 'connection refused' },
      [set[1]!.id]: { ok: true },
      // set[2] omitted — keep prior status
    });
    assert.equal(updated.length, 3);
    assert.equal(updated[0]!.status, 'unreachable');
    assert.equal(updated[1]!.status, 'active');
    assert.equal(updated[2]!.status, 'active');
    assert.ok(getGuardrailsServer(updated, set[1]!.id));
    assert.ok(getGuardrailsServer(updated, set[2]!.id));
  });

  it('applyGuardrailsHealth updates by id only', () => {
    const set = [
      makeGuardrailsServer({ id: 'g1', port: 1, status: 'active' }),
      makeGuardrailsServer({ id: 'g2', port: 2, status: 'active' }),
    ];
    const next = applyGuardrailsHealth(set, [
      { id: 'g1', ok: false, status: 'unreachable', note: 'down' },
    ]);
    assert.equal(next[0]!.status, 'unreachable');
    assert.equal(next[1]!.status, 'active');
    assert.equal(next[0]!.note, 'down');
  });

  it('soft max only when GUARDRAILS_MAX_SERVERS set; default unlimited', () => {
    assert.equal(guardrailsMaxServers({}), null);
    assert.equal(guardrailsMaxServers({ GUARDRAILS_MAX_SERVERS: '0' }), null);
    assert.equal(guardrailsMaxServers({ GUARDRAILS_MAX_SERVERS: '2' }), 2);
    let set: ReturnType<typeof makeGuardrailsServer>[] = [];
    for (let i = 0; i < 2; i++) {
      const r = registerGuardrailsServer(
        set,
        { id: `s${i}`, port: 8000 + i },
        { maxServers: 2 },
      );
      assert.equal(r.ok, true);
      set = r.servers;
    }
    const blocked = registerGuardrailsServer(
      set,
      { id: 's3', port: 8003 },
      { maxServers: 2 },
    );
    assert.equal(blocked.ok, false);
    assert.equal(blocked.servers.length, 2);
  });

  it('mergeGuardrailsSets and seed allow many formal binds', () => {
    const base = defaultGuardrailsCatalog({ healthOk: true });
    const extra = seedGuardrailsAiInstances({ count: 4, basePort: 7010 });
    const merged = mergeGuardrailsSets(base, extra);
    assert.ok(merged.length >= base.length + 3);
    assert.ok(merged.some((s) => s.port === 7010));
    assert.ok(merged.some((s) => s.port === 7013));
    assert.equal(FORMAL_GUARDRAILS_PORT, 7003);
  });

  it('addActiveGuardrailsServer is append-only for distinct ids', () => {
    let a = panelCatalog();
    const before = a.length;
    a = addActiveGuardrailsServer(
      a,
      makeGuardrailsServer({ id: 'extra.1', kind: 'remote', port: 9001 }),
    );
    a = addActiveGuardrailsServer(
      a,
      makeGuardrailsServer({ id: 'extra.2', kind: 'remote', port: 9002 }),
    );
    assert.equal(a.length, before + 2);
    // duplicate id does not grow
    a = addActiveGuardrailsServer(
      a,
      makeGuardrailsServer({ id: 'extra.1', kind: 'remote', port: 9001 }),
    );
    assert.equal(a.length, before + 2);
  });
});
