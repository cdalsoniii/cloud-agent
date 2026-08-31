// Temporal Workflows for Ontology Management
// Handles SurrealDB wake-up and async processing with namespace/database awareness

import { proxyActivities } from '@temporalio/workflow';
import * as activities from './ontology-activities';

const { ensureSurrealDBAwake, executeOntologyQuery, applyOntologyRules } = proxyActivities({
  startToCloseTimeout: '2 minutes',
  retry: { maximumAttempts: 3 }
});

export interface OntologyUpdate {
  type: 'node-create' | 'node-update' | 'node-delete' | 
        'edge-create' | 'edge-update' | 'edge-delete' |
        'rule-create' | 'rule-update' | 'rule-delete';
  data: any;
  namespace: string;
  database: string;
  query?: string;
  timestamp: string;
}

export interface ProcessResult {
  success: boolean;
  result?: any;
  ruleResults?: any[];
  error?: string;
}

/**
 * Main workflow for processing ontology updates
 * Ensures SurrealDB is awake and processes updates with proper namespace/database context
 */
export async function processOntologyUpdate(update: OntologyUpdate): Promise<ProcessResult> {
  try {
    // Ensure SurrealDB is responsive
    await ensureSurrealDBAwake(update.namespace, update.database);
    
    let result: any;
    
    // Execute the appropriate query based on update type
    if (update.query) {
      // Use provided query
      result = await executeOntologyQuery(update.query, update.namespace, update.database);
    } else {
      // Generate query from update type
      const query = generateQueryFromUpdate(update);
      result = await executeOntologyQuery(query, update.namespace, update.database);
    }
    
    // Apply any triggered ontology rules
    const ruleResults = await applyOntologyRules(update, update.namespace, update.database);
    
    // Log the successful processing
    await logOntologyEvent({
      event_type: `${update.type}_processed`,
      target_id: update.data?.node_id || update.data?.edge_id || update.data?.rule_id,
      target_type: update.type.split('_')[0], // node, edge, or rule
      payload: { update, result },
      namespace: update.namespace,
      database: update.database
    });
    
    return { 
      success: true, 
      result, 
      ruleResults 
    };
    
  } catch (error) {
    // Log the error
    await logOntologyEvent({
      event_type: `${update.type}_failed`,
      target_id: update.data?.node_id || update.data?.edge_id || update.data?.rule_id,
      target_type: update.type.split('_')[0],
      payload: { 
        update, 
        error: error.message,
        stack: error.stack 
      },
      namespace: update.namespace,
      database: update.database
    });
    
    return { 
      success: false, 
      error: error.message 
    };
  }
}

/**
 * Workflow specifically for waking up SurrealDB
 * Retries with exponential backoff
 */
