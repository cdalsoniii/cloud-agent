/**
 * Test script to verify SurrealDB connection
 */

import { surrealQuery } from './src/event-logger.js';

async function testSurrealConnection(): Promise<void> {
  console.log('🧪 Testing SurrealDB connection...\n');

  try {
    // Test 1: Simple query
    console.log('1. Testing simple query...');
    const result = await surrealQuery('SELECT * FROM coding_session LIMIT 1');
    console.log('✅ Query executed successfully');
    console.log('Result:', JSON.stringify(result, null, 2));

    // Test 2: Create a test session
    console.log('\n2. Testing session creation...');
    const createResult = await surrealQuery(`
      CREATE coding_session CONTENT {
        sessionId: 'test-session-123',
        type: 'test',
        title: 'Test Session',
        description: 'Test session for connection verification',
        status: 'active',
        startTime: '2026-07-18T03:00:00Z',
        metadata: { test: true }
      }
    `);
    console.log('✅ Session created successfully');
    console.log('Create result:', JSON.stringify(createResult, null, 2));

    // Test 3: Query the test session
    console.log('\n3. Testing session retrieval...');
    const queryResult = await surrealQuery("SELECT * FROM coding_session WHERE sessionId = 'test-session-123'");
    console.log('✅ Session retrieved successfully');
    console.log('Query result:', JSON.stringify(queryResult, null, 2));

    console.log('\n🎉 SurrealDB connection test completed successfully!');

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