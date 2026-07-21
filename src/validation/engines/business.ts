import { ValidationResult, ValidationReport, ValidationContext, BusinessRule, Validator } from '../types.js';
import { surrealQueryResults } from '../../simple-surreal-client.js';

/**
 * Business Rule Validator
 * Checks for business rule violations in SDLC ontology events
 */
export class BusinessRuleValidator implements Validator {
  private rules: BusinessRule[] = [
    {
      id: 'cost-threshold',
      name: 'Cost Threshold Exceeded',
      condition: (data) => data.properties?.cost_usd > 100,
      message: 'Cost exceeds $100 threshold',
      severity: 'warning'
    },
    {
      id: 'negative-cost',
      name: 'Negative Cost',
      condition: (data) => data.properties?.cost_usd < 0,
      message: 'Negative cost detected',
      severity: 'error'
    },
    {
      id: 'negative-tokens',
      name: 'Negative Token Count',
      condition: (data) => data.properties?.tokens_in < 0 || data.properties?.tokens_out < 0,
      message: 'Negative token count detected',
      severity: 'error'
    },
    {
      id: 'token-ratio-suspicious',
      name: 'Suspicious Token Ratio',
      condition: (data) => {
        const tokens_in = data.properties?.tokens_in || 0;
        const tokens_out = data.properties?.tokens_out || 0;
        return tokens_in > 0 && tokens_out > 0 && tokens_out / tokens_in > 10;
      },
      message: 'Token output ratio suspiciously high (>10:1)',
      severity: 'warning'
    },
    {
      id: 'high-token-usage',
      name: 'High Token Usage',
      condition: (data) => {
        const total = (data.properties?.tokens_in || 0) + (data.properties?.tokens_out || 0);
        return total > 100000;
      },
      message: 'Total token usage exceeds 100,000',
      severity: 'warning'
    },
    {
      id: 'zero-cost-with-tokens',
      name: 'Zero Cost with Tokens',
      condition: (data) => {
        const cost = data.properties?.cost_usd || 0;
        const tokens = (data.properties?.tokens_in || 0) + (data.properties?.tokens_out || 0);
        return cost === 0 && tokens > 0;
      },
      message: 'Zero cost but tokens were consumed (possible billing issue)',
      severity: 'info'
    }
  ];

