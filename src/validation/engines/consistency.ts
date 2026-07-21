import { ValidationResult, ValidationReport, ValidationContext, GraphConsistencyRules, Validator } from '../types.js';
import { OntologyNodeSchema, OntologyEdgeSchema } from '../schemas.js';
import { surrealQueryResults } from '../../simple-surreal-client.js';

/**
 * Graph Consistency Validator
 * Checks for graph consistency issues: self-references, orphan nodes, orphan edges, circular references, invalid relationship types
 */
export class GraphConsistencyValidator implements Validator {
  private rules: GraphConsistencyRules = {
    no_self_references: true,
    no_orphan_nodes: true,
    no_orphan_edges: true,
    valid_relationship_types: [
      'uses_model', 'targets_repo', 'belongs_to_phase', 'follows_event',
      'depends_on', 'references', 'created_by', 'owns', 'part_of', 'custom'
    ],
    max_path_length: 10,
    require_bidirectional: false,
    allowed_node_types: [
      'sdlc_event_type', 'ai_model', 'repository', 'sdlc_phase',
      'user', 'team', 'project', 'artifact', 'custom'
    ]
  };

  constructor(rules?: Partial<GraphConsistencyRules>) {
    if (rules) {
      this.rules = { ...this.rules, ...rules };
    }
  }

  async validate(namespace: string = 'main', database: string = 'main'): Promise<ValidationReport> {
    const startTime = Date.now();
    const checks: ValidationResult[] = [];
    const context: ValidationContext = {
      namespace,
      database,
      surrealClient: { query: surrealQueryResults }
    };

    // Check 1: Self-references
    checks.push(await this.checkSelfReferences(context));
    
    // Check 2: Orphan nodes
    checks.push(await this.checkOrphanNodes(context));
    
    // Check 3: Orphan edges
    checks.push(await this.checkOrphanEdges(context));
    
    // Check 4: Circular references
    checks.push(await this.checkCircularReferences(context));
    
    // Check 5: Invalid relationship types
    checks.push(await this.checkInvalidRelationshipTypes(context));
    
    // Check 6: Invalid node types
    checks.push(await this.checkInvalidNodeTypes(context));
    
    // Check 7: Duplicate edges
    checks.push(await this.checkDuplicateEdges(context));

    const executionTime = Date.now() - startTime;
    
    return this.compileReport(checks, namespace, database, executionTime);
  }

