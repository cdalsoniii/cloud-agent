/**
 * Test script to verify OpenCode sessions in SurrealDB
 */

import { surrealQuery } from './src/event-logger.js';

async function testOpenCodeSessions(): Promise<void> {
  console.log('🧪 Testing OpenCode sessions in SurrealDB...\n');

  try {
    // Test 1: Count all OpenCode sessions
    console.log('1. Counting OpenCode sessions...');
    const countResult = await surrealQuery('SELECT count() FROM opencode_sessions GROUP ALL');
    console.log('✅ Count query executed successfully');
    console.log('Count result:', JSON.stringify(countResult, null, 2));

    // Test 2: Get session completion statistics
    console.log('\n2. Getting completion statistics...');
    const statsResult = await surrealQuery(`
      SELECT 
        count() as total,
        count() FILTER WHERE status = 'completed' as completed,
        count() FILTER WHERE status = 'failed' as failed,
        count() FILTER WHERE status = 'in_progress' as in_progress
      FROM opencode_sessions 
      GROUP ALL
    `);
    console.log('✅ Stats query executed successfully');
    console.log('Stats result:', JSON.stringify(statsResult, null, 2));

    // Test 3: Get a few sample sessions
    console.log('\n3. Getting sample sessions...');
    const sampleResult = await surrealQuery('SELECT id, title, status, pass FROM opencode_sessions LIMIT 5');
    console.log('✅ Sample query executed successfully');
    console.log('Sample sessions:', JSON.stringify(sampleResult, null, 2));

    console.log('\n🎉 OpenCode sessions test completed successfully!');

  } catch (error) {
    console.error('❌ OpenCode sessions test failed:', error);
    
    // Check if table exists
    const tableCheck = await surrealQuery('INFO FOR TABLE opencode_sessions');
    console.log('Table info:', JSON.stringify(tableCheck, null, 2));
  }
}

// Run test if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  testOpenCodeSessions().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { testOpenCodeSessions };