  constructor(customRules?: BusinessRule[]) {
    if (customRules) {
      this.rules = [...this.rules, ...customRules];
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

    // Check 1: Cost threshold violations
    checks.push(await this.checkCostThreshold(context));
    
    // Check 2: Negative cost
    checks.push(await this.checkNegativeCost(context));
    
    // Check 3: Negative tokens
    checks.push(await this.checkNegativeTokens(context));
    
    // Check 4: Suspicious token ratios
    checks.push(await this.checkTokenRatios(context));
    
    // Check 5: High token usage
    checks.push(await this.checkHighTokenUsage(context));
    
    // Check 6: Zero cost with tokens
    checks.push(await this.checkZeroCostWithTokens(context));
    
    // Check 7: Missing model for generation events
    checks.push(await this.checkMissingModelForGeneration(context));
    
    // Check 8: Missing repo for deployment events
    checks.push(await this.checkMissingRepoForDeployment(context));
    
    // Check 9: Duplicate events
    checks.push(await this.checkDuplicateEvents(context));
    
    // Check 10: Run all custom rules on edges
    checks.push(await this.checkCustomRules(context));

    const executionTime = Date.now() - startTime;
    
    return this.compileReport(checks, namespace, database, executionTime);
  }

  private async checkCostThreshold(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT edge_id, properties.cost_usd FROM ontology_edge 
         WHERE properties.cost_usd > 100
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const violations = result || [];
      
      if (violations.length > 0) {
        return {
          valid: false,
          check_id: 'biz-cost-threshold',
          check_name: 'Cost Threshold',
          severity: 'warning',
          message: `Found ${violations.length} edge(s) with cost > $100`,
          details: { violations: violations.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-cost-threshold',
        check_name: 'Cost Threshold',
        severity: 'info',
        message: 'All costs within acceptable range',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-cost-threshold',
        check_name: 'Cost Threshold',
        severity: 'error',
        message: `Failed to check cost threshold: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkNegativeCost(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT edge_id, properties.cost_usd FROM ontology_edge 
         WHERE properties.cost_usd < 0
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const violations = result || [];
      
      if (violations.length > 0) {
        return {
          valid: false,
          check_id: 'biz-negative-cost',
          check_name: 'Negative Cost',
          severity: 'error',
          message: `Found ${violations.length} edge(s) with negative cost`,
          details: { violations: violations.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-negative-cost',
        check_name: 'Negative Cost',
        severity: 'info',
        message: 'No negative costs found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-negative-cost',
        check_name: 'Negative Cost',
        severity: 'error',
        message: `Failed to check negative cost: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkNegativeTokens(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT edge_id, properties.tokens_in, properties.tokens_out FROM ontology_edge 
         WHERE properties.tokens_in < 0 OR properties.tokens_out < 0
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const violations = result || [];
      
      if (violations.length > 0) {
        return {
          valid: false,
          check_id: 'biz-negative-tokens',
          check_name: 'Negative Tokens',
          severity: 'error',
          message: `Found ${violations.length} edge(s) with negative token counts`,
          details: { violations: violations.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-negative-tokens',
        check_name: 'Negative Tokens',
        severity: 'info',
        message: 'No negative token counts found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-negative-tokens',
        check_name: 'Negative Tokens',
        severity: 'error',
        message: `Failed to check negative tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkTokenRatios(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT edge_id, properties.tokens_in, properties.tokens_out FROM ontology_edge 
         WHERE properties.tokens_in > 0 AND properties.tokens_out > 0
         AND properties.tokens_out / properties.tokens_in > 10
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const violations = result || [];
      
      if (violations.length > 0) {
        return {
          valid: false,
          check_id: 'biz-token-ratio',
          check_name: 'Token Ratio',
          severity: 'warning',
          message: `Found ${violations.length} edge(s) with suspicious token output ratio (>10:1)`,
          details: { violations: violations.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-token-ratio',
        check_name: 'Token Ratio',
        severity: 'info',
        message: 'All token ratios within normal range',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-token-ratio',
        check_name: 'Token Ratio',
        severity: 'error',
        message: `Failed to check token ratios: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkHighTokenUsage(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT edge_id, properties.tokens_in, properties.tokens_out FROM ontology_edge 
         WHERE (properties.tokens_in + properties.tokens_out) > 100000
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const violations = result || [];
      
      if (violations.length > 0) {
        return {
          valid: false,
          check_id: 'biz-high-tokens',
          check_name: 'High Token Usage',
          severity: 'warning',
          message: `Found ${violations.length} edge(s) with total token usage > 100,000`,
          details: { violations: violations.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-high-tokens',
        check_name: 'High Token Usage',
        severity: 'info',
        message: 'All token usage within acceptable limits',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-high-tokens',
        check_name: 'High Token Usage',
        severity: 'error',
        message: `Failed to check high token usage: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkZeroCostWithTokens(context: ValidationContext): Promise<ValidationResult> {
    try {
      const result = await context.surrealClient.query(
        `SELECT edge_id, properties.cost_usd, properties.tokens_in, properties.tokens_out FROM ontology_edge 
         WHERE properties.cost_usd = 0 AND (properties.tokens_in > 0 OR properties.tokens_out > 0)
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const violations = result || [];
      
      if (violations.length > 0) {
        return {
          valid: false,
          check_id: 'biz-zero-cost',
          check_name: 'Zero Cost with Tokens',
          severity: 'info',
          message: `Found ${violations.length} edge(s) with zero cost but tokens consumed (possible billing issue)`,
          details: { violations: violations.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-zero-cost',
        check_name: 'Zero Cost with Tokens',
        severity: 'info',
        message: 'No zero-cost with token usage anomalies found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-zero-cost',
        check_name: 'Zero Cost with Tokens',
        severity: 'error',
        message: `Failed to check zero cost with tokens: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkMissingModelForGeneration(context: ValidationContext): Promise<ValidationResult> {
    try {
      // Check event nodes that have 'generation' in the name but no 'uses_model' edge
      const result = await context.surrealClient.query(
        `SELECT node_id, name FROM ontology_node 
         WHERE node_type = 'sdlc_event_type' 
         AND (name CONTAINS 'generation' OR name CONTAINS 'generate' OR name CONTAINS 'create')
         AND node_id NOT IN (
           SELECT target_id FROM ontology_edge 
           WHERE relationship_type = 'uses_model'
           AND namespace = "${context.namespace}" AND database = "${context.database}"
         )
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const violations = result || [];
      
      if (violations.length > 0) {
        return {
          valid: false,
          check_id: 'biz-missing-model',
          check_name: 'Missing Model for Generation',
          severity: 'warning',
          message: `Found ${violations.length} generation event(s) without associated model`,
          details: { violations: violations.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-missing-model',
        check_name: 'Missing Model for Generation',
        severity: 'info',
        message: 'All generation events have associated models',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-missing-model',
        check_name: 'Missing Model for Generation',
        severity: 'error',
        message: `Failed to check missing model for generation: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkMissingRepoForDeployment(context: ValidationContext): Promise<ValidationResult> {
    try {
      // Check event nodes that have 'deploy' in the name but no 'targets_repo' edge
      const result = await context.surrealClient.query(
        `SELECT node_id, name FROM ontology_node 
         WHERE node_type = 'sdlc_event_type' 
         AND (name CONTAINS 'deploy' OR name CONTAINS 'release')
         AND node_id NOT IN (
           SELECT target_id FROM ontology_edge 
           WHERE relationship_type = 'targets_repo'
           AND namespace = "${context.namespace}" AND database = "${context.database}"
         )
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const violations = result || [];
      
      if (violations.length > 0) {
        return {
          valid: false,
          check_id: 'biz-missing-repo',
          check_name: 'Missing Repository for Deployment',
          severity: 'warning',
          message: `Found ${violations.length} deployment event(s) without target repository`,
          details: { violations: violations.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-missing-repo',
        check_name: 'Missing Repository for Deployment',
        severity: 'info',
        message: 'All deployment events have target repositories',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-missing-repo',
        check_name: 'Missing Repository for Deployment',
        severity: 'error',
        message: `Failed to check missing repo for deployment: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkDuplicateEvents(context: ValidationContext): Promise<ValidationResult> {
    try {
      // In SurrealDB, we need to check for duplicates differently
      // Use application-level grouping instead of HAVING
      const result = await context.surrealClient.query(
        `SELECT node_id, name FROM ontology_node 
         WHERE node_type = 'sdlc_event_type'
         AND namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      const nodes = result || [];
      
      // Group by node_id and find duplicates
      const nodeGroups = new Map<string, any[]>();
      for (const node of nodes) {
        if (!nodeGroups.has(node.node_id)) {
          nodeGroups.set(node.node_id, []);
        }
        nodeGroups.get(node.node_id)!.push(node);
      }
      
      const duplicates = Array.from(nodeGroups.entries())
        .filter(([_, instances]) => instances.length > 1)
        .map(([node_id, instances]) => ({ node_id, count: instances.length }));
      
      if (duplicates.length > 0) {
        return {
          valid: false,
          check_id: 'biz-duplicate-events',
          check_name: 'Duplicate Events',
          severity: 'warning',
          message: `Found ${duplicates.length} duplicate event(s)`,
          details: { duplicates: duplicates.slice(0, 10) },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-duplicate-events',
        check_name: 'Duplicate Events',
        severity: 'info',
        message: 'No duplicate events found',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-duplicate-events',
        check_name: 'Duplicate Events',
        severity: 'error',
        message: `Failed to check duplicate events: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date().toISOString()
      };
    }
  }

  private async checkCustomRules(context: ValidationContext): Promise<ValidationResult> {
    try {
      const violations: Array<{ rule_id: string; rule_name: string; data: any }> = [];
      
      // Get all edges with properties to check against custom rules
      const edges = await context.surrealClient.query(
        `SELECT edge_id, properties FROM ontology_edge 
         WHERE namespace = "${context.namespace}" AND database = "${context.database}"`
      );
      
      for (const edge of edges || []) {
        for (const rule of this.rules) {
          if (rule.condition(edge)) {
            violations.push({
              rule_id: rule.id,
              rule_name: rule.name,
              data: { edge_id: edge.edge_id, properties: edge.properties }
            });
          }
        }
      }
      
      // Group violations by rule
      const violationsByRule = violations.reduce((acc, v) => {
        if (!acc[v.rule_id]) {
          acc[v.rule_id] = { count: 0, rule_name: v.rule_name, violations: [] };
        }
        acc[v.rule_id].count++;
        acc[v.rule_id].violations.push(v);
        return acc;
      }, {} as Record<string, { count: number; rule_name: string; violations: any[] }>);
      
      const totalViolations = violations.length;
      
      if (totalViolations > 0) {
        const errorRules = Object.values(violationsByRule).filter(r => r.rule_name.includes('error'));
        const warningRules = Object.values(violationsByRule).filter(r => r.rule_name.includes('warning'));
        
        return {
          valid: errorRules.length === 0,
          check_id: 'biz-custom-rules',
          check_name: 'Custom Business Rules',
          severity: errorRules.length > 0 ? 'error' : 'warning',
          message: `${totalViolations} business rule violation(s) found across ${Object.keys(violationsByRule).length} rule(s)`,
          details: { violations_by_rule: violationsByRule },
          timestamp: new Date().toISOString()
        };
      }
      
      return {
        valid: true,
        check_id: 'biz-custom-rules',
        check_name: 'Custom Business Rules',
        severity: 'info',
        message: 'All custom business rules passed',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      return {
        valid: false,
        check_id: 'biz-custom-rules',
        check_name: 'Custom Business Rules',
        severity: 'error',
        message: `Failed to check custom business rules: ${error instanceof Error ? error.message : 'Unknown error'}`,
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

export default BusinessRuleValidator;