  private async checkSelfReferences(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT edge_id, source_id, target_id, relationship_type FROM ontology_edge 
         WHERE source_id = target_id 
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const selfRefs = result || [];
      
      if (selfRefs.length > 0) {
        return {
          valid: false,
          check_id: 'graph-self-refs',
          check_name: 'Self-References',
          severity: this.rules.no_self_references ? 'error' : 'warning',
          message: `Found ${selfRefs.length} edge(s) with self-references (source_id = target_id)`,
          details: { self_references: selfRefs.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'graph-self-refs',
        check_name: 'Self-References',
        severity: 'info',
        message: 'No self-references found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'graph-self-refs',
        check_name: 'Self-References',
        severity: 'error',
        message: `Failed to check self-references: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkOrphanNodes(context: ValidationContext): Promise<ValidationResult> {
    try {
      // Nodes that are not referenced by any edge (source or target)
      const result = await context.surrealClient.query(
        `SELECT node_id, node_type, name FROM ontology_node 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         AND node_id NOT IN (
           SELECT source_id FROM ontology_edge 
           WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         )
         AND node_id NOT IN (
           SELECT target_id FROM ontology_edge 
           WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         )`
      );
      
      const orphanNodes = result || [];
      
      if (orphanNodes.length > 0) {
        return {
          valid: false,
          check_id: 'graph-orphan-nodes',
          check_name: 'Orphan Nodes',
          severity: this.rules.no_orphan_nodes ? 'error' : 'warning',
          message: `Found ${orphanNodes.length} orphan node(s) not connected by any edge`,
          details: { orphan_nodes: orphanNodes.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'graph-orphan-nodes',
        check_name: 'Orphan Nodes',
        severity: 'info',
        message: 'No orphan nodes found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'graph-orphan-nodes',
        check_name: 'Orphan Nodes',
        severity: 'error',
        message: `Failed to check orphan nodes: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkOrphanEdges(context: ValidationContext): Promise<ValidationResult> {
    try {
      // Edges that reference non-existent nodes
      const result = await context.surrealClient.query(
        `SELECT edge_id, source_id, target_id FROM ontology_edge 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         AND (source_id NOT IN (
           SELECT node_id FROM ontology_node 
           WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         )
         OR target_id NOT IN (
           SELECT node_id FROM ontology_node 
           WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         ))`
      );
      
      const orphanEdges = result || [];
      
      if (orphanEdges.length > 0) {
        return {
          valid: false,
          check_id: 'graph-orphan-edges',
          check_name: 'Orphan Edges',
          severity: this.rules.no_orphan_edges ? 'error' : 'warning',
          message: `Found ${orphanEdges.length} edge(s) referencing non-existent nodes`,
          details: { orphan_edges: orphanEdges.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'graph-orphan-edges',
        check_name: 'Orphan Edges',
        severity: 'info',
        message: 'No orphan edges found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'graph-orphan-edges',
        check_name: 'Orphan Edges',
        severity: 'error',
        message: `Failed to check orphan edges: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkCircularReferences(context: ValidationContext): Promise<ValidationResult> {
    try {
      // Get all edges to build adjacency list
      const edges = await context.surrealClient.query(
        `SELECT source_id, target_id FROM ontology_edge 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const adjacencyList = new Map<string, string[]>();
      
      for (const edge of edges || []) {
        if (!adjacencyList.has(edge.source_id)) {
          adjacencyList.set(edge.source_id, []);
        }
        adjacencyList.get(edge.source_id)!.push(edge.target_id);
      }
      
      // Detect cycles using DFS
      const cycles: Array<{ path: string[] }> = [];
      const visited = new Set<string>();
      const recStack = new Set<string>();
      
      const dfs = (node: string, path: string[]) => {
        visited.add(node);
        recStack.add(node);
        path.push(node);
        
        const neighbors = adjacencyList.get(node) || [];
        for (const neighbor of neighbors) {
          if (!visited.has(neighbor)) {
            dfs(neighbor, path);
          } else if (recStack.has(neighbor)) {
            // Cycle found
            const cycleStart = path.indexOf(neighbor);
            const cyclePath = path.slice(cycleStart);
            cyclePath.push(neighbor); // Close the cycle
            cycles.push({ path: cyclePath });
          }
        }
        
        path.pop();
        recStack.delete(node);
      };
      
      Array.from(adjacencyList.keys()).forEach(node => {
        if (!visited.has(node)) {
          dfs(node, []);
        }
      });
      
      if (cycles.length > 0) {
        return {
          valid: false,
          check_id: 'graph-circular-refs',
          check_name: 'Circular References',
          severity: 'warning',
          message: `Found ${cycles.length} circular reference(s) in the graph`,
          details: { cycles: cycles.slice(0, 5) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'graph-circular-refs',
        check_name: 'Circular References',
        severity: 'info',
        message: 'No circular references found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'graph-circular-refs',
        check_name: 'Circular References',
        severity: 'error',
        message: `Failed to check circular references: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkInvalidRelationshipTypes(context: ValidationContext): Promise<ValidationResult> {
    try {
      const validTypes = this.rules.valid_relationship_types.map(t => `"${t}"`).join(', ');
      
      const result = await context.surrealClient.query(
        `SELECT edge_id, relationship_type FROM ontology_edge 
         WHERE relationship_type NOT IN [${validTypes}]
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const invalidEdges = result || [];
      
      if (invalidEdges.length > 0) {
        return {
          valid: false,
          check_id: 'graph-invalid-rel-types',
          check_name: 'Invalid Relationship Types',
          severity: 'error',
          message: `Found ${invalidEdges.length} edge(s) with invalid relationship types`,
          details: { invalid_edges: invalidEdges.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'graph-invalid-rel-types',
        check_name: 'Invalid Relationship Types',
        severity: 'info',
        message: 'All relationship types are valid',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'graph-invalid-rel-types',
        check_name: 'Invalid Relationship Types',
        severity: 'error',
        message: `Failed to check relationship types: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkInvalidNodeTypes(context: ValidationContext): Promise<ValidationResult> {
    try {
      const validTypes = this.rules.allowed_node_types.map(t => `"${t}"`).join(', ');
      
      const result = await context.surrealClient.query(
        `SELECT node_id, node_type FROM ontology_node 
         WHERE node_type NOT IN [${validTypes}]
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const invalidNodes = result || [];
      
      if (invalidNodes.length > 0) {
        return {
          valid: false,
          check_id: 'graph-invalid-node-types',
          check_name: 'Invalid Node Types',
          severity: 'error',
          message: `Found ${invalidNodes.length} node(s) with invalid types`,
          details: { invalid_nodes: invalidNodes.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'graph-invalid-node-types',
        check_name: 'Invalid Node Types',
        severity: 'info',
        message: 'All node types are valid',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'graph-invalid-node-types',
        check_name: 'Invalid Node Types',
        severity: 'error',
        message: `Failed to check node types: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkDuplicateEdges(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT source_id, target_id, relationship_type, count() as count 
         FROM ontology_edge 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         GROUP BY source_id, target_id, relationship_type
         HAVING count > 1`
      );
      
      const duplicates = result || [];
      
      if (duplicates.length > 0) {
        return {
          valid: false,
          check_id: 'graph-duplicate-edges',
          check_name: 'Duplicate Edges',
          severity: 'warning',
          message: `Found ${duplicates.length} duplicate edge(s) (same source, target, and type)`,
          details: { duplicates: duplicates.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'graph-duplicate-edges',
        check_name: 'Duplicate Edges',
        severity: 'info',
        message: 'No duplicate edges found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'graph-duplicate-edges',
        check_name: 'Duplicate Edges',
        severity: 'error',
        message: `Failed to check duplicate edges: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private compileReport(checks: ValidationResult[], namespace: string, database: string, executionTime: number): ValidationReport {
    const errors = checks.filter(c => c.severity === 'error' && !c.valid).length;
    const warnings = checks.filter(c => c.severity === 'warning' && !c.valid).length;
    const passed = checks.filter(c => c.valid).length;
    
    return {
      valid: errors === 0,
      namespace,
      database,
      timestamp: new Date().toISOString(),
      checks,
      summary: {
        total: checks.length,
        passed,
        failed: checks.length - passed,
        warnings,
        errors
      },
      execution_time_ms: executionTime
    };
  }
}

export default GraphConsistencyValidator;
