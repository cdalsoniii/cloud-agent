/**
 * Event Logger — logs every input, output, model interaction, and event to SurrealDB
 * Enables recursive improvement through comprehensive observability
 */
import * as crypto from 'node:crypto';
import type {
  SDLCEvent, ChainExecutionLog, VerificationArtifact,
  FeedbackLoop, LearningPattern, SDLCLearning, Counterexample
} from './sdlc-types.js';

// In-memory fallback when SurrealDB is not available
const memoryStore: Record<string, unknown[]> = {
  sdlc_event: [],
  chain_execution: [],
  verification_artifact: [],
  feedback_loop: [],
  sdlc_learning: [],
  sandbox_log: [],
};

interface SurrealResult { result?: unknown[]; status?: string; }

/** Read SurrealDB target at call time so loadEnv() can populate .env first. */
function surrealConfig(): {
  url: string;
  user: string;
  pass: string;
  ns: string;
  db: string;
  auth: string;
  available: boolean;
} {
  const url = process.env.SURREALDB_URL || '';
  const user = process.env.SURREALDB_USER || 'root';
  const pass = process.env.SURREALDB_PASS || 'root';
  const ns = process.env.SURREALDB_NS || 'main';
  const db = process.env.SURREALDB_DB || 'main';
  return {
    url,
    user,
    pass,
    ns,
    db,
    auth: Buffer.from(`${user}:${pass}`).toString('base64'),
    available: url.length > 0 && url.startsWith('http'),
  };
}

/** Sandbox log record persisted to local SurrealDB */
export interface SandboxLogRecord {
  log_id: string;
  sandbox_id: string;
  provider?: string;
  source: 'chain' | 'daytona' | 'manual' | 'sync' | 'verify';
  content: string;
  line_count?: number;
  operation?: string;
  correlation_id?: string;
  metadata?: Record<string, unknown>;
  created_at: string;
}

export async function surrealQuery(sql: string): Promise<SurrealResult[]> {
  const cfg = surrealConfig();
  if (!cfg.available) {
    // In-memory fallback: CREATE / SELECT simulation
    const createMatch = sql.match(/^CREATE\s+(\w+)\s+CONTENT\s+(.+)$/is);
    if (createMatch) {
      const table = createMatch[1];
      let obj: Record<string, unknown> = { _sql: sql, _inserted: new Date().toISOString() };
      try {
        obj = { ...JSON.parse(createMatch[2]), _inserted: new Date().toISOString() };
      } catch {
        // keep stub object
      }
      if (!memoryStore[table]) memoryStore[table] = [];
      memoryStore[table].push(obj);
      return [{ result: [obj], status: 'OK' }];
    }
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
  const resp = await fetch(`${cfg.url}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Accept': 'application/json',
      'surreal-ns': cfg.ns,
      'surreal-db': cfg.db,
      'NS': cfg.ns,
      'DB': cfg.db,
      'Authorization': `Basic ${cfg.auth}`,
    },
    body: sql,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`SurrealDB query failed HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  return resp.json() as Promise<SurrealResult[]>;
}

/** Ensure sandbox_log table exists (idempotent). */
export async function ensureSandboxLogTable(): Promise<void> {
  await surrealQuery('DEFINE TABLE IF NOT EXISTS sandbox_log SCHEMALESS');
  await surrealQuery('DEFINE INDEX IF NOT EXISTS idx_sandbox_log_sandbox ON sandbox_log FIELDS sandbox_id');
  await surrealQuery('DEFINE INDEX IF NOT EXISTS idx_sandbox_log_created ON sandbox_log FIELDS created_at');
}

/**
 * Persist sandbox logs to local SurrealDB (`sandbox_log` table).
 * Uses SURREALDB_URL / SURREALDB_NS / SURREALDB_DB from env (default localhost:8000 / main / main).
 */
export async function logSandboxLogs(
  record: Omit<SandboxLogRecord, 'log_id' | 'created_at'> & {
    log_id?: string;
    created_at?: string;
  }
): Promise<string> {
  const log_id = record.log_id || `slog-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const full: SandboxLogRecord = {
    ...record,
    log_id,
    content: typeof record.content === 'string' ? record.content : JSON.stringify(record.content),
    created_at: record.created_at || new Date().toISOString(),
  };

  if (surrealConfig().available) {
    await ensureSandboxLogTable();
  }

  await surrealQuery(`CREATE sandbox_log CONTENT ${JSON.stringify(full)}`);
  return log_id;
}

/** Query recent sandbox logs from SurrealDB (or in-memory fallback). */
export async function getRecentSandboxLogs(
  sandboxId?: string,
  limit = 20
): Promise<SandboxLogRecord[]> {
  const safeLimit = Math.max(1, Math.min(limit, 200));
  const where = sandboxId
    ? `WHERE sandbox_id = '${sandboxId.replace(/'/g, "\\'")}' `
    : '';
  const [r] = await surrealQuery(
    `SELECT * FROM sandbox_log ${where}ORDER BY created_at DESC LIMIT ${safeLimit}`
  );
  return (r?.result || []) as SandboxLogRecord[];
}

/** True when SURREALDB_URL points at an HTTP SurrealDB endpoint. */
export function isSurrealDbConfigured(): boolean {
  return surrealConfig().available;
}

export function getSurrealDbTarget(): { url: string; ns: string; db: string; configured: boolean } {
  const cfg = surrealConfig();
  return {
    url: cfg.url || '(unset)',
    ns: cfg.ns,
    db: cfg.db,
    configured: cfg.available,
  };
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
