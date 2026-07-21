import { ValidationResult, ValidationReport, ValidationContext, PerformanceThresholds, Validator } from '../types.js';
import { surrealQueryResults } from '../../simple-surreal-client.js';

/**
 * Performance Validator
 * Checks for performance issues: slow queries, large result sets, high memory usage, missing indexes
 */
export class PerformanceValidator implements Validator {
  private thresholds: PerformanceThresholds = {
    max_query_time_ms: 5000,
    max_result_size: 10000,
    max_memory_mb: 512,
    max_cpu_percent: 80
  };

  constructor(thresholds?: Partial<PerformanceThresholds>) {
    if (thresholds) {
      this.thresholds = { ...this.thresholds, ...thresholds };
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

    // Check 1: Query execution time for common operations
    checks.push(await this.checkQueryPerformance(context));
    
    // Check 2: Node count (warning if too many)
    checks.push(await this.checkNodeCount(context));
    
    // Check 3: Edge count (warning if too many)
    checks.push(await this.checkEdgeCount(context));
    
    // Check 4: Large result sets (queries returning too many rows)
    checks.push(await this.checkLargeResultSets(context));
    
    // Check 5: Memory usage during queries
    checks.push(await this.checkMemoryUsage(context));
    
    // Check 6: Query complexity (nested queries)
    checks.push(await this.checkQueryComplexity(context));
    
    // Check 7: Index usage (check if common queries benefit from indexes)
    checks.push(await this.checkIndexUsage(context));
    
    // Check 8: Connection pool health
    checks.push(await this.checkConnectionHealth(context));

    const executionTime = Date.now() - startTime;
    
    return this.compileReport(checks, namespace, database, executionTime);
  }

  private async checkQueryPerformance(context: ValidationContext): Promise<ValidationResult> {
    try {
      const testQueries = [
        {
          name: 'List all nodes',
          query: `SELECT * FROM ontology_node WHERE namespace = "${context.namespace}" AND database = "${context.database}" LIMIT 100`
        },
        {
          name: 'List all edges',
          query: `SELECT * FROM ontology_edge WHERE namespace = "${context.namespace}" AND database = "${context.database}" LIMIT 100`
        },
        {
          name: 'Node type filter',
          query: `SELECT * FROM ontology_node WHERE node_type = 'sdlc_event_type' AND namespace = "${context.namespace}" AND database = "${context.database}"`
        },
        {
          name: 'Relationship query',
          query: `SELECT source_id, target_id FROM ontology_edge WHERE relationship_type = 'uses_model' AND namespace = "${context.namespace}" AND database = "${context.database}"`
        },
        {
          name: 'Count nodes',
          query: `SELECT count() FROM ontology_node WHERE namespace = "${context.namespace}" AND database = "${context.database}" GROUP BY ALL`
        }
      ];

      const slowQueries: Array<{ name: string; time_ms: number; threshold: number }> = [];
      
      for (const test of testQueries) {
        const queryStart = Date.now();
        await context.surrealClient.query(test.query);
        const queryTime = Date.now() - queryStart;
        
        if (queryTime > this.thresholds.max_query_time_ms) {
          slowQueries.push({
            name: test.name,
            time_ms: queryTime,
            threshold: this.thresholds.max_query_time_ms
          });
        }
      }
      
      if (slowQueries.length > 0) {
        return {
          valid: false,
          check_id: 'perf-query-time',
          check_name: 'Query Execution Time',
          severity: 'warning',
          message: `${slowQueries.length}/${testQueries.length} queries exceeded ${this.thresholds.max_query_time_ms}ms threshold`,
          details: { slow_queries: slowQueries },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'perf-query-time',
        check_name: 'Query Execution Time',
        severity: 'info',
        message: `All ${testQueries.length} queries executed within ${this.thresholds.max_query_time_ms}ms threshold`,
        details: { max_time_ms: Math.max(...testQueries.map(t => 0)) },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'perf-query-time',
        check_name: 'Query Execution Time',
        severity: 'error',
        message: `Failed to check query performance: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkNodeCount(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT count() FROM ontology_node WHERE namespace = "${context.namespace}" AND database = "${context.database}" GROUP BY ALL`
      );
      
      const count = result?.[0]?.count || 0;
      const maxNodes = 100000; // Hard limit
      const warningThreshold = 50000; // Warning threshold
      
      if (count > maxNodes) {
        return {
          valid: false,
          check_id: 'perf-node-count',
          check_name: 'Node Count',
          severity: 'error',
          message: `Node count (${count}) exceeds maximum limit (${maxNodes})`,
          details: { count, max_limit: maxNodes, warning_threshold: warningThreshold },
          timestamp: new Date().toISOString()
        };
      }
      
      if (count > warningThreshold) {
        return {
          valid: false,
          check_id: 'perf-node-count',
          check_name: 'Node Count',
          severity: 'warning',
          message: `Node count (${count}) approaching limit (${maxNodes})`,
          details: { count, max_limit: maxNodes, warning_threshold: warningThreshold },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'perf-node-count',
        check_name: 'Node Count',
        severity: 'info',
        message: `Node count (${count}) within normal range`,
        details: { count, warning_threshold: warningThreshold },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'perf-node-count',
        check_name: 'Node Count',
        severity: 'error',
        message: `Failed to check node count: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkEdgeCount(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT count() FROM ontology_edge WHERE namespace = "${context.namespace}" AND database = "${context.database}" GROUP BY ALL`
      );
      
      const count = result?.[0]?.count || 0;
      const maxEdges = 1000000; // Hard limit
      const warningThreshold = 500000; // Warning threshold
      
      if (count > maxEdges) {
        return {
          valid: false,
          check_id: 'perf-edge-count',
          check_name: 'Edge Count',
          severity: 'error',
          message: `Edge count (${count}) exceeds maximum limit (${maxEdges})`,
          details: { count, max_limit: maxEdges, warning_threshold: warningThreshold },
          timestamp: new Date().toISOString()
        };
      }
      
      if (count > warningThreshold) {
        return {
          valid: false,
          check_id: 'perf-edge-count',
          check_name: 'Edge Count',
          severity: 'warning',
          message: `Edge count (${count}) approaching limit (${maxEdges})`,
          details: { count, max_limit: maxEdges, warning_threshold: warningThreshold },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'perf-edge-count',
        check_name: 'Edge Count',
        severity: 'info',
        message: `Edge count (${count}) within normal range`,
        details: { count, warning_threshold: warningThreshold },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'perf-edge-count',
        check_name: 'Edge Count',
        severity: 'error',
        message: `Failed to check edge count: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkLargeResultSets(context: ValidationContext): Promise<ValidationResult> {
    try {
      const largeResults: Array<{ query: string; result_size: number }> = [];
      
      // Test queries that might return large results
      const testQueries = [
        `SELECT * FROM ontology_node WHERE namespace = "${context.namespace}" AND database = "${context.database}"`,
        `SELECT * FROM ontology_edge WHERE namespace = "${context.namespace}" AND database = "${context.database}"`,
        `SELECT * FROM ontology_node WHERE node_type = 'sdlc_event_type' AND namespace = "${context.namespace}" AND database = "${context.database}"`
      ];
      
      for (const query of testQueries) {
        const result = await context.surrealClient.query(query);
        const size = Array.isArray(result) ? result.length : 0;
        
        if (size > this.thresholds.max_result_size) {
          largeResults.push({ query: query.substring(0, 100) + '...', result_size: size });
        }
      }
      
      if (largeResults.length > 0) {
        return {
          valid: false,
          check_id: 'perf-large-results',
          check_name: 'Large Result Sets',
          severity: 'warning',
          message: `${largeResults.length} queries returned results exceeding ${this.thresholds.max_result_size} rows`,
          details: { large_results: largeResults },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'perf-large-results',
        check_name: 'Large Result Sets',
        severity: 'info',
        message: 'No queries returned excessively large result sets',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'perf-large-results',
        check_name: 'Large Result Sets',
        severity: 'error',
        message: `Failed to check large result sets: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkMemoryUsage(context: ValidationContext): Promise<ValidationResult> {
    try {
      // Get memory usage before and after a query
      const memBefore = process.memoryUsage().heapUsed / 1024 / 1024; // MB
      
      // Execute a moderate query
      await context.surrealClient.query(
        `SELECT * FROM ontology_edge WHERE namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const memAfter = process.memoryUsage().heapUsed / 1024 / 1024; // MB
      const memDiff = memAfter - memBefore;
      
      if (memDiff > this.thresholds.max_memory_mb) {
        return {
          valid: false,
          check_id: 'perf-memory',
          check_name: 'Memory Usage',
          severity: 'warning',
          message: `Memory usage increased by ${memDiff.toFixed(2)}MB during query execution (threshold: ${this.thresholds.max_memory_mb}MB)`,
          details: { memory_diff_mb: memDiff, threshold: this.thresholds.max_memory_mb },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'perf-memory',
        check_name: 'Memory Usage',
        severity: 'info',
        message: `Memory usage within acceptable range (${memDiff.toFixed(2)}MB)`,
        details: { memory_diff_mb: memDiff },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'perf-memory',
        check_name: 'Memory Usage',
        severity: 'error',
        message: `Failed to check memory usage: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkQueryComplexity(context: ValidationContext): Promise<ValidationResult> {
    try {
      // Complex queries that might be slow
      const complexQueries = [
        {
          name: 'Multi-level relationship traversal',
          query: `SELECT * FROM ontology_edge WHERE source_id IN (SELECT node_id FROM ontology_node WHERE node_type = 'ai_model' AND namespace = "${context.namespace}" AND database = "${context.database}") AND namespace = "${context.namespace}" AND database = "${context.database}"`
        },
        {
          name: 'Aggregation with grouping',
          query: `SELECT node_type, count() FROM ontology_node WHERE namespace = "${context.namespace}" AND database = "${context.database}" GROUP BY node_type`
        }
      ];
      
      const slowComplexQueries: Array<{ name: string; time_ms: number }> = [];
      
      for (const test of complexQueries) {
        const queryStart = Date.now();
        await context.surrealClient.query(test.query);
        const queryTime = Date.now() - queryStart;
        
        if (queryTime > this.thresholds.max_query_time_ms) {
          slowComplexQueries.push({ name: test.name, time_ms: queryTime });
        }
      }
      
      if (slowComplexQueries.length > 0) {
        return {
          valid: false,
          check_id: 'perf-query-complexity',
          check_name: 'Query Complexity',
          severity: 'warning',
          message: `${slowComplexQueries.length} complex queries exceeded ${this.thresholds.max_query_time_ms}ms`,
          details: { slow_queries: slowComplexQueries },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'perf-query-complexity',
        check_name: 'Query Complexity',
        severity: 'info',
        message: 'Complex queries executed within acceptable time limits',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'perf-query-complexity',
        check_name: 'Query Complexity',
        severity: 'error',
        message: `Failed to check query complexity: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkIndexUsage(context: ValidationContext): Promise<ValidationResult> {
    try {
      // Note: SurrealDB doesn't have EXPLAIN, but we can infer index usage from query performance
      // If queries are slow without indexes, we can suggest index creation
      
      const queriesWithoutIndex = [
        {
          field: 'node_type',
          query: `SELECT * FROM ontology_node WHERE node_type = 'ai_model' AND namespace = "${context.namespace}" AND database = "${context.database}"`
        },
        {
          field: 'relationship_type',
          query: `SELECT * FROM ontology_edge WHERE relationship_type = 'uses_model' AND namespace = "${context.namespace}" AND database = "${context.database}"`
        }
      ];
      
      const slowQueries: Array<{ field: string; time_ms: number }> = [];
      
      for (const test of queriesWithoutIndex) {
        const queryStart = Date.now();
        await context.surrealClient.query(test.query);
        const queryTime = Date.now() - queryStart;
        
        if (queryTime > 1000) { // 1 second threshold for indexed queries
          slowQueries.push({ field: test.field, time_ms: queryTime });
        }
      }
      
      if (slowQueries.length > 0) {
        return {
          valid: false,
          check_id: 'perf-index-usage',
          check_name: 'Index Usage',
          severity: 'warning',
          message: `${slowQueries.length} queries may benefit from indexes on fields: ${slowQueries.map(s => s.field).join(', ')}`,
          details: { slow_queries: slowQueries, suggested_indexes: slowQueries.map(s => s.field) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'perf-index-usage',
        check_name: 'Index Usage',
        severity: 'info',
        message: 'Query performance suggests adequate indexing',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'perf-index-usage',
        check_name: 'Index Usage',
        severity: 'error',
        message: `Failed to check index usage: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkConnectionHealth(context: ValidationContext): Promise<ValidationResult> {
    try {
      const startTime = Date.now();
      await context.surrealClient.query('SELECT 1');
      const responseTime = Date.now() - startTime;
      
      if (responseTime > 1000) {
        return {
          valid: false,
          check_id: 'perf-connection-health',
          check_name: 'Connection Health',
          severity: 'warning',
          message: `Slow connection response time: ${responseTime}ms (threshold: 1000ms)`,
          details: { response_time_ms: responseTime },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'perf-connection-health',
        check_name: 'Connection Health',
        severity: 'info',
        message: `Connection healthy (${responseTime}ms response time)`,
        details: { response_time_ms: responseTime },
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'perf-connection-health',
        check_name: 'Connection Health',
        severity: 'error',
        message: `Connection health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

export default PerformanceValidator;
