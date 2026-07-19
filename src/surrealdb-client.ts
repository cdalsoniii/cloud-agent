/**
 * SurrealDB Client using SurrealORM for proper connection management
 */

import SurrealORM from 'surrealdb-orm';
import dotenv from 'dotenv';

dotenv.config();

// Configuration from environment
const SURREALDB_URL = process.env.SURREALDB_URL || 'http://localhost:8000';
const SURREALDB_USER = process.env.SURREALDB_USER || 'root';
const SURREALDB_PASS = process.env.SURREALDB_PASS || 'root';
const SURREALDB_NS = process.env.SURREALDB_NS || 'main';
const SURREALDB_DB = process.env.SURREALDB_DB || 'main';

// Create SurrealDB client instance
export const surreal = new SurrealORM.SurrealORM();

/**
 * Initialize SurrealDB connection
 */
export async function initSurrealDB(): Promise<void> {
  try {
    console.log('🔌 Connecting to SurrealDB...');
    
    await surreal.connect(`${SURREALDB_URL}/rpc`, {
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
 * Define OpenCode Sessions table using SurrealORM schema
 */
export async function defineOpenCodeSessionsSchema(): Promise<void> {
  try {
    console.log('📋 Defining OpenCode sessions schema...');
    
    // Use surqlize to generate the schema from our .surql file
    const { generateSchema } = await import('surqlize');
    
    // Generate schema from our surql file
    const schema = await generateSchema('./schemas/opencode-sessions.surql');
    
    // Execute the schema creation
    for (const command of schema.commands) {
      await surrealQuery(command);
    }
    
    console.log('✅ OpenCode sessions schema defined successfully');
    
  } catch (error) {
    console.error('❌ Failed to define schema:', error);
    throw error;
  }
}

// Auto-initialize when imported
if (import.meta.url === `file://${process.argv[1]}`) {
  initSurrealDB().catch(console.error);
}