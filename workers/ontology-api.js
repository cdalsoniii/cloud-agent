// Cloudflare Worker for Ontology API
// Handles ChartDB-style relationship management with namespace/database awareness

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;
    
    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Namespace, X-Database',
      'Content-Type': 'application/json'
    };

    // Handle preflight
    if (method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    // Authentication
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401,
        headers: corsHeaders 
      });
    }

    // Extract namespace and database from headers
    const namespace = request.headers.get('X-Namespace') || 'main';
    const database = request.headers.get('X-Database') || 'main';

    try {
      // Route handling
      if (path.startsWith('/api/ontology/nodes')) {
        return handleNodes(request, env, namespace, database);
      } else if (path.startsWith('/api/ontology/edges')) {
        return handleEdges(request, env, namespace, database);
      } else if (path.startsWith('/api/ontology/rules')) {
        return handleRules(request, env, namespace, database);
      } else if (path.startsWith('/api/ontology/query')) {
        return handleQuery(request, env, namespace, database);
      } else if (path.startsWith('/api/ontology/events')) {
        return handleEvents(request, env, namespace, database);
      }

      return new Response(JSON.stringify({ error: 'Not found' }), { 
        status: 404,
        headers: corsHeaders 
      });

    } catch (error) {
      console.error('Ontology API error:', error);
      return new Response(JSON.stringify({ 
        error: 'Internal server error', 
        details: error.message 
      }), { 
        status: 500,
        headers: corsHeaders 
      });
    }
  }
}

async function handleNodes(request, env, namespace, database) {
  const method = request.method;
  
  if (method === 'GET') {
    const url = new URL(request.url);
    const nodeId = url.searchParams.get('id');
    const nodeType = url.searchParams.get('type');
    
    let query = 'SELECT * FROM ontology_node';
    if (nodeId) query += ` WHERE node_id = "${nodeId}"`;
    if (nodeType) query += ` ${nodeId ? 'AND' : 'WHERE'} node_type = "${nodeType}"`;
    query += ` AND namespace = "${namespace}" AND database = "${database}"`;
    
    const result = await executeSurrealQuery(query, env);
    return new Response(JSON.stringify(result), { headers: corsHeaders });
  }
  
  if (method === 'POST') {
    const body = await request.json();
    
    // Queue via QStash for async processing
    const qstashResponse = await fetch(`${env.QSTASH_URL}/v2/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': '0s'
      },
      body: JSON.stringify({
        topic: 'ontology-update',
        type: 'node-create',
        data: { ...body, namespace, database },
        timestamp: new Date().toISOString()
      })
    });
    
    if (!qstashResponse.ok) {
      throw new Error('QStash publish failed');
    }
    
    return new Response(JSON.stringify({ 
      status: 'queued', 
      message: 'Node creation queued for async processing' 
    }), { 
      status: 202,
      headers: corsHeaders 
    });
  }
  
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
    status: 405,
    headers: corsHeaders 
  });
}

async function handleEdges(request, env, namespace, database) {
  const method = request.method;
  
  if (method === 'GET') {
    const url = new URL(request.url);
    const sourceId = url.searchParams.get('source');
    const targetId = url.searchParams.get('target');
    const relType = url.searchParams.get('relationship');
    
    let query = 'SELECT * FROM ontology_edge';
    const conditions = [];
    if (sourceId) conditions.push(`source_id = "${sourceId}"`);
    if (targetId) conditions.push(`target_id = "${targetId}"`);
    if (relType) conditions.push(`relationship_type = "${relType}"`);
    
    if (conditions.length > 0) {
      query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` AND namespace = "${namespace}" AND database = "${database}"`;
    
    const result = await executeSurrealQuery(query, env);
    return new Response(JSON.stringify(result), { headers: corsHeaders });
  }
  
  if (method === 'POST') {
    const body = await request.json();
    
    // Queue via QStash
    const qstashResponse = await fetch(`${env.QSTASH_URL}/v2/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': '0s'
      },
      body: JSON.stringify({
        topic: 'ontology-update',
        type: 'edge-create',
        data: { ...body, namespace, database },
        timestamp: new Date().toISOString()
      })
    });
    
    return new Response(JSON.stringify({ 
      status: 'queued', 
      message: 'Edge creation queued for async processing' 
    }), { 
      status: 202,
      headers: corsHeaders 
    });
  }
  
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
    status: 405,
    headers: corsHeaders 
  });
}

async function handleRules(request, env, namespace, database) {
  const method = request.method;
  
  if (method === 'GET') {
    const query = `SELECT * FROM ontology_rule WHERE namespace = "${namespace}" AND database = "${database}" AND enabled = true`;
    const result = await executeSurrealQuery(query, env);
    return new Response(JSON.stringify(result), { headers: corsHeaders });
  }
  
  if (method === 'POST') {
    const body = await request.json();
    
    // Queue via QStash
    const qstashResponse = await fetch(`${env.QSTASH_URL}/v2/publish`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.QSTASH_TOKEN}`,
        'Content-Type': 'application/json',
        'Upstash-Delay': '0s'
      },
      body: JSON.stringify({
        topic: 'ontology-update',
        type: 'rule-create',
        data: { ...body, namespace, database },
        timestamp: new Date().toISOString()
      })
    });
    
    return new Response(JSON.stringify({ 
      status: 'queued', 
      message: 'Rule creation queued for async processing' 
    }), { 
      status: 202,
      headers: corsHeaders 
    });
  }
  
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
    status: 405,
    headers: corsHeaders 
  });
}

async function handleQuery(request, env, namespace, database) {
  if (request.method === 'POST') {
    const { query } = await request.json();
    
    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Invalid query' }), { 
        status: 400,
        headers: corsHeaders 
      });
    }
    
    // Execute query directly with namespace/database context
    const result = await executeSurrealQuery(query, env, namespace, database);
    return new Response(JSON.stringify(result), { headers: corsHeaders });
  }
  
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
    status: 405,
    headers: corsHeaders 
  });
}

async function handleEvents(request, env, namespace, database) {
  if (request.method === 'GET') {
    const url = new URL(request.url);
    const limit = url.searchParams.get('limit') || '100';
    const eventType = url.searchParams.get('type');
    
    let query = `SELECT * FROM ontology_event WHERE namespace = "${namespace}" AND database = "${database}"`;
    if (eventType) query += ` AND event_type = "${eventType}"`;
    query += ` ORDER BY created_at DESC LIMIT ${limit}`;
    
    const result = await executeSurrealQuery(query, env);
    return new Response(JSON.stringify(result), { headers: corsHeaders });
  }
  
  return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
    status: 405,
    headers: corsHeaders 
  });
}

async function executeSurrealQuery(query, env, namespace = 'main', database = 'main') {
  const surrealUrl = env.SURREALDB_URL || 'http://localhost:8000';
  const surrealUser = env.SURREALDB_USER || 'root';
  const surrealPass = env.SURREALDB_PASS || 'root';
  
  const response = await fetch(`${surrealUrl}/sql`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'text/plain',
      'surreal-ns': namespace,
      'surreal-db': database,
      'Authorization': 'Basic ' + btoa(`${surrealUser}:${surrealPass}`)
    },
    body: query
  });
  
  if (!response.ok) {
    throw new Error(`SurrealDB query failed: ${response.status} ${await response.text()}`);
  }
  
  return await response.json();
}

// CORS headers constant
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Namespace, X-Database',
  'Content-Type': 'application/json'
};