/**
 * Recursive Improvement Engine
 * Analyzes SurrealDB event logs to improve the system over time
 */
import { surrealQuery } from './event-logger.js';
import type { LearningPattern, SDLCLearning, Counterexample, SDLCEvent, VerificationArtifact } from './sdlc-types.js';
import { getLearningForRepo, updateLearningConfidence, logLearningPattern, getEventsByCorrelation, pruneOldEvents as pruneEvents, getCounterexamplesForHash } from './event-logger.js';

function similarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/));
  const wordsB = new Set(b.toLowerCase().split(/\s+/));
  const intersection = new Set([...wordsA].filter(w => wordsB.has(w)));
  const union = new Set([...wordsA, ...wordsB]);
  return union.size ? intersection.size / union.size : 0;
}

export async function analyzeRepo(repoTarget: string): Promise<LearningPattern[]> {
  const patterns: LearningPattern[] = [];

  // Extract code patterns from sdlc_event
  const events = await surrealQuery(`SELECT file_path, event_type, phase, success FROM sdlc_event WHERE repo_target = '${repoTarget}' ORDER BY created_at DESC LIMIT 500`) as SDLCEvent[];
  const fileMap = new Map<string, { total: number; success: number }>();
  for (const ev of events) {
    const fp = ev.file_path || 'unknown';
    if (!fileMap.has(fp)) fileMap.set(fp, { total: 0, success: 0 });
    const s = fileMap.get(fp)!;
    s.total++;
    if (ev.success) s.success++;
  }

  for (const [file, stats] of fileMap) {
    if (stats.total >= 3) {
      patterns.push({
        pattern_id: `pat-${Date.now()}-${file.replace(/\//g, '-')}`,
        pattern_type: 'code_pattern', repo_target: repoTarget, file_path: file,
        pattern_data: { file, frequency: stats.total, successRate: stats.success / stats.total },
        frequency: stats.total, last_seen: new Date().toISOString(), confidence: 0.5, source_events: [],
      });
    }
  }

  // Extract counterexamples from verification_artifact
  const vas = await surrealQuery(`SELECT counterexamples FROM verification_artifact WHERE repo_target = '${repoTarget}' AND passed = false LIMIT 50`) as VerificationArtifact[];
  for (const va of vas) {
    if (va.counterexamples?.length) {
      const ce = va.counterexamples[0];
      patterns.push({
        pattern_id: `pat-${Date.now()}-counter-${patterns.length}`,
        pattern_type: 'counterexample', repo_target: repoTarget,
        pattern_data: { spec: ce.spec, input: ce.input, expected: ce.expected, actual: ce.actual },
        frequency: 1, last_seen: new Date().toISOString(), confidence: 0.7, source_events: [],
      });
    }
  }

  // Log discovered patterns
  for (const p of patterns) {
    await logLearningPattern(p);
  }

  return patterns;
}

export async function learnFromSuccess(correlationId: string): Promise<void> {
  const events = await getEventsByCorrelation(correlationId);
  const repoTarget = events[0]?.repo_target || 'unknown';

  // Boost confidence for patterns that led to success
  for (const ev of events) {
    if (ev.file_path) {
      await updateLearningConfidence(`pat-${ev.file_path.replace(/\//g, '-')}`, true);
    }
  }

  // Mark strategies as successful
  await surrealQuery(`UPDATE sdlc_learning SET confidence = confidence * 1.2 WHERE repo_target = '${repoTarget}' AND pattern_data.success = true`);
}

export async function learnFromFailure(correlationId: string): Promise<void> {
  const events = await getEventsByCorrelation(correlationId);
  const repoTarget = events[0]?.repo_target || 'unknown';

  // Add counterexamples from failed verification
  for (const ev of events) {
    if (!ev.success && ev.event_type === 'verification_result') {
      const counterexamples = await getCounterexamplesForHash(ev.event_id);
      if (counterexamples.length > 0) {
        await surrealQuery(
          `INSERT INTO sdlc_learning (pattern_id, pattern_type, repo_target, pattern_data, frequency, last_seen, confidence) VALUES ('pat-${Date.now()}-ce', 'counterexample', '${repoTarget}', ${JSON.stringify(counterexamples[0])}, 1, '${new Date().toISOString()}', 0.9)`
        );
      }
    }
  }
}

