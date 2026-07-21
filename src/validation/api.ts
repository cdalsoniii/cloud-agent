import { ValidationOrchestrator } from './orchestrator.js';
import { ValidationReport } from './types.js';

/**
 * Validation API handlers for HTTP endpoints
 */
export class ValidationAPI {
  private orchestrator: ValidationOrchestrator;

  constructor(orchestrator?: ValidationOrchestrator) {
    this.orchestrator = orchestrator || new ValidationOrchestrator();
  }

  /**
   * Run full validation
   */
  async runValidation(
    namespace: string = 'main',
    database: string = 'main'
  ): Promise<{ status: string; report: ValidationReport }> {
    const report = await this.orchestrator.validateAll(namespace, database);
    
    return {
      status: report.valid ? 'passed' : 'failed',
      report
    };
  }

  /**
   * Run subset of validators
   */
  async runValidationSubset(
    engines: Array<'consistency' | 'integrity' | 'performance' | 'business'>,
    namespace: string = 'main',
    database: string = 'main'
  ): Promise<{ status: string; report: ValidationReport }> {
    const report = await this.orchestrator.validateSubset(engines, namespace, database);
    
    return {
      status: report.valid ? 'passed' : 'failed',
      report
    };
  }

  /**
   * Check health status
   */
  async checkHealth(
    namespace: string = 'main',
    database: string = 'main'
  ): Promise<{ healthy: boolean; status: string; summary: any }> {
    const { healthy, report } = await this.orchestrator.isHealthy(namespace, database);
    
    return {
      healthy,
      status: healthy ? 'healthy' : 'unhealthy',
      summary: {
        total_checks: report.summary.total,
        passed: report.summary.passed,
        failed: report.summary.failed,
        warnings: report.summary.warnings,
        errors: report.summary.errors
      }
    };
  }

  /**
   * Get validation statistics
   */
  async getStats(
    namespace: string = 'main',
    database: string = 'main'
  ): Promise<{
    total_checks: number;
    passed: number;
    failed: number;
    warnings: number;
    errors: number;
    validation_time_ms: number;
    healthy: boolean;
  }> {
    return this.orchestrator.getValidationStats(namespace, database);
  }

  /**
   * Validate a specific entity
   */
  async validateEntity(
    entity: any,
    entityType: 'node' | 'edge',
    namespace: string = 'main',
    database: string = 'main'
  ): Promise<{ valid: boolean; result: any }> {
    const result = await this.orchestrator.validateEntity(entity, entityType, namespace, database);
    
    return {
      valid: result.valid,
      result
    };
  }
}

// Export singleton instance
export const validationAPI = new ValidationAPI();

export default ValidationAPI;
