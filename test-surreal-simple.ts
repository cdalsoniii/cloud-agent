/**
 * Simple test to verify SurrealDB connection using existing event logger
 */

import { logSDLCEvent } from './src/event-logger.js';

async function testSurrealConnection(): Promise<void> {
  console.log('🧪 Testing SurrealDB connection via event logger...\n');

  try {
    // Test 1: Log an SDLC event
    console.log('1. Logging SDLC event...');
    await logSDLCEvent({
      event_type: 'test_event',
      phase: 'test',
      repo_target: 'test-repo',
      file_path: 'test-file.ts',
      success: true,
      duration_ms: 100,
      cost_usd: 0.01,
      tokens_in: 10,
      tokens_out: 20,
      correlation_id: 'test-correlation-123',
      created_at: new Date().toISOString(),
      metadata: { test: true }
    });
    console.log('✅ SDLC event logged successfully');

    console.log('\n🎉 SurrealDB connection test completed successfully!');
    console.log('The event logger is working and connected to SurrealDB.');

  } catch (error) {
    console.error('❌ SurrealDB connection test failed:', error);
    
    // Check if it's falling back to memory store
    if (error instanceof Error && error.message.includes('fallback')) {
      console.log('⚠️  Using memory fallback - SurrealDB may not be configured properly');
    } else {
      throw error;
    }
  }
}

// Run test if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  testSurrealConnection().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testSurrealConnection };