export async function updateRiskProfiles(repoTarget: string): Promise<Record<string, { score: number; bugDensity: number }>> {
  const rows = await surrealQuery(
    `SELECT file_path, count() AS total, count(CASE WHEN success = false THEN 1 END) AS errors FROM sdlc_event WHERE repo_target = '${repoTarget}' GROUP BY file_path`
  ) as { file_path: string; total: number; errors: number }[];
  const profiles: Record<string, { score: number; bugDensity: number }> = {};

  for (const row of rows) {
    const bugDensity = row.total > 0 ? row.errors / row.total : 0;
    profiles[row.file_path] = { score: Math.min(1, bugDensity * 2), bugDensity };
  }

  return profiles;
}

export async function recommendStrategy(task: string, repoTarget: string): Promise<Record<string, unknown> | null> {
  const learning = await getLearningForRepo(repoTarget);
  let best: Record<string, unknown> | null = null;
  let bestScore = 0;

  for (const strategy of learning.successfulStrategies) {
    const strategyTask = (strategy as unknown as { task?: string }).task || '';
    const score = similarity(task, strategyTask);
    if (score > bestScore) {
      bestScore = score;
      best = strategy as unknown as Record<string, unknown>;
    }
  }

  return bestScore > 0.3 ? best : null;
}

export async function collectCounterexamples(repoTarget: string): Promise<Counterexample[]> {
  const rows = await surrealQuery(
    `SELECT pattern_data FROM sdlc_learning WHERE repo_target = '${repoTarget}' AND pattern_type = 'counterexample' ORDER BY last_seen DESC LIMIT 50`
  ) as LearningPattern[];
  return rows.map(row => row.pattern_data as unknown as Counterexample);
}

export async function maintenanceCycle(retentionDays: number = 90): Promise<{ pruned: number; patterns_updated: number }> {
  const pruned = await pruneEvents(retentionDays);

  // Recalculate pattern frequencies
  const rows = await surrealQuery('SELECT pattern_id, count(source_events) AS freq FROM sdlc_learning GROUP BY pattern_id') as { pattern_id: string; freq: number }[];
  for (const row of rows) {
    await surrealQuery(`UPDATE sdlc_learning:${row.pattern_id} SET frequency = ${row.freq}`);
  }

  return { pruned, patterns_updated: rows.length };
}

export async function getImprovementMetrics(repoTarget: string): Promise<Record<string, number>> {
  const runsData = await surrealQuery(`SELECT count() AS total, count(CASE WHEN success = true THEN 1 END) AS successes FROM sdlc_event WHERE repo_target = '${repoTarget}' AND event_type = 'chain_output'`);
  const stats = (runsData[0] as { total?: number; successes?: number }) || { total: 0, successes: 0 };

  const costsData = await surrealQuery(`SELECT math::sum(cost_usd) AS totalCost FROM chain_execution WHERE execution_id CONTAINS '${repoTarget}'`);
  const costRow = (costsData[0] as { totalCost?: number }) || { totalCost: 0 };

  const patternsData = await surrealQuery(`SELECT count() AS total FROM sdlc_learning WHERE repo_target = '${repoTarget}'`);
  const patternCount = (patternsData[0] as { total?: number })?.total || 0;

  return {
    totalRuns: stats.total || 0,
    successRate: stats.total ? (stats.successes || 0) / stats.total : 0,
    avgCostUsd: costRow.totalCost || 0,
    specsReused: 0,
    counterexamplesLearned: 0,
    patternsDiscovered: patternCount,
  };
}
