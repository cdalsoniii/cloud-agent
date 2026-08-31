// QStash Handlers for Async Ontology Processing
// Routes messages to Temporal workflows with proper namespace/database context

import { Client } from '@temporalio/client';

export async function handleOntologyUpdate(event) {
  try {
    const { topic, type, data, namespace, database, timestamp } = JSON.parse(event.body);
    
    if (topic !== 'ontology-update') {
      return new Response(JSON.stringify({ error: 'Invalid topic' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Validate required fields
    if (!type || !data) {
      return new Response(JSON.stringify({ error: 'Missing type or data' }), { 
        status: 400,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    
    // Initialize Temporal client
    const temporalClient = new Client({
      connection: {
        address: process.env.TEMPORAL_SERVER_URL || 'localhost:7233',
        tls: false
      }
    });
    
    // Determine workflow based on update type
    let workflowName;
    let workflowArgs;
    
    switch (type) {
      case 'node-create':
      case 'node-update':
      case 'node-delete':
      case 'edge-create':
      case 'edge-update':
      case 'edge-delete':
      case 'rule-create':
      case 'rule-update':
      case 'rule-delete':
        workflowName = 'processOntologyUpdate';
        workflowArgs = [{
          type,
          data,
          namespace: namespace || 'main',
          database: database || 'main',
          timestamp: timestamp || new Date().toISOString()
        }];
        break;
        
      case 'batch-update':
        workflowName = 'processOntologyBatch';
        workflowArgs = [
          data.updates || [],
          data.namespace || namespace || 'main',
          data.database || database || 'main'
        ];
        break;
        
      case 'consistency-check':
        workflowName = 'runConsistencyCheck';
        workflowArgs = [
          data.namespace || namespace || 'main',
          data.database || database || 'main'
        ];
        break;
        
      default:
        return new Response(JSON.stringify({ error: `Unknown update type: ${type}` }), { 
          status: 400,
          headers: { 'Content-Type': 'application/json' }
        });
    }
    
    // Start Temporal workflow
    const workflowId = `ontology-${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    const handle = await temporalClient.workflow.start(workflowName, {
      workflowId,
      args: workflowArgs,
      taskQueue: 'ontology-updates'
    });
    
    console.log(`Started workflow ${workflowName} with ID: ${workflowId}`);
    
    return new Response(JSON.stringify({
      status: 'processing',
      workflow_id: workflowId,
      workflow_name: workflowName,
      namespace: namespace || 'main',
      database: database || 'main',
      timestamp: new Date().toISOString()
    }), {
      status: 202,
      headers: { 'Content-Type': 'application/json' }
    });
    
  } catch (error) {
    console.error('QStash handler error:', error);
    
    return new Response(JSON.stringify({
      error: 'Internal server error',
      details: error.message,
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

// Health check endpoint
export async function handleHealthCheck() {
  return new Response(JSON.stringify({
    status: 'healthy',
    service: 'ontology-qstash-handler',
    timestamp: new Date().toISOString(),
    capabilities: [
      'node-create', 'node-update', 'node-delete',
      'edge-create', 'edge-update', 'edge-delete',
      'rule-create', 'rule-update', 'rule-delete',
      'batch-update', 'consistency-check'
    ]
  }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

// Main handler function
export default {
  async fetch(request) {
    const url = new URL(request.url);
    
    if (url.pathname === '/health') {
      return handleHealthCheck();
    }
    
    if (url.pathname === '/ontology-update' && request.method === 'POST') {
      return handleOntologyUpdate(request);
    }
    
    return new Response(JSON.stringify({ error: 'Not found' }), { 
      status: 404,
      headers: { 'Content-Type': 'application/json' }
    });
  }
};

// Utility function for batch processing
export async function processBatchUpdates(updates, namespace = 'main', database = 'main') {
  const temporalClient = new Client({
    connection: {
      address: process.env.TEMPORAL_SERVER_URL || 'localhost:7233',
      tls: false
    }
  });
  
  const workflowId = `ontology-batch-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  
  const handle = await temporalClient.workflow.start('processOntologyBatch', {
    workflowId,
    args: [updates, namespace, database],
    taskQueue: 'ontology-updates'
  });
  
  return {
    workflow_id: workflowId,
    namespace,
    database,
    update_count: updates.length
  };
}

// Webhook verification for QStash
export async function verifyWebhook(request) {
  const signature = request.headers.get('upstash-signature');
  const body = await request.text();
  
  // Verify signature using QStash signing key
  const expectedSignature = createSignature(
    body,
    process.env.QSTASH_CURRENT_SIGNING_KEY
  );
  
  if (signature !== expectedSignature) {
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { 
      status: 401,
      headers: { 'Content-Type': 'application/json' }
    });
  }
  
  return null; // Signature is valid
}

function createSignature(body, signingKey) {
  // Implementation depends on QStash signature algorithm
  // This is a placeholder - use the actual QStash SDK for signature verification
  const crypto = require('crypto');
  return crypto
    .createHmac('sha256', signingKey)
    .update(body)
    .digest('hex');
}

// Retry handler for failed messages
export async function handleRetry(event) {
  const { original_message, retry_count = 0 } = JSON.parse(event.body);
  
  if (retry_count >= 3) {
    // Too many retries, move to dead letter queue
    await moveToDeadLetterQueue(original_message);
    return new Response(JSON.stringify({ status: 'dead_lettered' }), { status: 200 });
  }
  
  // Retry the original message
  return handleOntologyUpdate({
    ...event,
    body: JSON.stringify(original_message)
  });
}

async function moveToDeadLetterQueue(message) {
  // Implement dead letter queue logic
  console.error('Message moved to dead letter queue:', message);
  
  // Could store in SurrealDB or another persistent store
  const query = `CREATE dead_letter_message CONTENT ${JSON.stringify({
    ...message,
    moved_at: new Date().toISOString(),
    retry_count: message.retry_count || 0
  })}`;
  
  // Execute against SurrealDB
  const surrealUrl = process.env.SURREALDB_URL || 'http://localhost:8000';
  const response = await fetch(`${surrealUrl}/sql`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'Authorization': 'Basic ' + Buffer.from(
        `${process.env.SURREALDB_USER || 'root'}:${process.env.SURREALDB_PASS || 'root'}`
      ).toString('base64')
    },
    body: query
  });
  
  if (!response.ok) {
    console.error('Failed to store dead letter message:', await response.text());
  }
}