import { ValidationReport, ValidationResult, ValidationContext, Validator } from './types.js';
import { GraphConsistencyValidator } from './engines/consistency.js';
import { DataIntegrityValidator } from './engines/integrity.js';
import { PerformanceValidator } from './engines/performance.js';
import { BusinessRuleValidator } from './engines/business.js';
import { surrealQueryResults } from '../simple-surreal-client.js';

/**
 * Validation Orchestrator
 * Runs all validation engines and produces comprehensive reports
 */
export class ValidationOrchestrator {
  private validators: Validator[];
  private defaultNamespace: string = 'main';
  private defaultDatabase: string = 'main';

  constructor(config?: {
    validators?: Validator[];
    namespace?: string;
    database?: string;
  }) {
    if (config?.validators) {
      this.validators = config.validators;
    } else {
      this.validators = [
        new GraphConsistencyValidator(),
        new DataIntegrityValidator(),
        new PerformanceValidator(),
        new BusinessRuleValidator()
      ];
    }
    
    if (config?.namespace) {
      this.defaultNamespace = config.namespace;
    }
    if (config?.database) {
      this.defaultDatabase = config.database;
    }
  }

  /**
   * Run all validation engines and produce comprehensive report
   */
  async validateAll(
    namespace: string = this.defaultNamespace,
    database: string = this.defaultDatabase
  ): Promise<ValidationReport> {
    const startTime = Date.now();
    const reports: ValidationReport[] = [];

    // Run all validators in parallel
    const results = await Promise.allSettled(
      this.validators.map(validator => validator.validate(namespace, database))
    );

    for (const result of results) {
      if (result.status === 'fulfilled') {
        reports.push(result.value);
      } else {
        // Create error report for failed validation
        reports.push({
          valid: false,
          namespace,
          database,
          timestamp: new Date().toISOString(),
          checks: [{
            valid: false,
            check_id: 'orchestrator-error',
            check_name: 'Validation Engine Error',
            severity: 'error',
            message: `Validation engine failed: ${result.reason}`,
            timestamp: new Date().toISOString()
          }],
          summary: {
            total: 1,
            passed: 0,
            failed: 1,
            warnings: 0,
            errors: 1
          },
          execution_time_ms: 0
        });
      }
    }

    // Merge all reports into a single comprehensive report
    const mergedReport = this.mergeReports(reports, namespace, database, Date.now() - startTime);
    
    // Log validation results
    this.logValidationResults(mergedReport);
    
    return mergedReport;
  }

  /**
   * Run only specific validation engines
   */
  async validateSubset(
    engineNames: Array<'consistency' | 'integrity' | 'performance' | 'business'>,
    namespace: string = this.defaultNamespace,
    database: string = this.defaultDatabase
  ): Promise<ValidationReport> {
    const validatorMap = {
      'consistency': new GraphConsistencyValidator(),
      'integrity': new DataIntegrityValidator(),
      'performance': new PerformanceValidator(),
      'business': new BusinessRuleValidator()
    };

    const selectedValidators = engineNames.map(name => validatorMap[name]).filter(Boolean);
    
    const orchestrator = new ValidationOrchestrator({
      validators: selectedValidators,
      namespace,
      database
    });
    
    return orchestrator.validateAll(namespace, database);
  }

