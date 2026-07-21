// Core validation result types
export interface ValidationResult {
  valid: boolean;
  check_id: string;
  check_name: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  details?: any;
  timestamp: string;
}

export interface ValidationReport {
  valid: boolean;
  namespace: string;
  database: string;
  timestamp: string;
  checks: ValidationResult[];
  summary: {
    total: number;
    passed: number;
    failed: number;
    warnings: number;
    errors: number;
  };
  execution_time_ms: number;
}

// Validator interface
export interface Validator {
  validate(namespace: string, database: string): Promise<ValidationReport>;
}

// Validation rule types
export interface ValidationRule {
  id: string;
  name: string;
  description: string;
  severity: 'error' | 'warning' | 'info';
  validate: (context: ValidationContext) => Promise<ValidationResult>;
}

export interface ValidationContext {
  namespace: string;
  database: string;
  surrealClient: { query: (sql: string) => Promise<any[]> };
  metadata?: Record<string, any>;
}

// Performance threshold types
export interface PerformanceThresholds {
  max_query_time_ms: number;
  max_result_size: number;
  max_memory_mb: number;
  max_cpu_percent: number;
}

// Business rule types
export interface BusinessRule {
  id: string;
  name: string;
  condition: (data: any) => boolean;
  message: string;
  severity: 'error' | 'warning' | 'info';
}

// Graph consistency types
export interface GraphConsistencyRules {
  no_self_references: boolean;
  no_orphan_nodes: boolean;
  no_orphan_edges: boolean;
  valid_relationship_types: string[];
  max_path_length: number;
  require_bidirectional: boolean;
  allowed_node_types: string[];
}

// Data integrity types
export interface DataIntegrityRules {
  required_node_fields: string[];
  required_edge_fields: string[];
  field_type_validations: Record<string, string>;
  referential_integrity: boolean;
  namespace_consistency: boolean;
}

// Schema validation types
export interface SchemaValidationRules {
  strict_mode: boolean;
  allow_unknown_properties: boolean;
  required_properties: Record<string, string[]>;
  property_types: Record<string, Record<string, string>>;
}
