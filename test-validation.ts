/**
 * Validation Framework Test Script
 * Tests all validation components against the current ontology data
 */

import { ValidationOrchestrator } from './src/validation/orchestrator';
import { ValidationAPI } from './src/validation/api';
import { GraphConsistencyValidator } from './src/validation/engines/consistency';
import { DataIntegrityValidator } from './src/validation/engines/integrity';
import { PerformanceValidator } from './src/validation/engines/performance';
import { BusinessRuleValidator } from './src/validation/engines/business';

async function runValidationTests() {
  console.log('=== Validation Framework Test Suite ===\n');
  
  const namespace = 'main';
  const database = 'main';

  // Test 1: Full validation with all engines
  console.log('Test 1: Running full validation...');
  try {
    const orchestrator = new ValidationOrchestrator();
    const report = await orchestrator.validateAll(namespace, database);
    
    console.log(`Status: ${report.valid ? 'PASSED' : 'FAILED'}`);
    console.log(`Total Checks: ${report.summary.total}`);
    console.log(`Passed: ${report.summary.passed}`);
    console.log(`Failed: ${report.summary.failed}`);
    console.log(`Warnings: ${report.summary.warnings}`);
    console.log(`Errors: ${report.summary.errors}`);
    console.log(`Execution Time: ${report.execution_time_ms}ms\n`);
    
    // Show failed checks
    if (!report.valid) {
      console.log('Failed checks:');
      for (const check of report.checks) {
        if (!check.valid) {
          console.log(`  [${check.severity.toUpperCase()}] ${check.check_name}: ${check.message}`);
        }
      }
    }
  } catch (error) {
    console.error('Test 1 failed:', error);
  }

  // Test 2: Individual validators
  console.log('\nTest 2: Testing individual validators...');
  
  const validators = [
    { name: 'Graph Consistency', validator: new GraphConsistencyValidator() },
    { name: 'Data Integrity', validator: new DataIntegrityValidator() },
    { name: 'Performance', validator: new PerformanceValidator() },
    { name: 'Business Rules', validator: new BusinessRuleValidator() }
  ];
  
  for (const { name, validator } of validators) {
    try {
      console.log(`\n${name}:`);
      const report = await validator.validate(namespace, database);
      console.log(`  Status: ${report.valid ? 'PASSED' : 'FAILED'}`);
      console.log(`  Checks: ${report.summary.total} (passed: ${report.summary.passed}, failed: ${report.summary.failed})`);
      console.log(`  Time: ${report.execution_time_ms}ms`);
    } catch (error) {
      console.error(`  ${name} failed:`, error);
    }
  }

  // Test 3: Validation API
  console.log('\n\nTest 3: Testing Validation API...');
  try {
    const api = new ValidationAPI();
    
    // Health check
    const health = await api.checkHealth(namespace, database);
    console.log(`Health: ${health.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
    console.log(`Status: ${health.status}`);
    
    // Stats
    const stats = await api.getStats(namespace, database);
    console.log(`\nStats: ${stats.total_checks} checks, ${stats.passed} passed, ${stats.errors} errors`);
    
    // Full validation
    const validation = await api.runValidation(namespace, database);
    console.log(`\nFull validation: ${validation.status.toUpperCase()}`);
  } catch (error) {
    console.error('Test 3 failed:', error);
  }

  // Test 4: Entity validation
  console.log('\n\nTest 4: Testing entity validation...');
  try {
    const orchestrator = new ValidationOrchestrator();
    
    // Valid node
    const validNode = {
      node_id: 'test_node_1',
      node_type: 'sdlc_event_type',
      name: 'Test Event',
      description: 'A test event',
      properties: {},
      namespace: 'main',
      database: 'main'
    };
    
    const nodeResult = await orchestrator.validateEntity(validNode, 'node', namespace, database);
    console.log(`Valid node: ${nodeResult.valid ? 'PASSED' : 'FAILED'} - ${nodeResult.message}`);
    
    // Invalid node (missing required field)
    const invalidNode = {
      node_id: 'test_node_2',
      node_type: 'invalid_type',
      name: 'Invalid Node',
      namespace: 'main',
      database: 'main'
    };
    
    const invalidResult = await orchestrator.validateEntity(invalidNode, 'node', namespace, database);
    console.log(`Invalid node: ${invalidResult.valid ? 'PASSED' : 'FAILED'} - ${invalidResult.message}`);
    
  } catch (error) {
    console.error('Test 4 failed:', error);
  }

  console.log('\n=== Test Suite Complete ===');
}

runValidationTests().catch(console.error);
