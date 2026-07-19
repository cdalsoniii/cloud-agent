/**
 * Debug test to see raw HTTP responses
 */

import dotenv from 'dotenv';

dotenv.config();

// Configuration from environment
const SURREALDB_URL = process.env.SURREALDB_URL || 'http://localhost:8000';
const SURREALDB_USER = process.env.SURREALDB_USER || 'root';
const SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';

// Basic auth header
const SURREALDB_AUTH = Buffer.from(`${SURREALDB_USER}:${SURREALDB_PASS}`).toString('base64');

async function debugTest() {
  try {
    console.log('🔍 Debugging SurrealDB HTTP responses...');
    
    // Test 1: Simple query
    console.log('\n1. Testing simple query...');
    const response = await fetch(`${SURREALDB_URL}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${SURREALDB_AUTH}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify("USE NS main DB main; SELECT * FROM opencode_sessions"),
    });

    console.log('Response status:', response.status);
    console.log('Response headers:', Object.fromEntries(response.headers.entries()));
    
    const result = await response.text();
    console.log('Raw response:', result);
    
    const parsedResult = JSON.parse(result);
    console.log('Parsed result:', JSON.stringify(parsedResult, null, 2));
    
  } catch (error) {
    console.error('❌ Debug test failed:', error);
  }
}

// Run the test
debugTest();