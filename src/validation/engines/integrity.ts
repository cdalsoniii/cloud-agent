import { ValidationResult, ValidationReport, ValidationContext, DataIntegrityRules, Validator } from '../types.js';
import { surrealQueryResults } from '../../simple-surreal-client.js';

/**
 * Data Integrity Validator
 * Checks for data integrity issues: missing required fields, type mismatches, referential integrity, namespace consistency, duplicates
 */
export class DataIntegrityValidator implements Validator {
  private rules: DataIntegrityRules = {
    required_node_fields: ['node_id', 'node_type', 'name', 'namespace', 'database'],
    required_edge_fields: ['edge_id', 'source_id', 'target_id', 'relationship_type', 'namespace', 'database'],
    field_type_validations: {
      'cost_usd': 'number',
      'tokens_in': 'number',
      'tokens_out': 'number',
      'weight': 'number',
      'created_at': 'string',
      'updated_at': 'string'
    },
    referential_integrity: true,
    namespace_consistency: true
  };

  constructor(rules?: Partial<DataIntegrityRules>) {
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

    // Check 1: Missing required fields in nodes
    checks.push(await this.checkMissingNodeFields(context));
    
    // Check 2: Missing required fields in edges
    checks.push(await this.checkMissingEdgeFields(context));
    
    // Check 3: Type mismatches in properties
    checks.push(await this.checkTypeMismatches(context));
    
    // Check 4: Referential integrity (edges reference existing nodes)
    checks.push(await this.checkReferentialIntegrity(context));
    
    // Check 5: Namespace consistency
    checks.push(await this.checkNamespaceConsistency(context));
    
    // Check 6: Duplicate node IDs
    checks.push(await this.checkDuplicateNodeIds(context));
    
    // Check 7: Duplicate edge IDs
    checks.push(await this.checkDuplicateEdgeIds(context));
    
    // Check 8: Invalid date formats
    checks.push(await this.checkDateFormats(context));

    const executionTime = Date.now() - startTime;
    
    return this.compileReport(checks, namespace, database, executionTime);
  }

