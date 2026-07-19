/**
 * SurQLize Integration - Advanced query capabilities for session tracking
 * Provides SurQL query building and optimization
 */

import { Session, SessionEvent } from './session-tracker.js';

/**
 * SurQL query builder for session analytics
 */
export class SessionQueryBuilder {
  private queries: string[] = [];

  /**
   * Build a query for session duration analysis
   */
  durationAnalysis(): this {
    this.queries.push(`
      SELECT 
        type,
        status,
        count() as sessionCount,
        math::avg(durationMs) as avgDuration,
        math::min(durationMs) as minDuration,
        math::max(durationMs) as maxDuration,
        math::sum(costUsd) as totalCost,
        math::sum(tokenCount) as totalTokens
      FROM coding_session 
      WHERE durationMs != null
      GROUP BY type, status
    `);
    return this;
  }

  /**
   * Build a query for cost analysis by session type
   */
  costAnalysis(): this {
    this.queries.push(`
      SELECT 
        type,
        math::sum(costUsd) as totalCost,
        math::avg(costUsd) as avgCost,
        math::sum(tokenCount) as totalTokens,
        math::avg(tokenCount) as avgTokens,
        count() as sessionCount
      FROM coding_session 
      GROUP BY type
    `);
    return this;
  }

  /**
   * Build a query for success rate analysis
   */
  successRateAnalysis(): this {
    this.queries.push(`
      SELECT 
        type,
        count() as totalSessions,
        count(CASE WHEN status = 'completed' THEN 1 END) as completedSessions,
        count(CASE WHEN status = 'failed' THEN 1 END) as failedSessions,
        (
          count(CASE WHEN status = 'completed' THEN 1 END) / 
          count() * 100
        ) as successRate
      FROM coding_session 
      GROUP BY type
    `);
    return this;
  }

  /**
   * Build a query for file modification patterns
   */
  fileModificationAnalysis(): this {
    this.queries.push(`
      SELECT 
        array::distinct(array::flatten(filesModified)) as uniqueFiles,
        count() as modificationCount
      FROM coding_session 
      WHERE filesModified != null
      GROUP ALL
    `);
    return this;
  }

  /**
   * Build a query for test performance analysis
   */
  testPerformanceAnalysis(): this {
    this.queries.push(`
      SELECT 
        type,
        math::sum(testsPassed) as totalPassed,
        math::sum(testsFailed) as totalFailed,
        math::sum(testsPassed + testsFailed) as totalTests,
        (
          math::sum(testsPassed) / 
          math::sum(testsPassed + testsFailed) * 100
        ) as passRate
      FROM coding_session 
      WHERE testsPassed != null OR testsFailed != null
      GROUP BY type
    `);
    return this;
  }

  /**
   * Build a query for session timeline
   */
  sessionTimeline(days: number = 7): this {
    this.queries.push(`
      SELECT 
        time::floor(startTime, '1d') as day,
        type,
        count() as sessionCount,
        math::sum(durationMs) as totalDuration,
        math::sum(costUsd) as totalCost
      FROM coding_session 
      WHERE startTime > time::now() - ${days}d
      GROUP BY day, type
      ORDER BY day DESC
    `);
    return this;
  }

  /**
   * Build a query for correlation analysis
   */
  correlationAnalysis(): this {
    this.queries.push(`
      SELECT 
        c.type,
        c.status,
        count(e) as eventCount,
        math::avg(e.costIncrement) as avgEventCost,
        math::sum(e.costIncrement) as totalEventCost
      FROM coding_session c
      INNER JOIN session_event e ON c.sessionId = e.sessionId
      GROUP BY c.type, c.status
    `);
    return this;
  }

  /**
   * Execute the built queries
   */
  async execute(): Promise<Record<string, any[]>> {
    const results: Record<string, any[]> = {};
    
    for (let i = 0; i < this.queries.length; i++) {
      const query = this.queries[i];
      try {
        const { surrealQuery } = await import('./event-logger.js');
        const [result] = await surrealQuery(query);
        results[`query_${i}`] = result.result || [];
      } catch (error) {
        console.error(`Failed to execute query ${i}:`, error);
        results[`query_${i}`] = [];
      }
    }
    
    return results;
  }

  /**
   * Clear all queries
   */
  clear(): this {
    this.queries = [];
    return this;
  }
}

/**
 * Advanced session analytics using SurQL
 */
export class SessionAnalytics {
  private queryBuilder: SessionQueryBuilder;

  constructor() {
    this.queryBuilder = new SessionQueryBuilder();
  }

  /**
   * Get comprehensive session analytics
   */
  async getComprehensiveAnalytics(): Promise<{
    durationAnalysis: any[];
    costAnalysis: any[];
    successRate: any[];
    fileModifications: any[];
    testPerformance: any[];
    timeline: any[];
    correlations: any[];
  }> {
    const results = await this.queryBuilder
      .clear()
      .durationAnalysis()
      .costAnalysis()
      .successRateAnalysis()
      .fileModificationAnalysis()
      .testPerformanceAnalysis()
      .sessionTimeline()
      .correlationAnalysis()
      .execute();

    return {
      durationAnalysis: results.query_0 || [],
      costAnalysis: results.query_1 || [],
      successRate: results.query_2 || [],
      fileModifications: results.query_3 || [],
      testPerformance: results.query_4 || [],
      timeline: results.query_5 || [],
      correlations: results.query_6 || [],
    };
  }

