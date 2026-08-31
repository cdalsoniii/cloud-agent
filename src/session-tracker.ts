/**
 * Session Tracker - Tracks ongoing coding and research sessions using SurrealDB
 * Integrates with SurrealORM and SurQLize for structured session management
 */

import { Surreal } from 'surrealdb';
import { z } from 'zod';
import { surrealQuery } from './event-logger.js';
import { createLogger } from './types.js';

const log = createLogger('session-tracker', process.env.VERBOSE === '1');

// Session schemas using Zod for validation
export const SessionSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string(),
  type: z.enum(['coding', 'research', 'planning', 'debugging', 'review']),
  status: z.enum(['active', 'paused', 'completed', 'failed']),
  title: z.string(),
  description: z.string().optional(),
  repoUrl: z.string().optional(),
  branch: z.string().optional(),
  prNumbers: z.array(z.number()).optional(),
  startTime: z.string().datetime(),
  endTime: z.string().datetime().optional(),
  durationMs: z.number().optional(),
  costUsd: z.number().default(0),
  tokenCount: z.number().default(0),
  filesModified: z.array(z.string()).optional(),
  testsRun: z.array(z.string()).optional(),
  testsPassed: z.number().optional(),
  testsFailed: z.number().optional(),
  artifacts: z.array(z.string()).optional(),
  correlationIds: z.array(z.string()).optional(),
  parentSessionId: z.string().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const SessionEventSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string(),
  eventType: z.enum([
    'session_start',
    'session_pause', 
    'session_resume',
    'session_complete',
    'session_fail',
    'file_modified',
    'test_run',
    'test_result',
    'code_generated',
    'research_completed',
    'error_occurred',
    'milestone_reached'
  ]),
  eventTime: z.string().datetime(),
  details: z.record(z.unknown()).optional(),
  filePath: z.string().optional(),
  testName: z.string().optional(),
  testResult: z.enum(['passed', 'failed', 'skipped']).optional(),
  codeSnippet: z.string().optional(),
  researchTopic: z.string().optional(),
  errorMessage: z.string().optional(),
  milestone: z.string().optional(),
  costIncrement: z.number().default(0),
  tokenIncrement: z.number().default(0),
});

export type Session = z.infer<typeof SessionSchema>;
export type SessionEvent = z.infer<typeof SessionEventSchema>;

class SessionTracker {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;
  private currentSession: Session | null = null;

  constructor() {
    this.initializeConnection();
  }

  private async initializeConnection(): Promise<void> {
    try {
      const surrealUrl = process.env.SURREALDB_URL;
      if (!surrealUrl || !surrealUrl.startsWith('http')) {
        log.info('SurrealDB not configured, using existing event logger fallback');
        return;
      }

      this.db = new Surreal() as any;
      await (this.db as any).connect(surrealUrl, {
        namespace: process.env.SURREALDB_NS || 'cloud-agent',
        database: process.env.SURREALDB_DB || 'rules',
        auth: {
          username: process.env.SURREALDB_USER || 'root',
          password: process.env.SURREALDB_PASS || 'root',
        },
      });

      log.info('SurrealDB connection established for session tracking');
    } catch (error) {
      log.error('Failed to connect to SurrealDB, using fallback:', error instanceof Error ? error.message : String(error));
      this.db = null;
    }
  }

