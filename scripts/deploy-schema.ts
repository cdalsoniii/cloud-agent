/**
 * Schema deployment script for SurrealDB
 * Deploys the OpenCode sessions schema to local SurrealDB instance
 */

import dotenv from 'dotenv';
import { surrealQuery } from '../src/event-logger.js';

dotenv.config();

const schemaCommands = [
  'DEFINE TABLE opencode_sessions SCHEMAFULL',
  'DEFINE FIELD id ON opencode_sessions TYPE string ASSERT $value != NONE',
  'DEFINE FIELD title ON opencode_sessions TYPE string',
  'DEFINE FIELD status ON opencode_sessions TYPE string ASSERT $value INSIDE ["completed", "failed", "in_progress"]',
  'DEFINE FIELD pass ON opencode_sessions TYPE bool',
  'DEFINE FIELD reasons ON opencode_sessions TYPE array',
  'DEFINE FIELD cost ON opencode_sessions TYPE decimal',
  'DEFINE FIELD tokens ON opencode_sessions TYPE object',
  'DEFINE FIELD tokens.input ON opencode_sessions TYPE int',
  'DEFINE FIELD tokens.output ON opencode_sessions TYPE int',
  'DEFINE FIELD tokens.cache_read ON opencode_sessions TYPE int',
  'DEFINE FIELD tokens.cache_write ON opencode_sessions TYPE int',
  'DEFINE FIELD duration ON opencode_sessions TYPE duration',
  'DEFINE FIELD created ON opencode_sessions TYPE datetime',
  'DEFINE FIELD updated ON opencode_sessions TYPE datetime',
  'DEFINE FIELD project_id ON opencode_sessions TYPE string',
  'DEFINE FIELD directory ON opencode_sessions TYPE string',
  'DEFINE FIELD agent ON opencode_sessions TYPE string',
  'DEFINE FIELD model ON opencode_sessions TYPE string',
  'DEFINE FIELD summary ON opencode_sessions TYPE object',
  'DEFINE FIELD summary.additions ON opencode_sessions TYPE int',
  'DEFINE FIELD summary.deletions ON opencode_sessions TYPE int',
  'DEFINE FIELD summary.files ON opencode_sessions TYPE array',
  'DEFINE INDEX idx_session_id ON opencode_sessions COLUMNS id UNIQUE',
  'DEFINE INDEX idx_session_date ON opencode_sessions COLUMNS created',
  'DEFINE INDEX idx_session_status ON opencode_sessions COLUMNS status',
  'DEFINE INDEX idx_session_pass ON opencode_sessions COLUMNS pass'
];

async function deploySchema() {
  console.log('🚀 Deploying OpenCode sessions schema to SurrealDB...\n');
  
  try {
    for (const command of schemaCommands) {
      console.log(`📝 Executing: ${command}`);
      const result = await surrealQuery(command);
      
      if (result[0]?.status === 'OK') {
        console.log('✅ Success');
      } else {
        console.log('❌ Failed:', JSON.stringify(result, null, 2));
      }
      
      // Small delay between commands
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    console.log('\n🎉 Schema deployment completed!');
    
    // Verify the schema was created
    console.log('\n🔍 Verifying schema...');
    const verifyResult = await surrealQuery('INFO FOR TABLE opencode_sessions');
    console.log('Schema info:', JSON.stringify(verifyResult, null, 2));
    
  } catch (error) {
    console.error('❌ Schema deployment failed:', error);
  }
}

// Run if this is the main module
if (import.meta.url === `file://${process.argv[1]}`) {
  deploySchema().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { deploySchema };