export async function wakeSurrealDBWorkflow(
  namespace: string = 'main', 
  database: string = 'main'
): Promise<void> {
  const maxRetries = 5;
  const baseDelay = 2000; // 2 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`Attempt ${attempt}: Waking SurrealDB for ${namespace}/${database}`);
      
      const response = await fetch(`${process.env.SURREALDB_URL}/health`, {
        method: 'GET',
        headers: {
          'surreal-ns': namespace,
          'surreal-db': database
        }
      });
      
      if (response.ok) {
        console.log(`SurrealDB awake for ${namespace}/${database}`);
        return;
      }
      
      throw new Error(`Health check failed: ${response.status}`);
      
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`SurrealDB wake-up failed after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Exponential backoff
      const delay = baseDelay * Math.pow(2, attempt - 1);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Workflow for batch processing multiple ontology updates
 */
export async function processOntologyBatch(
  updates: OntologyUpdate[],
  namespace: string = 'main',
  database: string = 'main'
): Promise<ProcessResult[]> {
  // Ensure SurrealDB is awake first
  await wakeSurrealDBWorkflow(namespace, database);
  
  const results: ProcessResult[] = [];
  
  // Process updates sequentially to maintain order
  for (const update of updates) {
    try {
      const result = await processOntologyUpdate({
        ...update,
        namespace: update.namespace || namespace,
        database: update.database || database
      });
      results.push(result);
    } catch (error) {
      results.push({
        success: false,
        error: error.message
      });
    }
  }
  
  return results;
}

/**
 * Workflow for ontology consistency checks
 */
export async function runConsistencyCheck(
  namespace: string = 'main',
  database: string = 'main'
): Promise<ConsistencyReport> {
  await wakeSurrealDBWorkflow(namespace, database);
  
  const checks = [
    // Check for self-references
    `SELECT * FROM ontology_edge WHERE source_id = target_id AND namespace = "${namespace}" AND database = "${database}"`,
    
    // Check for invalid node references
    `SELECT e.* FROM ontology_edge e 
     LEFT JOIN ontology_node n ON e.source_id = n.node_id 
     WHERE n.node_id IS NULL AND e.namespace = "${namespace}" AND e.database = "${database}"`,
    
    // Check for circular dependencies
    `WITH RECURSIVE dependency_chain AS (
      SELECT source_id, target_id, ARRAY[source_id] AS path
      FROM ontology_edge 
      WHERE namespace = "${namespace}" AND database = "${database}"
      UNION ALL
      SELECT e.source_id, e.target_id, dc.path || e.source_id
      FROM ontology_edge e
      JOIN dependency_chain dc ON e.source_id = dc.target_id
      WHERE NOT e.source_id = ANY(dc.path)
    )
    SELECT * FROM dependency_chain WHERE source_id = target_id`
  ];
  
  const results = await Promise.all(
    checks.map(check => executeOntologyQuery(check, namespace, database))
  );
  
  return {
    timestamp: new Date().toISOString(),
    namespace,
    database,
    checks: results.map((result, index) => ({
      check_id: index + 1,
      violations: result.length,
      details: result
    })),
    total_violations: results.reduce((sum, result) => sum + result.length, 0)
  };
}

interface ConsistencyReport {
  timestamp: string;
  namespace: string;
  database: string;
  checks: Array<{
    check_id: number;
    violations: number;
    details: any[];
  }>;
  total_violations: number;
}

interface OntologyEvent {
  event_type: string;
  target_id?: string;
  target_type?: string;
  payload: any;
  namespace: string;
  database: string;
}

// Helper functions
function generateQueryFromUpdate(update: OntologyUpdate): string {
  switch (update.type) {
    case 'node-create':
      return `CREATE ontology_node CONTENT ${JSON.stringify(update.data)}`;
    case 'node-update':
      return `UPDATE ontology_node:${update.data.node_id} MERGE ${JSON.stringify(update.data)}`;
    case 'node-delete':
      return `DELETE FROM ontology_node WHERE node_id = "${update.data.node_id}"`;
    case 'edge-create':
      return `CREATE ontology_edge CONTENT ${JSON.stringify(update.data)}`;
    case 'edge-update':
      return `UPDATE ontology_edge:${update.data.edge_id} MERGE ${JSON.stringify(update.data)}`;
    case 'edge-delete':
      return `DELETE FROM ontology_edge WHERE edge_id = "${update.data.edge_id}"`;
    case 'rule-create':
      return `CREATE ontology_rule CONTENT ${JSON.stringify(update.data)}`;
    case 'rule-update':
      return `UPDATE ontology_rule:${update.data.rule_id} MERGE ${JSON.stringify(update.data)}`;
    case 'rule-delete':
      return `DELETE FROM ontology_rule WHERE rule_id = "${update.data.rule_id}"`;
    default:
      throw new Error(`Unknown update type: ${update.type}`);
  }
}

async function logOntologyEvent(event: OntologyEvent): Promise<void> {
  const query = `CREATE ontology_event CONTENT ${JSON.stringify({
    ...event,
    event_id: `event_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    created_at: new Date().toISOString()
  })}`;
  
  await executeOntologyQuery(query, event.namespace, event.database);
}