// Temporal Activities for Ontology Management
// Concrete implementations for SurrealDB operations

export async function ensureSurrealDBAwake(
  namespace: string = 'main',
  database: string = 'main'
): Promise<void> {
  const surrealUrl = process.env.SURREALDB_URL || 'http://localhost:8000';
  const surrealUser = process.env.SURREALDB_USER || 'root';
  const surrealPass = process.env.SURREALDB_PASS || 'root';
  
  const maxRetries = 3;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await fetch(`${surrealUrl}/health`, {
        method: 'GET',
        headers: {
          'surreal-ns': namespace,
          'surreal-db': database,
          'Authorization': 'Basic ' + Buffer.from(`${surrealUser}:${surrealPass}`).toString('base64')
        }
      });
      
      if (response.ok) {
        console.log(`SurrealDB health check passed for ${namespace}/${database}`);
        return;
      }
      
      throw new Error(`Health check failed: ${response.status}`);
      
    } catch (error) {
      if (attempt === maxRetries) {
        throw new Error(`SurrealDB wake-up failed after ${maxRetries} attempts: ${error.message}`);
      }
      
      // Wait before retrying
      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

export async function executeOntologyQuery(
  query: string,
  namespace: string = 'main',
  database: string = 'main'
): Promise<any[]> {
  const surrealUrl = process.env.SURREALDB_URL || 'http://localhost:8000';
  const surrealUser = process.env.SURREALDB_USER || 'root';
  const surrealPass = process.env.SURREALDB_PASS || 'root';
  
  const response = await fetch(`${surrealUrl}/sql`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'text/plain',
      'surreal-ns': namespace,
      'surreal-db': database,
      'Authorization': 'Basic ' + Buffer.from(`${surrealUser}:${surrealPass}`).toString('base64')
    },
    body: query
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`SurrealDB query failed: ${response.status} - ${errorText}`);
  }
  
  return await response.json();
}

export async function applyOntologyRules(
  update: any,
  namespace: string = 'main',
  database: string = 'main'
): Promise<any[]> {
  const results: any[] = [];
  
  // Get all enabled rules for this namespace/database
  const rulesQuery = `SELECT * FROM ontology_rule 
                     WHERE namespace = "${namespace}" 
                     AND database = "${database}" 
                     AND enabled = true
                     ORDER BY priority DESC`;
  
  const rules = await executeOntologyQuery(rulesQuery, namespace, database);
  
  // Apply each rule that matches the update
  for (const rule of rules) {
    try {
      // Check if rule applies to this update type
      const appliesTo = rule.applies_to || [];
      const updateType = update.type?.split('_')[0]; // node, edge, rule
      
      if (appliesTo.length === 0 || appliesTo.includes(updateType)) {
        // Execute rule condition
        const conditionResult = await executeOntologyQuery(
          rule.rule_condition, 
          namespace, 
          database
        );
        
        if (conditionResult && conditionResult.length > 0) {
          // Condition met, execute action
          const actionResult = await executeOntologyQuery(
            rule.rule_action, 
            namespace, 
            database
          );
          
          results.push({
            rule_id: rule.rule_id,
            rule_type: rule.rule_type,
            condition_result: conditionResult,
            action_result: actionResult,
            applied_at: new Date().toISOString()
          });
          
          // Log rule application
          await logRuleApplication(rule, update, conditionResult, actionResult, namespace, database);
        }
      }
    } catch (error) {
      console.error(`Error applying rule ${rule.rule_id}:`, error);
      
      results.push({
        rule_id: rule.rule_id,
        error: error.message,
        failed_at: new Date().toISOString()
      });
    }
  }
  
  return results;
}

