/**
 * Validation Framework - Main Entry Point
 * 
 * Provides comprehensive validation for the ontology system:
 * - Schema validation (Zod schemas)
 * - Graph consistency (self-references, orphan nodes, circular references)
 * - Data integrity (missing fields, type mismatches, referential integrity)
 * - Performance monitoring (query time, result size, memory usage)
 * - Business rules (cost thresholds, token ratios, negative values)
 */

// Core types and schemas
export * from './types.js';
export * from './schemas.js';

// Validation engines
export { GraphConsistencyValidator } from './engines/consistency.js';
export { DataIntegrityValidator } from './engines/integrity.js';
export { PerformanceValidator } from './engines/performance.js';
export { BusinessRuleValidator } from './engines/business.js';

// Orchestration and API
export { ValidationOrchestrator, validationOrchestrator } from './orchestrator.js';
export { ValidationAPI, validationAPI } from './api.js';
