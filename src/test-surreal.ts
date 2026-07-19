/**
 * Test script for SurrealDB data operations
 */

import { surrealQuery } from './http-surreal-client.js';

async function testSurrealDB() {
  try {
    console.log('🧪 Testing SurrealDB data operations...');
    
    // Test 1: Query all records
    console.log('\n1. Querying all records...');
    const queryResult = await surrealQuery('SELECT * FROM opencode_sessions');
    console.log('Query result:', JSON.stringify(queryResult, null, 2));
    
    // Test 2: Count records
    console.log('\n2. Counting records...');
    const countResult = await surrealQuery('SELECT count() FROM opencode_sessions GROUP ALL');
    console.log('Count result:', JSON.stringify(countResult, null, 2));
    
    console.log('✅ All tests completed successfully');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

// Run the test
testSurrealDB();