async function logRuleApplication(
  rule: any,
  update: any,
  conditionResult: any[],
  actionResult: any[],
  namespace: string,
  database: string
): Promise<void> {
  const eventQuery = `CREATE ontology_event CONTENT ${JSON.stringify({
    event_id: `rule_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    event_type: 'rule_applied',
    target_id: rule.rule_id,
    target_type: 'rule',
    payload: {
      rule,
      update,
      condition_result: conditionResult,
      action_result: actionResult
    },
    namespace,
    database,
    created_at: new Date().toISOString()
  })}`;
  
  await executeOntologyQuery(eventQuery, namespace, database);
}

// Additional utility activities
export async function getOntologyStats(
  namespace: string = 'main',
  database: string = 'main'
): Promise<any> {
  await ensureSurrealDBAwake(namespace, database);
  
  const statsQueries = [
    'SELECT count() AS node_count FROM ontology_node',
    'SELECT count() AS edge_count FROM ontology_edge',
    'SELECT count() AS rule_count FROM ontology_rule WHERE enabled = true',
    'SELECT count() AS event_count FROM ontology_event',
    `SELECT count() AS sdlc_count FROM sdlc_event 
     WHERE ontology_nodes != NONE OR ontology_edges != NONE OR ontology_rules_applied != NONE`
  ];
  
  const results = await Promise.all(
    statsQueries.map(query => 
      executeOntologyQuery(query + ` WHERE namespace = "${namespace}" AND database = "${database}"`, namespace, database)
    )
  );
  
  return {
    namespace,
    database,
    timestamp: new Date().toISOString(),
    nodes: results[0][0]?.node_count || 0,
    edges: results[1][0]?.edge_count || 0,
    rules: results[2][0]?.rule_count || 0,
    events: results[3][0]?.event_count || 0,
    sdlc_integrations: results[4][0]?.sdlc_count || 0
  };
}

export async function exportOntology(
  format: 'json' | 'graphml' | 'cypher' = 'json',
  namespace: string = 'main',
  database: string = 'main'
): Promise<any> {
  await ensureSurrealDBAwake(namespace, database);
  
  const [nodes, edges] = await Promise.all([
    executeOntologyQuery(`SELECT * FROM ontology_node WHERE namespace = "${namespace}" AND database = "${database}"`, namespace, database),
    executeOntologyQuery(`SELECT * FROM ontology_edge WHERE namespace = "${namespace}" AND database = "${database}"`, namespace, database)
  ]);
  
  switch (format) {
    case 'json':
      return { nodes, edges };
    case 'graphml':
      return convertToGraphML(nodes, edges);
    case 'cypher':
      return convertToCypher(nodes, edges);
    default:
      return { nodes, edges };
  }
}

function convertToGraphML(nodes: any[], edges: any[]): string {
  // Basic GraphML conversion
  let graphml = `<?xml version="1.0" encoding="UTF-8"?>
<graphml xmlns="http://graphml.graphdrawing.org/xmlns">
  <key id="type" for="node" attr.name="type" attr.type="string"/>
  <key id="name" for="node" attr.name="name" attr.type="string"/>
  <key id="weight" for="edge" attr.name="weight" attr.type="double"/>
  <graph id="ontology" edgedefault="directed">
`;
  
  // Add nodes
  nodes.forEach(node => {
    graphml += `    <node id="${node.node_id}">
      <data key="type">${node.node_type}</data>
      <data key="name">${node.name}</data>
    </node>
`;
  });
  
  // Add edges
  edges.forEach(edge => {
    graphml += `    <edge source="${edge.source_id}" target="${edge.target_id}">
      <data key="weight">${edge.weight || 1.0}</data>
    </edge>
`;
  });
  
  graphml += `  </graph>
</graphml>`;
  
  return graphml;
}

function convertToCypher(nodes: any[], edges: any[]): string {
  let cypher = '';
  
  // Create nodes
  nodes.forEach(node => {
    cypher += `CREATE (:${node.node_type} {id: "${node.node_id}", name: "${node.name}"});
`;
  });
  
  // Create relationships
  edges.forEach(edge => {
    cypher += `MATCH (a {id: "${edge.source_id}"}), (b {id: "${edge.target_id}"})
CREATE (a)-[:${edge.relationship_type} {weight: ${edge.weight || 1.0}}]->(b);
`;
  });
  
  return cypher;
}