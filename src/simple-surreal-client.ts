/**
 * Simple SurrealDB Client using surrealdb.js
 * Reliable implementation for schema deployment and data loading
 */

import { Surreal } from 'surrealdb.js';
import dotenv from 'dotenv';

dotenv.config();

// Configuration from environment
const SURREALDB_URL = process.env.SURREALDB_URL || 'http://localhost:8000';
const SURREALDB_USER = process.env.SURREALDB_USER || 'root';
const SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';
const SURREALDB_NS = process.env.SURREALDB_NS || 'cloud-agent';
const SURREALDB_DB = process.env.SURREALDB_DB || 'rules';

// Create SurrealDB client instance
export const surreal = new Surreal();

/**
 * Initialize SurrealDB connection
 */
export async function initSurrealDB(): Promise<void> {
  try {
    console.log('🔌 Connecting to SurrealDB...');
    
    await surreal.connect(SURREALDB_URL, {
      namespace: SURREALDB_NS,
      database: SURREALDB_DB,
      auth: {
        username: SURREALDB_USER,
        password: SURREALDB_PASS,
      },
    });
    
    console.log('✅ Connected to SurrealDB successfully');
    
    // Test the connection
    const result = await surreal.query('INFO FOR DB');
    console.log('Database info:', JSON.stringify(result, null, 2));
    
  } catch (error) {
    console.error('❌ Failed to connect to SurrealDB:', error);
    throw error;
  }
}

/**
 * Close SurrealDB connection
 */
export async function closeSurrealDB(): Promise<void> {
  try {
    await surreal.close();
    console.log('✅ SurrealDB connection closed');
  } catch (error) {
    console.error('❌ Failed to close SurrealDB connection:', error);
  }
}

/**
 * Execute SurrealQL query
 */
export async function surrealQuery(sql: string): Promise<any> {
  try {
    const result = await surreal.query(sql);
    return result;
  } catch (error) {
    console.error('❌ SurrealDB query failed:', error);
    throw error;
  }
}

/**
 * Deploy OpenCode sessions schema
 */
export async function deploySchema(): Promise<void> {
  try {
    console.log('📋 Deploying OpenCode sessions schema...');
    
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
        console.log(`📝 Executing: ${command.substring(0, 50)}...`);
        await surrealQuery(command);
      }
    }
    
    console.log('✅ Schema deployed successfully');
    
  } catch (error) {
    console.error('❌ Failed to deploy schema:', error);
    throw error;
  }
}

/**
 * Verify schema exists
 */
export async function verifySchema(): Promise<void> {
  try {
    console.log('🔍 Verifying schema...');
    
    const result = await surrealQuery('INFO FOR TABLE opencode_sessions');
    console.log('Table info:', JSON.stringify(result, null, 2));
    
    console.log('✅ Schema verification completed');
    
  } catch (error) {
    console.error('❌ Schema verification failed:', error);
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