  /**
   * Start a new coding/research session
   */
  async startSession(sessionData: Omit<Session, 'id' | 'sessionId' | 'startTime' | 'status'>): Promise<Session> {
    const sessionId = `session-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    
    const session: Session = {
      ...sessionData,
      sessionId,
      startTime: new Date().toISOString(),
      status: 'active',
    };

    try {
      if (this.db) {
        // Use SurrealDB query API
        const [created] = await this.db.query('CREATE coding_session CONTENT $session', { session }) as unknown[][];
        this.currentSession = (created as Session[])[0] || session;
      } else {
        // Fallback to existing surrealQuery
        await surrealQuery(`CREATE coding_session CONTENT ${JSON.stringify(session)}`);
        this.currentSession = session;
      }

      // Log session start event
      await this.logEvent({
        sessionId,
        eventType: 'session_start',
        eventTime: new Date().toISOString(),
        details: { sessionData },
        costIncrement: 0,
        tokenIncrement: 0,
      });

      log.info('Session started', { sessionId, type: session.type, title: session.title });
      return this.currentSession;
    } catch (error) {
      log.error('Failed to start session:', error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Log an event for the current session
   */
  async logEvent(eventData: Omit<SessionEvent, 'id'>): Promise<void> {
    try {
      if (!this.currentSession) {
        log.warn('No active session to log event');
        return;
      }

      const event: SessionEvent = {
        ...eventData,
        sessionId: this.currentSession.sessionId,
      };

      if (this.db) {
        await this.db.query('CREATE session_event CONTENT $event', { event });
      } else {
        await surrealQuery(`CREATE session_event CONTENT ${JSON.stringify(event)}`);
      }

      // Update session metrics based on event type
      await this.updateSessionMetrics(event);

    } catch (error) {
      log.error('Failed to log session event:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Update session metrics based on events
   */
  private async updateSessionMetrics(event: SessionEvent): Promise<void> {
    if (!this.currentSession) return;

    const updates: Partial<Session> = {};

    switch (event.eventType) {
      case 'test_result':
        if (event.testResult === 'passed') {
          updates.testsPassed = (this.currentSession.testsPassed || 0) + 1;
        } else if (event.testResult === 'failed') {
          updates.testsFailed = (this.currentSession.testsFailed || 0) + 1;
        }
        break;

      case 'file_modified':
        if (event.filePath) {
          updates.filesModified = [...(this.currentSession.filesModified || []), event.filePath];
        }
        break;

      case 'code_generated':
        updates.tokenCount = (this.currentSession.tokenCount || 0) + (event.tokenIncrement || 0);
        updates.costUsd = (this.currentSession.costUsd || 0) + (event.costIncrement || 0);
        break;
    }

    if (Object.keys(updates).length > 0) {
      await this.updateSession(this.currentSession.sessionId, updates);
    }
  }

  /**
   * Update session properties
   */
  async updateSession(sessionId: string, updates: Partial<Session>): Promise<void> {
    try {
      if (this.db) {
        await this.db.query('UPDATE coding_session SET $updates WHERE sessionId = $sessionId', { updates, sessionId });
      } else {
        const setClauses = Object.entries(updates)
          .map(([key, value]) => {
            if (Array.isArray(value)) {
              return `${key} = ${JSON.stringify(value)}`;
            } else if (typeof value === 'string') {
              return `${key} = '${value.replace(/'/g, "''")}'`;
            } else {
              return `${key} = ${value}`;
            }
          })
          .join(', ');
        
        await surrealQuery(`UPDATE coding_session:${sessionId} SET ${setClauses}`);
      }

      // Update current session if it's the active one
      if (this.currentSession && this.currentSession.sessionId === sessionId) {
        this.currentSession = { ...this.currentSession, ...updates };
      }

    } catch (error) {
      log.error('Failed to update session:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Complete the current session
   */
  async completeSession(): Promise<void> {
    if (!this.currentSession) return;

    try {
      const endTime = new Date().toISOString();
      const startTime = new Date(this.currentSession.startTime);
      const durationMs = Date.now() - startTime.getTime();

      await this.updateSession(this.currentSession.sessionId, {
        status: 'completed',
        endTime,
        durationMs
      });

      await this.logEvent({
        sessionId: this.currentSession.sessionId,
        eventType: 'session_complete',
        eventTime: endTime,
        details: { durationMs },
        costIncrement: 0,
        tokenIncrement: 0,
      });

      log.info('Session completed', { 
        sessionId: this.currentSession.sessionId, 
        durationMs,
        costUsd: this.currentSession.costUsd
      });

      this.currentSession = null;
    } catch (error) {
      log.error('Failed to complete session:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Fail the current session
   */
  async failSession(errorMessage: string): Promise<void> {
    if (!this.currentSession) return;

    try {
      const endTime = new Date().toISOString();
      const startTime = new Date(this.currentSession.startTime);
      const durationMs = Date.now() - startTime.getTime();

      await this.updateSession(this.currentSession.sessionId, {
        status: 'failed',
        endTime,
        durationMs,
        metadata: { ...this.currentSession.metadata, error: errorMessage }
      });

      await this.logEvent({
        sessionId: this.currentSession.sessionId,
        eventType: 'session_fail',
        eventTime: endTime,
        errorMessage,
        details: { durationMs },
        costIncrement: 0,
        tokenIncrement: 0,
      });

      log.error('Session failed', { 
        sessionId: this.currentSession.sessionId, 
        errorMessage,
        durationMs
      });

      this.currentSession = null;
    } catch (error) {
      log.error('Failed to mark session as failed:', error instanceof Error ? error.message : String(error));
    }
  }

  /**
   * Get current active session
   */
  getCurrentSession(): Session | null {
    return this.currentSession;
  }

  /**
   * Get session by ID
   */
  async getSession(sessionId: string): Promise<Session | null> {
    try {
      if (this.db) {
        const [result] = await this.db.query('SELECT * FROM coding_session WHERE sessionId = $sessionId', { sessionId }) as unknown[][];
        return ((result as Session[])[0]) || null;
      } else {
        const [result] = await surrealQuery(`SELECT * FROM coding_session WHERE sessionId = '${sessionId}'`) as unknown[];
        const r = result as Record<string, unknown>;
        const arr = (r.result || []) as unknown[];
        return arr[0] as Session || null;
      }
    } catch (error) {
      log.error('Failed to get session:', error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  /**
   * Get session events
   */
  async getSessionEvents(sessionId: string): Promise<SessionEvent[]> {
    try {
      if (this.db) {
        const [result] = await this.db.query('SELECT * FROM session_event WHERE sessionId = $sessionId ORDER BY eventTime ASC', { sessionId }) as unknown[][];
        return (result as SessionEvent[]) || [];
      } else {
        const [result] = await surrealQuery(
          `SELECT * FROM session_event WHERE sessionId = '${sessionId}' ORDER BY eventTime ASC`
        );
        return (result.result || []) as SessionEvent[];
      }
    } catch (error) {
      log.error('Failed to get session events:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Get sessions by type and status
   */
  async getSessions(filters: {
    type?: Session['type'];
    status?: Session['status'];
    repoUrl?: string;
    limit?: number;
  }): Promise<Session[]> {
    try {
      const whereClauses: string[] = [];
      
      if (filters.type) whereClauses.push(`type = '${filters.type}'`);
      if (filters.status) whereClauses.push(`status = '${filters.status}'`);
      if (filters.repoUrl) whereClauses.push(`repoUrl = '${filters.repoUrl}'`);

      const whereClause = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';
      const limitClause = filters.limit ? `LIMIT ${filters.limit}` : '';

      if (this.db) {
        const [result] = await this.db.query(
          `SELECT * FROM coding_session
           ${whereClause ? whereClause : ''}
           ORDER BY startTime DESC
           ${limitClause ? limitClause : ''}`,
          {}
        ) as unknown[][];
        return (result as Session[]) || [];
      } else {
        const [result] = await surrealQuery(
          `SELECT * FROM coding_session ${whereClause} ORDER BY startTime DESC ${limitClause}`
        );
        return (result.result || []) as Session[];
      }
    } catch (error) {
      log.error('Failed to get sessions:', error instanceof Error ? error.message : String(error));
      return [];
    }
  }

  /**
   * Get session statistics
   */
  async getSessionStats(): Promise<{
    totalSessions: number;
    activeSessions: number;
    completedSessions: number;
    failedSessions: number;
    totalCost: number;
    totalTokens: number;
    avgDuration: number;
  }> {
    try {
      if (this.db) {
        const [totalResult] = await this.db.query('SELECT count() as total FROM coding_session GROUP ALL') as unknown[][];
        const [activeResult] = await this.db.query('SELECT count() as active FROM coding_session WHERE status = "active" GROUP ALL') as unknown[][];
        const [completedResult] = await this.db.query('SELECT count() as completed FROM coding_session WHERE status = "completed" GROUP ALL') as unknown[][];
        const [failedResult] = await this.db.query('SELECT count() as failed FROM coding_session WHERE status = "failed" GROUP ALL') as unknown[][];
        const [costResult] = await this.db.query('SELECT math::sum(costUsd) as totalCost FROM coding_session GROUP ALL') as unknown[][];
        const [tokensResult] = await this.db.query('SELECT math::sum(tokenCount) as totalTokens FROM coding_session GROUP ALL') as unknown[][];
        const [durationResult] = await this.db.query('SELECT math::avg(durationMs) as avgDuration FROM coding_session WHERE durationMs != null GROUP ALL') as unknown[][];

        const totalArr = totalResult as Array<Record<string, unknown>>;
        const activeArr = activeResult as Array<Record<string, unknown>>;
        const completedArr = completedResult as Array<Record<string, unknown>>;
        const failedArr = failedResult as Array<Record<string, unknown>>;
        const costArr = costResult as Array<Record<string, unknown>>;
        const tokensArr = tokensResult as Array<Record<string, unknown>>;
        const durationArr = durationResult as Array<Record<string, unknown>>;

        return {
          totalSessions: (totalArr[0]?.total as number) || 0,
          activeSessions: (activeArr[0]?.active as number) || 0,
          completedSessions: (completedArr[0]?.completed as number) || 0,
          failedSessions: (failedArr[0]?.failed as number) || 0,
          totalCost: (costArr[0]?.totalCost as number) || 0,
          totalTokens: (tokensArr[0]?.totalTokens as number) || 0,
          avgDuration: (durationArr[0]?.avgDuration as number) || 0,
        };
      } else {
        const queries = [
          'SELECT count() as total FROM coding_session',
          'SELECT count() as active FROM coding_session WHERE status = "active"',
          'SELECT count() as completed FROM coding_session WHERE status = "completed"',
          'SELECT count() as failed FROM coding_session WHERE status = "failed"',
          'SELECT math::sum(costUsd) as totalCost FROM coding_session',
          'SELECT math::sum(tokenCount) as totalTokens FROM coding_session',
          'SELECT math::avg(durationMs) as avgDuration FROM coding_session WHERE durationMs != null'
        ];

        const results = await Promise.all(
          queries.map(query => surrealQuery(query))
        ) as unknown[][];

        return {
          totalSessions: ((results[0][0] as any)?.result?.[0]?.total as number) || 0,
          activeSessions: ((results[1][0] as any)?.result?.[0]?.active as number) || 0,
          completedSessions: ((results[2][0] as any)?.result?.[0]?.completed as number) || 0,
          failedSessions: ((results[3][0] as any)?.result?.[0]?.failed as number) || 0,
          totalCost: ((results[4][0] as any)?.result?.[0]?.totalCost as number) || 0,
          totalTokens: ((results[5][0] as any)?.result?.[0]?.totalTokens as number) || 0,
          avgDuration: ((results[6][0] as any)?.result?.[0]?.avgDuration as number) || 0,
        };
      }
    } catch (error) {
      log.error('Failed to get session stats:', error instanceof Error ? error.message : String(error));
      return {
        totalSessions: 0,
        activeSessions: 0,
        completedSessions: 0,
        failedSessions: 0,
        totalCost: 0,
        totalTokens: 0,
        avgDuration: 0,
      };
    }
  }

  /**
   * Close database connection
   */
  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }
}

// Create singleton instance
export const sessionTracker = new SessionTracker();

// Export utilities for easy integration
export * from './event-logger.js';

export default SessionTracker;