  /**
   * Get session recommendations based on analytics
   */
  async getSessionRecommendations(): Promise<{
    optimalSessionDuration: number;
    costReductionOpportunities: string[];
    successRateImprovements: string[];
    fileModificationPatterns: string[];
    testPerformanceSuggestions: string[];
  }> {
    const analytics = await this.getComprehensiveAnalytics();
    
    const recommendations = {
      optimalSessionDuration: this.calculateOptimalDuration(analytics.durationAnalysis),
      costReductionOpportunities: this.identifyCostReductions(analytics.costAnalysis),
      successRateImprovements: this.identifySuccessImprovements(analytics.successRate),
      fileModificationPatterns: this.identifyFilePatterns(analytics.fileModifications),
      testPerformanceSuggestions: this.identifyTestImprovements(analytics.testPerformance),
    };

    return recommendations;
  }

  private calculateOptimalDuration(durationAnalysis: any[]): number {
    const completedSessions = durationAnalysis.filter((d: any) => d.status === 'completed');
    if (completedSessions.length === 0) return 3600000; // 1 hour default
    
    return completedSessions.reduce((sum: number, session: any) => 
      sum + session.avgDuration, 0) / completedSessions.length;
  }

  private identifyCostReductions(costAnalysis: any[]): string[] {
    const suggestions: string[] = [];
    
    costAnalysis.forEach((analysis: any) => {
      if (analysis.avgCost > 10) { // More than $10 per session
        suggestions.push(
          `Reduce costs for ${analysis.type} sessions: current avg $${analysis.avgCost.toFixed(2)}`
        );
      }
    });

    return suggestions;
  }

  private identifySuccessImprovements(successRate: any[]): string[] {
    const suggestions: string[] = [];
    
    successRate.forEach((analysis: any) => {
      if (analysis.successRate < 70) { // Less than 70% success rate
        suggestions.push(
          `Improve success rate for ${analysis.type} sessions: current ${analysis.successRate.toFixed(1)}%`
        );
      }
    });

    return suggestions;
  }

  private identifyFilePatterns(fileModifications: any[]): string[] {
    const patterns: string[] = [];
    
    if (fileModifications[0]?.uniqueFiles) {
      const files = fileModifications[0].uniqueFiles;
      if (files.length > 50) {
        patterns.push('High file modification count detected. Consider better modularization.');
      }
    }

    return patterns;
  }

  private identifyTestImprovements(testPerformance: any[]): string[] {
    const suggestions: string[] = [];
    
    testPerformance.forEach((analysis: any) => {
      if (analysis.passRate < 90) { // Less than 90% pass rate
        suggestions.push(
          `Improve test pass rate for ${analysis.type} sessions: current ${analysis.passRate.toFixed(1)}%`
        );
      }
    });

    return suggestions;
  }
}

/**
 * Real-time session monitoring
 */
export class SessionMonitor {
  private activeSessions: Map<string, Session> = new Map();
  private eventCallbacks: Map<string, Function[]> = new Map();

  constructor() {
    this.startMonitoring();
  }

  /**
   * Start monitoring session events in real-time
   */
  private async startMonitoring(): Promise<void> {
    // This would use SurrealDB's real-time capabilities
    // For now, we'll implement polling-based monitoring
    setInterval(() => this.checkActiveSessions(), 30000); // Check every 30 seconds
  }

  /**
   * Check for active sessions and their status
   */
  private async checkActiveSessions(): Promise<void> {
    try {
      const { sessionTracker } = await import('./session-tracker.js');
      const activeSessions = await sessionTracker.getSessions({ 
        status: 'active', 
        limit: 50 
      });

      // Check for long-running sessions
      activeSessions.forEach(session => {
        const startTime = new Date(session.startTime);
        const durationMs = Date.now() - startTime.getTime();
        
        if (durationMs > 3600000) { // 1 hour
          this.notifyEvent('session_long_running', {
            sessionId: session.sessionId,
            durationMs,
            type: session.type,
            title: session.title
          });
        }
      });

      this.activeSessions = new Map(activeSessions.map(s => [s.sessionId, s]));
    } catch (error) {
      console.error('Session monitoring error:', error);
    }
  }

  /**
   * Register callback for session events
   */
  on(event: string, callback: Function): void {
    if (!this.eventCallbacks.has(event)) {
      this.eventCallbacks.set(event, []);
    }
    this.eventCallbacks.get(event)!.push(callback);
  }

  /**
   * Notify event subscribers
   */
  private notifyEvent(event: string, data: any): void {
    const callbacks = this.eventCallbacks.get(event) || [];
    callbacks.forEach(callback => {
      try {
        callback(data);
      } catch (error) {
        console.error('Event callback error:', error);
      }
    });
  }

  /**
   * Get currently active sessions
   */
  getActiveSessions(): Session[] {
    return Array.from(this.activeSessions.values());
  }
}

// Export singleton instances
export const sessionAnalytics = new SessionAnalytics();
export const sessionMonitor = new SessionMonitor();

export default {
  SessionQueryBuilder,
  SessionAnalytics,
  SessionMonitor,
  sessionAnalytics,
  sessionMonitor
};