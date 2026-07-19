/**
 * Session Integration Examples - Demonstrates how to use the session tracking system
 * with existing cloud agent workflows
 */

import { sessionTracker, Session } from './session-tracker.js';
import { sessionAnalytics, sessionMonitor } from './surqlize-integration.js';

/**
 * Example: Integrate session tracking with PR Sandbox Orchestrator
 */
export class PRSandboxSessionIntegration {
  
  /**
   * Start a session for PR sandbox operations
   */
  async startPRSandboxSession(repoUrl: string, prNumbers: number[]): Promise<Session> {
    const session = await sessionTracker.startSession({
      type: 'coding',
      title: `PR Sandbox: ${repoUrl} PRs ${prNumbers.join(',')}`,
      description: 'Automated PR sandbox creation and testing',
      repoUrl,
      prNumbers,
      branch: 'main',
      tags: ['pr-sandbox', 'automated-testing', 'cloudflare-tunnel']
    });

    // Set up monitoring for this session
    sessionMonitor.on('session_long_running', (data: any) => {
      if (data.sessionId === session.sessionId) {
        console.log(`PR sandbox session running long: ${data.durationMs}ms`);
      }
    });

    return session;
  }

  /**
   * Log PR sandbox execution events
   */
  async logPRSandboxEvent(
    sessionId: string, 
    eventType: string, 
    details: Record<string, any>
  ): Promise<void> {
    await sessionTracker.logEvent({
      sessionId,
      eventType,
      eventTime: new Date().toISOString(),
      details
    });
  }

  /**
   * Complete PR sandbox session
   */
  async completePRSandboxSession(
    sessionId: string, 
    results: any
  ): Promise<void> {
    await sessionTracker.updateSession(sessionId, {
      testsRun: results.testsRun,
      testsPassed: results.testsPassed,
      testsFailed: results.testsFailed,
      artifacts: results.artifacts,
      metadata: { ...results.metadata, completedAt: new Date().toISOString() }
    });

    await sessionTracker.completeSession();
  }

  /**
   * Fail PR sandbox session
   */
  async failPRSandboxSession(
    sessionId: string, 
    error: Error,
    context: any = {}
  ): Promise<void> {
    await sessionTracker.updateSession(sessionId, {
      metadata: { 
        ...context, 
        error: error.message, 
        stack: error.stack,
        failedAt: new Date().toISOString() 
      }
    });

    await sessionTracker.failSession(error.message);
  }
}

/**
 * Example: Integrate session tracking with research workflows
 */
export class ResearchSessionIntegration {
  
  /**
   * Start a research session
   */
  async startResearchSession(topic: string, researchType: string = 'technical'): Promise<Session> {
    const session = await sessionTracker.startSession({
      type: 'research',
      title: `Research: ${topic}`,
      description: `${researchType} research session`,
      tags: ['research', researchType, topic.toLowerCase().replace(/\s+/g, '-')],
      metadata: {
        researchTopic: topic,
        researchType,
        sources: []
      }
    });

    return session;
  }

  /**
   * Log research findings
   */
  async logResearchFinding(
    sessionId: string,
    finding: string,
    sources: string[] = [],
    confidence: number = 0.8
  ): Promise<void> {
    await sessionTracker.logEvent({
      sessionId,
      eventType: 'research_completed',
      eventTime: new Date().toISOString(),
      researchTopic: finding,
      details: {
        sources,
        confidence,
        timestamp: new Date().toISOString()
      }
    });

    // Update session with research findings
    const session = await sessionTracker.getSession(sessionId);
    if (session) {
      const currentSources = session.metadata?.sources || [];
      await sessionTracker.updateSession(sessionId, {
        metadata: {
          ...session.metadata,
          sources: [...currentSources, ...sources],
          lastFinding: finding,
          lastFindingTime: new Date().toISOString()
        }
      });
    }
  }

  /**
   * Complete research session with summary
   */
  async completeResearchSession(
    sessionId: string,
    summary: string,
    keyFindings: string[],
    recommendations: string[]
  ): Promise<void> {
    await sessionTracker.updateSession(sessionId, {
      metadata: {
        summary,
        keyFindings,
        recommendations,
        completedAt: new Date().toISOString()
      }
    });

    await sessionTracker.completeSession();
  }
}

/**
 * Example: Integrate session tracking with debugging workflows
 */
export class DebugSessionIntegration {
  
  /**
   * Start a debugging session
   */
  async startDebugSession(
    issue: string, 
    component: string,
    severity: 'low' | 'medium' | 'high' | 'critical' = 'medium'
  ): Promise<Session> {
    const session = await sessionTracker.startSession({
      type: 'debugging',
      title: `Debug: ${issue}`,
      description: `Debugging session for ${component}`,
      tags: ['debugging', component, severity],
      metadata: {
        issue,
        component,
        severity,
        startTime: new Date().toISOString(),
        investigationSteps: []
      }
    });

    return session;
  }