  /**
   * Validate a single node/edge before insertion/update
   */
  async validateEntity(
    entity: any,
    entityType: 'node' | 'edge',
    namespace: string = this.defaultNamespace,
    database: string = this.defaultDatabase
  ): Promise<ValidationResult> {
    const context: ValidationContext = {
      namespace,
      database,
      surrealClient: { query: surrealQueryResults }
    };

    // Check required fields
    const requiredFields = entityType === 'node'
      ? ['node_id', 'node_type', 'name', 'namespace', 'database']
      : ['edge_id', 'source_id', 'target_id', 'relationship_type', 'namespace', 'database'];

    const missingFields = requiredFields.filter(field => !entity[field]);
    
    if (missingFields.length > 0) {
      return {
        valid: false,
        check_id: 'entity-required-fields',
        check_name: 'Required Fields',
        severity: 'error',
        message: `Missing required fields: ${missingFields.join(', ')}`,
        details: { missing_fields: missingFields, entity },
        timestamp: new Date().toISOString()
      };
    }

    // Check namespace consistency
    if (entity.namespace !== namespace || entity.database !== database) {
      return {
        valid: false,
        check_id: 'entity-namespace',
        check_name: 'Namespace Consistency',
        severity: 'warning',
        message: `Entity namespace/database (${entity.namespace}/${entity.database}) doesn't match target (${namespace}/${database})`,
        details: { entity, target_namespace: namespace, target_database: database },
        timestamp: new Date().toISOString()
      };
    }

    // Check ID format (alphanumeric, underscores, hyphens)
    const idField = entityType === 'node' ? 'node_id' : 'edge_id';
    const idPattern = /^[a-zA-Z0-9_-]+$/;
    if (!idPattern.test(entity[idField])) {
      return {
        valid: false,
        check_id: 'entity-id-format',
        check_name: 'ID Format',
        severity: 'error',
        message: `${idField} must be alphanumeric with underscores and hyphens only`,
        details: { [idField]: entity[idField] },
        timestamp: new Date().toISOString()
      };
    }

    // For edges, check that source and target nodes exist
    if (entityType === 'edge') {
      const sourceExists = await context.surrealClient.query(
        `SELECT node_id FROM ontology_node WHERE node_id = "${entity.source_id}" AND namespace = "${namespace}" AND database = "${database}"`
      );
      
      const targetExists = await context.surrealClient.query(
        `SELECT node_id FROM ontology_node WHERE node_id = "${entity.target_id}" AND namespace = "${namespace}" AND database = "${database}"`
      );

      if (sourceExists.length === 0 || targetExists.length === 0) {
        return {
          valid: false,
          check_id: 'entity-references',
          check_name: 'Entity References',
          severity: 'error',
          message: `Edge references non-existent nodes: source_exists=${sourceExists.length > 0}, target_exists=${targetExists.length > 0}`,
          details: { source_id: entity.source_id, target_id: entity.target_id },
          timestamp: new Date().toISOString()
        };
      }
    }

    return {
      valid: true,
      check_id: 'entity-validation',
      check_name: 'Entity Validation',
      severity: 'info',
      message: `${entityType} entity is valid`,
      details: { entity_type: entityType, [idField]: entity[idField] },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Check if graph is healthy (all validators pass)
   */
  async isHealthy(
    namespace: string = this.defaultNamespace,
    database: string = this.defaultDatabase
  ): Promise<{ healthy: boolean; report: ValidationReport }> {
    const report = await this.validateAll(namespace, database);
    
    return {
      healthy: report.valid && report.summary.errors === 0,
      report
    };
  }

  /**
   * Get validation statistics
   */
  async getValidationStats(
    namespace: string = this.defaultNamespace,
    database: string = this.defaultDatabase
  ): Promise<{
    total_checks: number;
    passed: number;
    failed: number;
    warnings: number;
    errors: number;
    validation_time_ms: number;
    healthy: boolean;
  }> {
    const report = await this.validateAll(namespace, database);
    
    return {
      total_checks: report.summary.total,
      passed: report.summary.passed,
      failed: report.summary.failed,
      warnings: report.summary.warnings,
      errors: report.summary.errors,
      validation_time_ms: report.execution_time_ms,
      healthy: report.valid && report.summary.errors === 0
    };
  }

  /**
   * Merge multiple validation reports into one comprehensive report
   */
  private mergeReports(
    reports: ValidationReport[],
    namespace: string,
    database: string,
    totalExecutionTime: number
  ): ValidationReport {
    const allChecks = reports.flatMap(r => r.checks);
    
    const totalErrors = allChecks.filter(c => c.severity === 'error' && !c.valid).length;
    const totalWarnings = allChecks.filter(c => c.severity === 'warning' && !c.valid).length;
    const totalPassed = allChecks.filter(c => c.valid).length;
    
    return {
      valid: totalErrors === 0,
      namespace,
      database,
      timestamp: new Date().toISOString(),
      checks: allChecks,
      summary: {
        total: allChecks.length,
        passed: totalPassed,
        failed: allChecks.length - totalPassed,
        warnings: totalWarnings,
        errors: totalErrors
      },
      execution_time_ms: totalExecutionTime
    };
  }

  /**
   * Log validation results
   */
  private logValidationResults(report: ValidationReport): void {
    console.log(`\n=== Validation Report for ${report.namespace}/${report.database} ===`);
    console.log(`Status: ${report.valid ? 'PASSED' : 'FAILED'}`);
    console.log(`Total Checks: ${report.summary.total}`);
    console.log(`Passed: ${report.summary.passed}`);
    console.log(`Failed: ${report.summary.failed}`);
    console.log(`Warnings: ${report.summary.warnings}`);
    console.log(`Errors: ${report.summary.errors}`);
    console.log(`Execution Time: ${report.execution_time_ms}ms`);
    
    if (!report.valid) {
      console.log('\n=== Failed Checks ===');
      for (const check of report.checks) {
        if (!check.valid) {
          console.log(`[${check.severity.toUpperCase()}] ${check.check_name}: ${check.message}`);
          if (check.details) {
            console.log(`  Details:`, JSON.stringify(check.details, null, 2));
          }
        }
      }
    }
    
    console.log('=====================================\n');
  }
}

// Export singleton instance
export const validationOrchestrator = new ValidationOrchestrator();

export default ValidationOrchestrator;
