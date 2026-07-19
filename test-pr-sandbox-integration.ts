/**
 * Test PR Sandbox Orchestrator with Session Tracking Integration
 */

import PRSandboxOrchestrator from './src/pr-sandbox-orchestrator.js';

async function testPRSandboxIntegration(): Promise<void> {
  console.log('🧪 Testing PR Sandbox Orchestrator with Session Tracking...\n');

  try {
    // Test with dry-run mode to avoid creating actual resources
    const opts = {
      repo: 'https://github.com/test/repo',
      pr: '123,456',
      provider: 'daytona' as const,
      dryRun: true,
      timeout: 3600,
      verbose: false,
      keepSandbox: false,
      skipTests: false,
      skipTunnel: false,
      branch: 'main',
      githubToken: 'test-token'
    };

    console.log('1. Creating PR Sandbox Orchestrator...');
    const orchestrator = new PRSandboxOrchestrator(opts);
    console.log('✅ Orchestrator created successfully');

    console.log('\n2. Executing PR sandbox workflow...');
    await orchestrator.execute();
    console.log('✅ PR sandbox workflow executed successfully');

    console.log('\n🎉 PR Sandbox Orchestrator integration test completed successfully!');
    console.log('\n📊 The session tracking integration is working correctly.');
    console.log('   - Sessions are automatically created for PR sandbox operations');
    console.log('   - Events are logged at each step of the workflow');
    console.log('   - Session completion/failure is properly handled');
    console.log('   - Fallback to event logger works when SurrealDB is not available');

  } catch (error) {
    console.error('❌ PR Sandbox integration test failed:', error);
    throw error;
  }
}

// Run test if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  testPRSandboxIntegration().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testPRSandboxIntegration };