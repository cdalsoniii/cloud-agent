import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeBudgetSnapshot,
  seedOntologyBudget,
  fmtDuration,
  fmtMoney,
  normalizeBudget,
  DEFAULT_SANDBOX_RATE_USD_PER_SEC,
} from './ontology-budget.js';

describe('ontology-budget', () => {
  it('fmtDuration pads HH:MM:SS', () => {
    assert.equal(fmtDuration(0), '00:00:00');
    assert.equal(fmtDuration(65), '00:01:05');
    assert.equal(fmtDuration(3661), '01:01:01');
  });

  it('counts prepaid credits down with sandbox runtime', () => {
    const started = '2026-08-09T12:00:00.000Z';
    const budget = seedOntologyBudget({
      prepaidUsd: 10,
      rateUsdPerSec: 0.0004,
      startedAt: started,
      source: 'session',
    });
    const t0 = Date.parse(started);
    const snap0 = computeBudgetSnapshot(budget, t0);
    assert.equal(snap0.elapsedSec, 0);
    assert.equal(snap0.remainingUsd, 10);
    assert.equal(snap0.creditsRemaining, 10);
    assert.equal(snap0.exhausted, false);

    // 1000 seconds * 0.0004 = $0.40 burn
    const snap = computeBudgetSnapshot(budget, t0 + 1000_000);
    assert.equal(snap.elapsedSec, 1000);
    assert.ok(Math.abs(snap.burnUsd - 0.4) < 1e-9);
    assert.ok(Math.abs(snap.remainingUsd - 9.6) < 1e-9);
    assert.equal(snap.fmtRuntime, '00:16:40');
    assert.ok(snap.remainingPct < 100);
    assert.ok(snap.remainingPct > 90);
  });

  it('never goes below zero remaining', () => {
    const budget = seedOntologyBudget({
      prepaidUsd: 1,
      rateUsdPerSec: 1,
      startedAt: '2026-08-09T12:00:00.000Z',
    });
    const snap = computeBudgetSnapshot(
      budget,
      Date.parse('2026-08-09T12:00:00.000Z') + 10_000,
    );
    assert.equal(snap.remainingUsd, 0);
    assert.equal(snap.exhausted, true);
    assert.equal(snap.remainingPct, 0);
  });

  it('warns under 20% remaining', () => {
    const budget = seedOntologyBudget({
      prepaidUsd: 10,
      rateUsdPerSec: 0.001,
      startedAt: '2026-08-09T12:00:00.000Z',
    });
    // burn 8.5 of 10 → 15% left
    const snap = computeBudgetSnapshot(
      budget,
      Date.parse('2026-08-09T12:00:00.000Z') + 8500_000,
    );
    assert.ok(snap.remainingPct < 20);
    assert.equal(snap.warn, true);
    assert.equal(snap.exhausted, false);
  });

  it('includes MCP call burn and auto-stop remaining', () => {
    const budget = seedOntologyBudget({
      prepaidUsd: 10,
      rateUsdPerSec: DEFAULT_SANDBOX_RATE_USD_PER_SEC,
      startedAt: '2026-08-09T12:00:00.000Z',
      autoStopMinutes: 5,
      mcpCallCount: 10,
      mcpRateUsdPerCall: 0.0015,
    });
    const snap = computeBudgetSnapshot(
      budget,
      Date.parse('2026-08-09T12:00:00.000Z') + 60_000,
    );
    assert.equal(snap.mcpCallCount, 10);
    assert.ok(Math.abs(snap.mcpBurnUsd - 0.015) < 1e-9);
    assert.ok(snap.autoStopRemainingSec != null);
    assert.ok(Math.abs((snap.autoStopRemainingSec as number) - 240) < 0.01);
  });

  it('normalizeBudget accepts session shape', () => {
    const b = normalizeBudget({
      prepaidUsd: 25,
      startedAt: '2026-01-01T00:00:00.000Z',
      rateUsdPerSec: 0.001,
      source: 'session',
    });
    assert.equal(b.prepaidUsd, 25);
    assert.equal(b.rateUsdPerSec, 0.001);
    assert.equal(fmtMoney(1.23456), '$1.2346');
  });
});