  private async checkMissingNodeFields(context: ValidationContext): Promise<ValidationResult> {
    try {
      const requiredFields = this.rules.required_node_fields;
      const conditions = requiredFields.map(field => `${field} IS NULL`).join(' OR ');
      
      const result = await context.surrealClient.query(
        `SELECT node_id, node_type FROM ontology_node 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         AND (${conditions})`
      );
      
      const invalidNodes = result || [];
      
      if (invalidNodes.length > 0) {
        return {
          valid: false,
          check_id: 'integrity-missing-node-fields',
          check_name: 'Missing Required Node Fields',
          severity: 'error',
          message: `Found ${invalidNodes.length} node(s) missing required fields (${requiredFields.join(', ')})`,
          details: { invalid_nodes: invalidNodes.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'integrity-missing-node-fields',
        check_name: 'Missing Required Node Fields',
        severity: 'info',
        message: 'All nodes have required fields',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'integrity-missing-node-fields',
        check_name: 'Missing Required Node Fields',
        severity: 'error',
        message: `Failed to check missing node fields: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkMissingEdgeFields(context: ValidationContext): Promise<ValidationResult> {
    try {
      const requiredFields = this.rules.required_edge_fields;
      const conditions = requiredFields.map(field => `${field} IS NULL`).join(' OR ');
      
      const result = await context.surrealClient.query(
        `SELECT edge_id, source_id, target_id FROM ontology_edge 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         AND (${conditions})`
      );
      
      const invalidEdges = result || [];
      
      if (invalidEdges.length > 0) {
        return {
          valid: false,
          check_id: 'integrity-missing-edge-fields',
          check_name: 'Missing Required Edge Fields',
          severity: 'error',
          message: `Found ${invalidEdges.length} edge(s) missing required fields (${requiredFields.join(', ')})`,
          details: { invalid_edges: invalidEdges.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'integrity-missing-edge-fields',
        check_name: 'Missing Required Edge Fields',
        severity: 'info',
        message: 'All edges have required fields',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'integrity-missing-edge-fields',
        check_name: 'Missing Required Edge Fields',
        severity: 'error',
        message: `Failed to check missing edge fields: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkTypeMismatches(context: ValidationContext): Promise<ValidationResult> {
    try {
      const mismatches: Array<{ node_id: string; field: string; expected: string; actual: string }> = [];
      
      // Check node properties
      const nodes = await context.surrealClient.query(
        `SELECT node_id, properties FROM ontology_node 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      for (const node of nodes || []) {
        if (node.properties) {
          for (const [field, expectedType] of Object.entries(this.rules.field_type_validations)) {
            if (field in node.properties) {
              const actualType = typeof node.properties[field];
              if (actualType !== expectedType) {
                mismatches.push({
                  node_id: node.node_id,
                  field,
                  expected: expectedType,
                  actual: actualType
                });
              }
            }
          }
        }
      }
      
      // Check edge properties
      const edges = await context.surrealClient.query(
        `SELECT edge_id, properties FROM ontology_edge 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      for (const edge of edges || []) {
        if (edge.properties) {
          for (const [field, expectedType] of Object.entries(this.rules.field_type_validations)) {
            if (field in edge.properties) {
              const actualType = typeof edge.properties[field];
              if (actualType !== expectedType) {
                mismatches.push({
                  node_id: edge.edge_id,
                  field,
                  expected: expectedType,
                  actual: actualType
                });
              }
            }
          }
        }
      }
      
      if (mismatches.length > 0) {
        return {
          valid: false,
          check_id: 'integrity-type-mismatches',
          check_name: 'Type Mismatches',
          severity: 'warning',
          message: `Found ${mismatches.length} type mismatch(es) in properties`,
          details: { mismatches: mismatches.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'integrity-type-mismatches',
        check_name: 'Type Mismatches',
        severity: 'info',
        message: 'No type mismatches found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'integrity-type-mismatches',
        check_name: 'Type Mismatches',
        severity: 'error',
        message: `Failed to check type mismatches: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkReferentialIntegrity(context: ValidationContext): Promise<ValidationResult> {
    try {
      if (!this.rules.referential_integrity) {
        return {
          valid: true,
          check_id: 'integrity-referential',
          check_name: 'Referential Integrity',
          severity: 'info',
          message: 'Referential integrity check disabled',
          timestamp: new Date().toISOString()
        };
      }
      
      // Check edges that reference non-existent nodes
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
      
      const brokenRefs = result || [];
      
      if (brokenRefs.length > 0) {
        return {
          valid: false,
          check_id: 'integrity-referential',
          check_name: 'Referential Integrity',
          severity: 'error',
          message: `Found ${brokenRefs.length} edge(s) with broken references (non-existent nodes)`,
          details: { broken_references: brokenRefs.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'integrity-referential',
        check_name: 'Referential Integrity',
        severity: 'info',
        message: 'All edge references are valid',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'integrity-referential',
        check_name: 'Referential Integrity',
        severity: 'error',
        message: `Failed to check referential integrity: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkNamespaceConsistency(context: ValidationContext): Promise<ValidationResult> {
    try {
      if (!this.rules.namespace_consistency) {
        return {
          valid: true,
          check_id: 'integrity-namespace',
          check_name: 'Namespace Consistency',
          severity: 'info',
          message: 'Namespace consistency check disabled',
          timestamp: new Date().toISOString()
        };
      }
      
      // Check for nodes with mismatched namespace/database
      const nodesResult = await context.surrealClient.query(
        `SELECT node_id, namespace, database FROM ontology_node 
         WHERE namespace != "${context.namespace}" OR database != "${context.database}"`
      );
      
      const edgesResult = await context.surrealClient.query(
        `SELECT edge_id, namespace, database FROM ontology_edge 
         WHERE namespace != "${context.namespace}" OR database != "${context.database}"`
      );
      
      const mismatchedNodes = nodesResult || [];
      const mismatchedEdges = edgesResult || [];
      
      if (mismatchedNodes.length > 0 || mismatchedEdges.length > 0) {
        return {
          valid: false,
          check_id: 'integrity-namespace',
          check_name: 'Namespace Consistency',
          severity: 'warning',
          message: `Found ${mismatchedNodes.length} node(s) and ${mismatchedEdges.length} edge(s) with mismatched namespace/database`,
          details: { 
            mismatched_nodes: mismatchedNodes.slice(0, 5),
            mismatched_edges: mismatchedEdges.slice(0, 5)
          },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'integrity-namespace',
        check_name: 'Namespace Consistency',
        severity: 'info',
        message: 'All elements have consistent namespace/database',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'integrity-namespace',
        check_name: 'Namespace Consistency',
        severity: 'error',
        message: `Failed to check namespace consistency: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkDuplicateNodeIds(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT node_id, count() as count FROM ontology_node 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         GROUP BY node_id
         HAVING count > 1`
      );
      
      const duplicates = result || [];
      
      if (duplicates.length > 0) {
        return {
          valid: false,
          check_id: 'integrity-duplicate-node-ids',
          check_name: 'Duplicate Node IDs',
          severity: 'error',
          message: `Found ${duplicates.length} duplicate node ID(s)`,
          details: { duplicates: duplicates.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'integrity-duplicate-node-ids',
        check_name: 'Duplicate Node IDs',
        severity: 'info',
        message: 'No duplicate node IDs found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'integrity-duplicate-node-ids',
        check_name: 'Duplicate Node IDs',
        severity: 'error',
        message: `Failed to check duplicate node IDs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkDuplicateEdgeIds(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT edge_id, count() as count FROM ontology_edge 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"
         GROUP BY edge_id
         HAVING count > 1`
      );
      
      const duplicates = result || [];
      
      if (duplicates.length > 0) {
        return {
          valid: false,
          check_id: 'integrity-duplicate-edge-ids',
          check_name: 'Duplicate Edge IDs',
          severity: 'error',
          message: `Found ${duplicates.length} duplicate edge ID(s)`,
          details: { duplicates: duplicates.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'integrity-duplicate-edge-ids',
        check_name: 'Duplicate Edge IDs',
        severity: 'info',
        message: 'No duplicate edge IDs found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'integrity-duplicate-edge-ids',
        check_name: 'Duplicate Edge IDs',
        severity: 'error',
        message: `Failed to check duplicate edge IDs: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkDateFormats(context: ValidationContext): Promise<ValidationResult> {
    try {
      const invalidDates: Array<{ id: string; field: string; value: string }> = [];
      
      // Check node dates
      const nodes = await context.surrealClient.query(
        `SELECT node_id, created_at, updated_at FROM ontology_node 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      for (const node of nodes || []) {
        if (node.created_at && !this.isValidDate(node.created_at)) {
          invalidDates.push({ id: node.node_id, field: 'created_at', value: node.created_at });
        }
        if (node.updated_at && !this.isValidDate(node.updated_at)) {
          invalidDates.push({ id: node.node_id, field: 'updated_at', value: node.updated_at });
        }
      }
      
      // Check edge dates
      const edges = await context.surrealClient.query(
        `SELECT edge_id, created_at FROM ontology_edge 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      for (const edge of edges || []) {
        if (edge.created_at && !this.isValidDate(edge.created_at)) {
          invalidDates.push({ id: edge.edge_id, field: 'created_at', value: edge.created_at });
        }
      }
      
      if (invalidDates.length > 0) {
        return {
          valid: false,
          check_id: 'integrity-date-formats',
          check_name: 'Date Format Validity',
          severity: 'warning',
          message: `Found ${invalidDates.length} invalid date format(s)`,
          details: { invalid_dates: invalidDates.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'integrity-date-formats',
        check_name: 'Date Format Validity',
        severity: 'info',
        message: 'All date formats are valid',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'integrity-date-formats',
        check_name: 'Date Format Validity',
        severity: 'error',
        message: `Failed to check date formats: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private isValidDate(dateString: string): boolean {
    const date = new Date(dateString);
    return date instanceof Date && !isNaN(date.getTime());
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

export default DataIntegrityValidator;
