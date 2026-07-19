/**
 * Debug test 2 - try different request formats
 */

import dotenv from 'dotenv';

dotenv.config();

// Configuration from environment
const SURREALDB_URL = process.env.SURREALDB_URL || 'http://localhost:8000';
const SURREALDB_USER = process.env.SURREALDB_USER || 'root';
const SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';

// Basic auth header
const SURREALDB_AUTH = Buffer.from(`${SURREALDB_USER}:${SURREALDB_PASS}`).toString('base64');

async function debugTest2() {
  try {
    console.log('🔍 Testing different request formats...');
    
    // Test 1: Raw SQL string as body
    console.log('\n1. Testing raw SQL string...');
    const response1 = await fetch(`${SURREALDB_URL}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain',
        'Authorization': `Basic ${SURREALDB_AUTH}`,
        'Accept': 'application/json',
      },
      body: "USE NS main DB main; SELECT * FROM opencode_sessions",
    });

    console.log('Response status:', response1.status);
    const result1 = await response1.text();
    console.log('Raw response:', result1);
    
    // Test 2: JSON array of queries
    console.log('\n2. Testing JSON array of queries...');
    const response2 = await fetch(`${SURREALDB_URL}/sql`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Basic ${SURREALDB_AUTH}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(["USE NS main DB main", "SELECT * FROM opencode_sessions"]),
    });

    console.log('Response status:', response2.status);
    const result2 = await response2.text();
    console.log('Raw response:', result2);
    
  } catch (error) {
    console.error('❌ Debug test failed:', error);
  }
}

// Run the test
debugTest2();