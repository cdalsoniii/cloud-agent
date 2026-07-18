/**
 * Event Logger — logs every input, output, model interaction, and event to SurrealDB
 * Enables recursive improvement through comprehensive observability
 */
import * as crypto from 'node:crypto';
import type {
  SDLCEvent, ChainExecutionLog, VerificationArtifact,
  FeedbackLoop, LearningPattern, SDLCLearning, Counterexample
} from './sdlc-types.js';

const SURREALDB_URL = process.env.SURREALDB_URL || '';
const SURREALDB_USER = process.env.SURREALDB_USER || 'root';
const SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';
const SURREALDB_AUTH = Buffer.from(`${SURREALDB_USER}:${SURREALDB_PASS}`).toString('base64');
const DB_AVAILABLE = SURREALDB_URL.length > 0 && SURREALDB_URL.startsWith('http');

// In-memory fallback when SurrealDB is not available
const memoryStore: Record<string, unknown[]> = {
  sdlc_event: [],
  chain_execution: [],
  verification_artifact: [],
  feedback_loop: [],
  sdlc_learning: [],
};

interface SurrealResult { result?: unknown[]; status?: string; }

export async function surrealQuery(sql: string): Promise<SurrealResult[]> {
  if (!DB_AVAILABLE) {
    // In-memory fallback: simple INSERT/SELECT simulation
    const insertMatch = sql.match(/^INSERT INTO (\w+)\s+(.*)/i);
    if (insertMatch) {
      const table = insertMatch[1];
      const obj = { _sql: sql, _inserted: new Date().toISOString() };
      if (!memoryStore[table]) memoryStore[table] = [];
      memoryStore[table].push(obj);
      return [{ result: [obj], status: 'OK' }];
    }
    const selectMatch = sql.match(/^SELECT\s+.+\bFROM\s+(\w+)\b/i);
    if (selectMatch) {
      const table = selectMatch[1];
      return [{ result: memoryStore[table] || [], status: 'OK' }];
    }
    return [{ result: [], status: 'OK' }];
  }
  const resp = await fetch(`${SURREALDB_URL}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'NS': 'cloud-agent',
      'DB': 'rules',
      'Authorization': `Basic ${SURREALDB_AUTH}`,
      'Accept': 'application/json',
    },
    body: sql,
  });
  return resp.json() as Promise<SurrealResult[]>;
}

export async function logChainExecution(log: ChainExecutionLog): Promise<void> {
  const json = JSON.stringify(log).replace(/'/g, "\\'");
  await surrealQuery(`CREATE chain_execution CONTENT ${JSON.stringify(log)}`);
}

export async function logSDLCEvent(event: SDLCEvent): Promise<void> {
  await surrealQuery(`CREATE sdlc_event CONTENT ${JSON.stringify(event)}`);
}

export async function logVerificationArtifact(artifact: VerificationArtifact): Promise<void> {
  await surrealQuery(`CREATE verification_artifact CONTENT ${JSON.stringify(artifact)}`);
}

export async function logFeedbackLoop(loop: FeedbackLoop): Promise<void> {
  await surrealQuery(`CREATE feedback_loop CONTENT ${JSON.stringify(loop)}`);
}

export async function logLearningPattern(pattern: LearningPattern): Promise<void> {
  await surrealQuery(`CREATE sdlc_learning CONTENT ${JSON.stringify(pattern)}`);
}

export async function getLearningForRepo(repoTarget: string): Promise<SDLCLearning> {
  const [r] = await surrealQuery(
    `SELECT * FROM sdlc_learning WHERE repo_target = '${repoTarget}' ORDER BY frequency DESC LIMIT 100`
  );
  const rows = (r.result || []) as LearningPattern[];

  const learning: SDLCLearning = {
    repoPatterns: {},
    flakyTests: [],
    riskProfile: {},
    successfulStrategies: [],
    commonCounterexamples: [],
    specReuseRate: 0,
    falsePositiveRate: 0,
  };

  for (const row of rows) {
    switch (row.pattern_type) {
      case 'code_pattern':
        learning.repoPatterns[row.file_path || ''] = learning.repoPatterns[row.file_path || ''] || [];
        learning.repoPatterns[row.file_path || ''].push({
          file: row.file_path || '', pattern: String(row.pattern_data?.pattern || ''),
          frequency: row.frequency, lastSeen: new Date(row.last_seen),
        });
        break;
      case 'risk_profile':
        learning.riskProfile[row.file_path || ''] = row.pattern_data as unknown as SDLCLearning['riskProfile'][string];
        break;
      case 'successful_strategy':
        learning.successfulStrategies.push(row.pattern_data as unknown as SDLCLearning['successfulStrategies'][number]);
        break;
      case 'counterexample':
        learning.commonCounterexamples.push(row.pattern_data as unknown as Counterexample);
        break;
    }
  }

  return learning;
}

export async function getEventsByCorrelation(correlationId: string): Promise<SDLCEvent[]> {
  const [r] = await surrealQuery(
    `SELECT * FROM sdlc_event WHERE correlation_id = '${correlationId}' ORDER BY created_at ASC`
  );
  return (r.result || []) as SDLCEvent[];
}

export async function getCounterexamplesForHash(hash: string): Promise<Counterexample[]> {
  const [r] = await surrealQuery(
    `SELECT counterexamples FROM verification_artifact WHERE hash = '${hash}' AND passed = false`
  );
  const artifacts = (r.result || []) as VerificationArtifact[];
  return artifacts.flatMap(a => a.counterexamples || []);
}

export async function getCostSummary(correlationId: string): Promise<{ totalCost: number; totalTokens: number }> {
  const [r] = await surrealQuery(
    `SELECT math::sum(cost_usd) AS totalCost, math::sum(tokens_in + tokens_out) AS totalTokens FROM chain_execution WHERE execution_id CONTAINS '${correlationId}'`
  );
  const row = ((r.result || [])[0] || {}) as { totalCost?: number; totalTokens?: number };
  return { totalCost: row.totalCost || 0, totalTokens: row.totalTokens || 0 };
}

export async function updateLearningConfidence(patternId: string, success: boolean): Promise<void> {
  const delta = success ? 0.1 : -0.1;
  await surrealQuery(
    `UPDATE sdlc_learning:${patternId} SET confidence = math::max(0, math::min(1, confidence + ${delta})), frequency += 1, last_seen = time::now()`
  );
}

export async function pruneOldEvents(retentionDays: number = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const [r] = await surrealQuery(
    `DELETE FROM sdlc_event WHERE created_at < '${cutoff}'`
  );
  return ((r.result || []) as unknown[]).length;
}
