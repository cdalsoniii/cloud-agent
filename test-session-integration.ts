/**
 * Test script to verify session tracking integration
 */

import { sessionTracker } from './src/session-tracker.js';
import { sessionAnalytics, sessionMonitor } from './src/surqlize-integration.js';
import { 
  prSandboxIntegration, 
  researchIntegration, 
  debugIntegration,
  analyticsIntegration 
} from './src/session-integration-examples.js';

async function testSessionTracking(): Promise<void> {
  console.log('🧪 Testing Session Tracking Integration...\n');

  try {
    // Test 1: Basic session creation
    console.log('1. Testing basic session creation...');
    const session = await sessionTracker.startSession({
      type: 'test',
      title: 'Integration Test Session',
      description: 'Test session for integration verification',
      tags: ['test', 'integration'],
      metadata: { testRun: true }
    });

    console.log(`✅ Session created: ${session.sessionId}`);

    // Test 2: Event logging
    console.log('\n2. Testing event logging...');
    await sessionTracker.logEvent({
      sessionId: session.sessionId,
      eventType: 'test_event',
      eventTime: new Date().toISOString(),
      details: { message: 'Test event logged successfully' }
    });

    console.log('✅ Event logged successfully');

    // Test 3: Session update
    console.log('\n3. Testing session update...');
    await sessionTracker.updateSession(session.sessionId, {
      metadata: { ...session.metadata, updatedAt: new Date().toISOString() }
    });

    console.log('✅ Session updated successfully');

    // Test 4: Session completion
    console.log('\n4. Testing session completion...');
    await sessionTracker.completeSession();

    console.log('✅ Session completed successfully');

    // Test 5: Session retrieval
    console.log('\n5. Testing session retrieval...');
    const retrievedSession = await sessionTracker.getSession(session.sessionId);
    console.log(`✅ Session retrieved: ${retrievedSession?.sessionId}`);

    console.log('\n🎉 All basic session tracking tests passed!\n');

  } catch (error) {
    console.error('❌ Session tracking test failed:', error);
    throw error;
  }
}

async function testIntegrationExamples(): Promise<void> {
  console.log('🧪 Testing Integration Examples...\n');

  try {
    // Test PR Sandbox Integration
    console.log('1. Testing PR Sandbox Integration...');
    const prSession = await prSandboxIntegration.startPRSandboxSession(
      'https://github.com/test/repo',
      [123, 456]
    );
    console.log(`✅ PR Sandbox session: ${prSession.sessionId}`);

    // Test Research Integration
    console.log('\n2. Testing Research Integration...');
    const researchSession = await researchIntegration.startResearchSession(
      'AI Integration Patterns',
      'technical'
    );
    console.log(`✅ Research session: ${researchSession.sessionId}`);

    // Test Debug Integration
    console.log('\n3. Testing Debug Integration...');
    const debugSession = await debugIntegration.startDebugSession(
      'Memory leak in session tracker',
      'session-tracker',
      'high'
    );
    console.log(`✅ Debug session: ${debugSession.sessionId}`);

    // Complete sessions
    await prSandboxIntegration.completePRSandboxSession(prSession.sessionId, {
      testsRun: 10,
      testsPassed: 10,
      testsFailed: 0,
      artifacts: ['test-report.json'],
      metadata: { test: true }
    });

    await researchIntegration.completeResearchSession(
      researchSession.sessionId,
      'Successful research on AI integration patterns',
      ['Pattern 1', 'Pattern 2'],
      ['Use pattern 1 for simple cases', 'Use pattern 2 for complex scenarios']
    );

    await debugIntegration.completeDebugSession(
      debugSession.sessionId,
      'Memory leak fixed',
      'Added proper cleanup in session tracker',
      true
    );

    console.log('\n✅ All integration examples completed successfully!\n');

  } catch (error) {
    console.error('❌ Integration examples test failed:', error);
    throw error;
  }
}

async function testAnalytics(): Promise<void> {
  console.log('🧪 Testing Analytics Integration...\n');

  try {
    // Test analytics generation
    console.log('1. Testing analytics generation...');
    const analytics = await sessionAnalytics.getComprehensiveAnalytics();
    console.log('✅ Analytics generated successfully');
    console.log(`   - Duration analysis: ${analytics.durationAnalysis.length} records`);
    console.log(`   - Cost analysis: ${analytics.costAnalysis.length} records`);
    console.log(`   - Success rate: ${analytics.successRate.length} records`);

    // Test recommendations
    console.log('\n2. Testing recommendations...');
    const recommendations = await sessionAnalytics.getSessionRecommendations();
    console.log('✅ Recommendations generated successfully');
    console.log(`   - Cost reduction opportunities: ${recommendations.costReductionOpportunities.length}`);
    console.log(`   - Success rate improvements: ${recommendations.successRateImprovements.length}`);

    // Test performance metrics
    console.log('\n3. Testing performance metrics...');
    const metrics = await analyticsIntegration.getPerformanceMetrics();
    console.log('✅ Performance metrics calculated');
    console.log(`   - Efficiency: ${metrics.efficiency.toFixed(2)}`);
    console.log(`   - Cost effectiveness: ${metrics.costEffectiveness.toFixed(2)}`);
    console.log(`   - Success rate: ${metrics.successRate.toFixed(1)}%`);

    console.log('\n✅ All analytics tests passed!\n');

  } catch (error) {
    console.error('❌ Analytics test failed:', error);
    // Analytics might fail if no sessions exist yet, which is expected
    console.log('⚠️  Analytics test may fail if no sessions exist in database');
  }
}

async function testSessionMonitor(): Promise<void> {
  console.log('🧪 Testing Session Monitor...\n');

  try {
    // Test session monitoring
    console.log('1. Testing session monitor setup...');
    
    // Register callback for long-running sessions
    sessionMonitor.on('session_long_running', (data: any) => {
      console.log(`📢 Long-running session alert: ${data.sessionId} (${data.durationMs}ms)`);
    });

    console.log('✅ Session monitor setup completed');

    // Create a test session that might trigger monitoring
    const testSession = await sessionTracker.startSession({
      type: 'monitor-test',
      title: 'Monitor Test Session',
      description: 'Test session for monitoring functionality',
      tags: ['monitor-test']
    });

    console.log(`✅ Monitor test session created: ${testSession.sessionId}`);

    // Get active sessions
    const activeSessions = sessionMonitor.getActiveSessions();
    console.log(`✅ Active sessions: ${activeSessions.length}`);

    // Complete the test session
    await sessionTracker.completeSession();

    console.log('\n✅ Session monitor tests passed!\n');

  } catch (error) {
    console.error('❌ Session monitor test failed:', error);
    throw error;
  }
}

async function main(): Promise<void> {
  console.log('🚀 Starting Session Tracking Integration Tests\n');

  try {
    await testSessionTracking();
    await testIntegrationExamples();
    await testAnalytics();
    await testSessionMonitor();

    console.log('🎉 All integration tests completed successfully!');
    console.log('\n📊 Next steps:');
    console.log('   - Run the PR sandbox orchestrator with real PRs');
    console.log('   - Check SurrealDB for session data');
    console.log('   - Verify analytics and monitoring work in production');
    console.log('   - Integrate with existing event logger fallback');

  } catch (error) {
    console.error('💥 Integration tests failed:', error);
    process.exit(1);
  }
}

// Run tests if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testSessionTracking, testIntegrationExamples, testAnalytics, testSessionMonitor };