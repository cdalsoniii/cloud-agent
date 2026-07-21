/**
 * Validation Runner - Command Line Interface
 * 
 * Usage:
 *   npx tsx src/validation/run-validation.ts [options]
 * 
 * Options:
 *   --engines <list>    Run specific engines (comma-separated: consistency,integrity,performance,business)
 *   --namespace <ns>    Namespace to validate (default: main)
 *   --database <db>     Database to validate (default: main)
 *   --format <format>   Output format (json, table, summary) (default: table)
 *   --health            Only run health check
 *   --stats             Only show statistics
 *   --entity            Validate a specific entity (requires --entity-type, --entity-data)
 *   --entity-type       Entity type (node or edge)
 *   --entity-data       JSON string of entity data
 *   --help              Show help
 */

import { ValidationOrchestrator } from './orchestrator.js';
import { ValidationAPI } from './api.js';

function parseArgs(): Record<string, string> {
  const args: Record<string, string> = {};
  const argv = process.argv.slice(2);
  
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.replace('--', '');
      const value = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true';
      args[key] = value;
      if (value !== 'true') i++;
    }
  }
  
  return args;
}

function printHelp() {
  console.log(`
Validation Runner - Command Line Interface

Usage:
  npx tsx src/validation/run-validation.ts [options]

Options:
  --engines <list>    Run specific engines (comma-separated: consistency,integrity,performance,business)
  --namespace <ns>    Namespace to validate (default: main)
  --database <db>     Database to validate (default: main)
  --format <format>   Output format (json, table, summary) (default: table)
  --health            Only run health check
  --stats             Only show statistics
  --entity            Validate a specific entity (requires --entity-type, --entity-data)
  --entity-type       Entity type (node or edge)
  --entity-data       JSON string of entity data
  --help              Show help

Examples:
  # Run full validation
  npx tsx src/validation/run-validation.ts

  # Run only consistency and integrity checks
  npx tsx src/validation/run-validation.ts --engines consistency,integrity

  # Health check in JSON format
  npx tsx src/validation/run-validation.ts --health --format json

  # Validate specific entity
  npx tsx src/validation/run-validation.ts --entity --entity-type node --entity-data '{"node_id":"test","node_type":"sdlc_event_type","name":"Test"}'
`);
}

async function main() {
  const args = parseArgs();
  
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  
  const namespace = args.namespace || 'main';
  const database = args.database || 'main';
  const format = args.format || 'table';
  
  console.log(`Validation Runner - ${namespace}/${database}`);
  console.log('=' .repeat(60));
  
  try {
    if (args.health) {
      // Health check only
      const api = new ValidationAPI();
      const result = await api.checkHealth(namespace, database);
      
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Health: ${result.healthy ? 'HEALTHY' : 'UNHEALTHY'}`);
        console.log(`Status: ${result.status}`);
        console.log(`Summary: ${result.summary.total_checks} checks, ${result.summary.passed} passed, ${result.summary.errors} errors`);
      }
      
      process.exit(result.healthy ? 0 : 1);
    }
    
    if (args.stats) {
      // Statistics only
      const api = new ValidationAPI();
      const result = await api.getStats(namespace, database);
      
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log('Validation Statistics');
        console.log('---------------------');
        console.log(`Total Checks: ${result.total_checks}`);
        console.log(`Passed: ${result.passed}`);
        console.log(`Failed: ${result.failed}`);
        console.log(`Warnings: ${result.warnings}`);
        console.log(`Errors: ${result.errors}`);
        console.log(`Validation Time: ${result.validation_time_ms}ms`);
        console.log(`Healthy: ${result.healthy ? 'Yes' : 'No'}`);
      }
      
      process.exit(0);
    }
    
    if (args.entity) {
      // Validate specific entity
      const entityType = (args['entity-type'] as 'node' | 'edge') || 'node';
      const entityData = args['entity-data'] ? JSON.parse(args['entity-data']) : {};
      
      const orchestrator = new ValidationOrchestrator();
      const result = await orchestrator.validateEntity(entityData, entityType, namespace, database);
      
      if (format === 'json') {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(`Entity Validation: ${result.valid ? 'VALID' : 'INVALID'}`);
        console.log(`Message: ${result.message}`);
        if (result.details) {
          console.log(`Details:`, JSON.stringify(result.details, null, 2));
        }
      }
      
      process.exit(result.valid ? 0 : 1);
    }
    
    // Run full or subset validation
    const api = new ValidationAPI();
    let result;
    
    if (args.engines) {
      const engines = args.engines.split(',') as Array<'consistency' | 'integrity' | 'performance' | 'business'>;
      const validEngines = engines.filter(e => ['consistency', 'integrity', 'performance', 'business'].includes(e));
      
      if (validEngines.length === 0) {
        console.error('No valid engines specified. Available: consistency, integrity, performance, business');
        process.exit(1);
      }
      
      result = await api.runValidationSubset(validEngines, namespace, database);
    } else {
      result = await api.runValidation(namespace, database);
    }
    
    if (format === 'json') {
      console.log(JSON.stringify(result, null, 2));
    } else if (format === 'summary') {
      console.log(`Status: ${result.status.toUpperCase()}`);
      console.log(`Total: ${result.report.summary.total}`);
      console.log(`Passed: ${result.report.summary.passed}`);
      console.log(`Failed: ${result.report.summary.failed}`);
      console.log(`Warnings: ${result.report.summary.warnings}`);
      console.log(`Errors: ${result.report.summary.errors}`);
      console.log(`Time: ${result.report.execution_time_ms}ms`);
    } else {
      // Table format
      console.log('\nValidation Results');
      console.log('=' .repeat(60));
      console.log(`Status: ${result.status.toUpperCase()}`);
      console.log(`Total Checks: ${result.report.summary.total}`);
      console.log(`Passed: ${result.report.summary.passed}`);
      console.log(`Failed: ${result.report.summary.failed}`);
      console.log(`Warnings: ${result.report.summary.warnings}`);
      console.log(`Errors: ${result.report.summary.errors}`);
      console.log(`Execution Time: ${result.report.execution_time_ms}ms`);
      
      if (result.report.checks.length > 0) {
        console.log('\nDetailed Results');
        console.log('-'.repeat(60));
        console.log(`${'Check Name'.padEnd(30)} ${'Status'.padEnd(10)} ${'Severity'.padEnd(10)}`);
        console.log('-'.repeat(60));
        
        for (const check of result.report.checks) {
          const status = check.valid ? 'PASS' : 'FAIL';
          const severity = check.severity.toUpperCase().padEnd(8);
          console.log(`${check.check_name.padEnd(30)} ${status.padEnd(10)} ${severity}`);
          
          if (!check.valid && check.message) {
            console.log(`  ${check.message}`);
          }
        }
      }
    }
    
    process.exit(result.status === 'passed' ? 0 : 1);
    
  } catch (error) {
    console.error('Validation failed:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
