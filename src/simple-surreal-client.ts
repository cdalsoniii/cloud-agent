/**
 * Simple SurrealDB Client using direct HTTP API
 * Reliable implementation for schema deployment and data loading
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
 * Initialize SurrealDB connection (tests connectivity)
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

/**
 * Execute query and return results (extracting the result field from response)
 */
export async function surrealQueryResults(sql: string): Promise<any[]> {
  const response = await surrealQuery(sql);
  
  // Handle different response formats
  if (Array.isArray(response)) {
    // Standard response: [{result: [...], status: "OK", time: "..."}]
    const results = response
      .filter((item: any) => item.status === 'OK' && item.result !== undefined)
      .flatMap((item: any) => {
        if (Array.isArray(item.result)) {
          return item.result;
        }
        return item.result ? [item.result] : [];
      });
    return results;
  }
  
  return response ? [response] : [];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const surreal: any = {
  query: surrealQuery,
  connect: initSurrealDB,
  close: closeSurrealDB,
};

/**
 * Deploy OpenCode sessions schema
 */
export async function deploySchema(): Promise<void> {
  try {
    console.log('Deploying OpenCode sessions schema...');

    // Read schema from file
    const fs = await import('fs/promises');
    const schemaContent = await fs.readFile('./schemas/opencode-sessions.surql', 'utf-8');

    // Split into individual commands
    const commands = schemaContent
      .split(';')
      .map(cmd => cmd.trim())
      .filter(cmd => cmd.length > 0);

    // Execute each command
    for (const command of commands) {
      if (command) {
        console.log(`Executing: ${command.substring(0, 50)}...`);
        await surrealQuery(command);
      }
    }

    console.log('Schema deployed successfully');

  } catch (error) {
    console.error('Failed to deploy schema:', error);
    throw error;
  }
}

/**
 * Verify schema exists
 */
export async function verifySchema(): Promise<void> {
  try {
    console.log('Verifying schema...');

    const result = await surrealQuery('INFO FOR TABLE opencode_sessions');
    console.log('Table info:', JSON.stringify(result, null, 2));

    console.log('Schema verification completed');

  } catch (error) {
    console.error('Schema verification failed:', error);
    throw error;
  }
}

// Auto-initialize when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  initSurrealDB()
    .then(() => deploySchema())
    .then(() => verifySchema())
    .catch(console.error);
}
