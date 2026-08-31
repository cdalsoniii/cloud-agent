/**
 * SurrealDB Client using direct HTTP API for reliable schema deployment and data loading
 */

import dotenv from 'dotenv';

dotenv.config();

// Configuration from environment
const SURREALDB_URL = process.env.SURREALDB_URL || 'http://localhost:8000';
const SURREALDB_USER = process.env.SURREALDB_USER || 'root';
const SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';
const SURREALDB_NS = process.env.SURREALDB_NS || 'main';
const SURREALDB_DB = process.env.SURREALDB_DB || 'main';

/**
 * Execute SurrealQL via HTTP REST API
 */
export async function surrealQuery(sql: string): Promise<any[]> {
  const url = new URL('/sql', SURREALDB_URL);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'text/plain',
      'surreal-ns': SURREALDB_NS,
      'surreal-db': SURREALDB_DB,
      'Authorization': 'Basic ' + Buffer.from(`${SURREALDB_USER}:${SURREALDB_PASS}`).toString('base64'),
    },
    body: sql,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`HTTP ${response.status}: ${text}`);
  }

  return (await response.json()) as any[];
}

/**
 * Initialize SurrealDB connection (no-op for HTTP API, just tests connectivity)
 */
export async function initSurrealDB(): Promise<void> {
  try {
    console.log('Connecting to SurrealDB...');
    const result = await surrealQuery('INFO FOR DB');
    console.log('Database info:', JSON.stringify(result, null, 2));
    console.log('Connected to SurrealDB successfully');
  } catch (error) {
    console.error('Failed to connect to SurrealDB:', error);
    throw error;
  }
}

/**
 * Close SurrealDB connection (no-op for HTTP API)
 */
export async function closeSurrealDB(): Promise<void> {
  console.log('SurrealDB connection closed (HTTP stateless)');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const surreal: any = {
  query: surrealQuery,
  connect: initSurrealDB,
  close: closeSurrealDB,
};

// Auto-initialize when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  initSurrealDB().catch(console.error);
}