  /**
   * Log debugging step
   */
  async logDebugStep(
    sessionId: string,
    step: string,
    result: string,
    success: boolean,
    filesExamined: string[] = []
  ): Promise<void> {
    await sessionTracker.logEvent({
      sessionId,
      eventType: 'milestone_reached',
      eventTime: new Date().toISOString(),
      milestone: step,
      details: {
        result,
        success,
        filesExamined,
        timestamp: new Date().toISOString()
      }
    });

    // Update session with investigation steps
    const session = await sessionTracker.getSession(sessionId);
    if (session) {
      const currentSteps = session.metadata?.investigationSteps || [];
      await sessionTracker.updateSession(sessionId, {
        metadata: {
          ...session.metadata,
          investigationSteps: [...currentSteps, { step, result, success, timestamp: new Date().toISOString() }],
          lastStep: step,
          lastStepTime: new Date().toISOString()
        }
      });
    }
  }

  /**
   * Log error during debugging
   */
  async logDebugError(
    sessionId: string,
    error: Error,
    context: string
  ): Promise<void> {
    await sessionTracker.logEvent({
      sessionId,
      eventType: 'error_occurred',
      eventTime: new Date().toISOString(),
      errorMessage: error.message,
      details: {
        context,
        stack: error.stack,
        timestamp: new Date().toISOString()
      }
    });
  }

  /**
   * Complete debugging session with resolution
   */
  async completeDebugSession(
    sessionId: string,
    rootCause: string,
    solution: string,
    fixApplied: boolean
  ): Promise<void> {
    await sessionTracker.updateSession(sessionId, {
      metadata: {
        rootCause,
        solution,
        fixApplied,
        resolvedAt: new Date().toISOString(),
        resolutionTime: new Date().toISOString()
      }
    });

    await sessionTracker.completeSession();
  }
}

/**
 * Example: Analytics and reporting integration
 */
export class AnalyticsIntegration {
  
  /**
   * Generate session analytics report
   */
  async generateSessionReport(): Promise<{
    summary: any;
    recommendations: any;
    trends: any;
  }> {
    const analytics = await sessionAnalytics.getComprehensiveAnalytics();
    const recommendations = await sessionAnalytics.getSessionRecommendations();

    return {
      summary: {
        totalSessions: analytics.durationAnalysis.reduce((sum: number, a: any) => sum + a.sessionCount, 0),
        totalCost: analytics.costAnalysis.reduce((sum: number, a: any) => sum + a.totalCost, 0),
        avgSuccessRate: analytics.successRate.reduce((sum: number, a: any) => sum + a.successRate, 0) / analytics.successRate.length
      },
      recommendations,
      trends: {
        recentSessions: analytics.timeline,
        performance: analytics.testPerformance,
        correlations: analytics.correlations
      }
    };
  }

  /**
   * Get session performance metrics
   */
  async getPerformanceMetrics(): Promise<{
    efficiency: number;
    costEffectiveness: number;
    successRate: number;
    avgSessionDuration: number;
  }> {
    const analytics = await sessionAnalytics.getComprehensiveAnalytics();

    return {
      efficiency: this.calculateEfficiency(analytics),
      costEffectiveness: this.calculateCostEffectiveness(analytics),
      successRate: this.calculateOverallSuccessRate(analytics),
      avgSessionDuration: this.calculateAverageDuration(analytics)
    };
  }

  private calculateEfficiency(analytics: any): number {
    const completedSessions = analytics.durationAnalysis.filter((d: any) => d.status === 'completed');
    if (completedSessions.length === 0) return 0;

    const totalValue = completedSessions.reduce((sum: number, session: any) => {
      // Simple heuristic: value = tokens generated / cost
      return sum + (session.totalTokens / Math.max(session.totalCost, 0.01));
    }, 0);

    return totalValue / completedSessions.length;
  }

  private calculateCostEffectiveness(analytics: any): number {
    const costAnalysis = analytics.costAnalysis;
    if (costAnalysis.length === 0) return 0;

    const totalCost = costAnalysis.reduce((sum: number, analysis: any) => sum + analysis.totalCost, 0);
    const totalSessions = costAnalysis.reduce((sum: number, analysis: any) => sum + analysis.sessionCount, 0);

    return totalSessions / Math.max(totalCost, 0.01); // Sessions per dollar
  }

  private calculateOverallSuccessRate(analytics: any): number {
    const successRate = analytics.successRate;
    if (successRate.length === 0) return 0;

    const totalSessions = successRate.reduce((sum: number, analysis: any) => sum + analysis.totalSessions, 0);
    const successfulSessions = successRate.reduce((sum: number, analysis: any) => sum + analysis.completedSessions, 0);

    return (successfulSessions / totalSessions) * 100;
  }

  private calculateAverageDuration(analytics: any): number {
    const durationAnalysis = analytics.durationAnalysis;
    if (durationAnalysis.length === 0) return 0;

    const completedSessions = durationAnalysis.filter((d: any) => d.status === 'completed');
    if (completedSessions.length === 0) return 0;

    return completedSessions.reduce((sum: number, session: any) => sum + session.avgDuration, 0) / completedSessions.length;
  }
}

// Export singleton instances for easy integration
export const prSandboxIntegration = new PRSandboxSessionIntegration();
export const researchIntegration = new ResearchSessionIntegration();
export const debugIntegration = new DebugSessionIntegration();
export const analyticsIntegration = new AnalyticsIntegration();

// Default export for easy importing
export default {
  prSandboxIntegration,
  researchIntegration,
  debugIntegration,
  analyticsIntegration,
  sessionTracker,
  sessionAnalytics,
  sessionMonitor
};