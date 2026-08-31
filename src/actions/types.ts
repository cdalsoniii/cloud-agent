/**
 * Action Suggestion Framework Types
 * Comprehensive type definitions for ontology-driven action suggestions
 */

// Action type enum
export type ActionType = 'validation' | 'enrichment' | 'optimization' | 'business' | 'research' | 'integration';

// Action priority levels
export type ActionPriority = 'critical' | 'high' | 'medium' | 'low';

// Action status
export type ActionStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'dismissed';

// Action execution result
export interface ActionResult {
  success: boolean;
  message: string;
  data?: any;
  execution_time_ms: number;
  executed_by?: string;
  error?: string;
  stack_trace?: string;
}

// Core ontology action interface
export interface OntologyAction {
  id: string;
  type: ActionType;
  priority: ActionPriority;
  status: ActionStatus;
  title: string;
  description: string;
  target: string; // node_id, edge_id, or pattern
  suggested_command: string;
  validation_check_id?: string;
  estimated_effort: number; // minutes
  prerequisites?: string[];
  impact_score: number; // 1-10
  category: string;
  tags: string[];
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
  executed_at?: string;
  result?: ActionResult;
}

// Action panel section for UI rendering
export interface ActionPanelSection {
  title: string;
  actions: OntologyAction[];
  icon?: string;
  collapsible?: boolean;
  collapsed_by_default?: boolean;
  description?: string;
}

// Action panel for UI rendering
export interface ActionPanel {
  title: string;
  sections: ActionPanelSection[];
  metadata?: Record<string, any>;
  total_actions: number;
  critical_count: number;
  high_count: number;
  medium_count: number;
  low_count: number;
  completed_count: number;
  pending_count: number;
  failed_count: number;
}

// Action filtering options
export interface ActionFilter {
  types?: ActionType[];
  priorities?: ActionPriority[];
  categories?: string[];
  tags?: string[];
  status?: ActionStatus[];
  search?: string;
  min_impact?: number;
  max_effort?: number;
  validation_check_id?: string;
  target_pattern?: string;
  has_been_executed?: boolean;
  created_after?: string;
  created_before?: string;
}

// Action sorting options
export interface ActionSortOptions {
  field: 'priority' | 'impact_score' | 'estimated_effort' | 'created_at' | 'impact_effort_ratio' | 'updated_at' | 'status';
  direction: 'asc' | 'desc';
}

// Suggester configuration
export interface ActionSuggesterConfig {
  enabled_generators: string[];
  auto_execute_critical: boolean;
  max_actions_per_run: number;
  max_suggestions_per_category: number;
  include_already_executed: boolean;
  custom_rules?: any[];
  prioritize_by_impact_effort: boolean;
  minimum_impact_threshold: number;
  maximum_effort_threshold: number;
  auto_dismiss_completed: boolean;
  notification_settings: {
    on_critical: boolean;
    on_high: boolean;
    on_medium: boolean;
    on_low: boolean;
    on_completion: boolean;
    on_failure: boolean;
  };
}

// Action context for generators
export interface ActionContext {
  namespace: string;
  database: string;
  validationReport?: any; // ValidationReport from validation framework
  ontologyState?: any; // Snapshot of current ontology state
  timestamp: string;
  metadata?: Record<string, any>;
}

// Action generator interface
export interface ActionGenerator {
  generateActions(context: ActionContext): Promise<OntologyAction[]>;
  getName(): string;
  getDescription(): string;
  isEnabled(): boolean;
  getPriority(): number; // Generator priority order
  getCategories(): string[]; // Categories this generator produces
}

// Action execution configuration
export interface ActionExecutionConfig {
  max_concurrency: number;
  retry_count: number;
  retry_delay_ms: number;
  timeout_ms: number;
  validate_before_execute: boolean;
  dry_run: boolean;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  on_critical: 'execute' | 'prompt' | 'skip';
  on_high: 'execute' | 'prompt' | 'skip';
  on_medium: 'execute' | 'prompt' | 'skip';
  on_low: 'execute' | 'prompt' | 'skip';
}

// Action history entry
export interface ActionHistoryEntry {
  id: string;
  action: OntologyAction;
  result: ActionResult;
  executed_at: string;
  duration_ms: number;
  user_id?: string;
  session_id?: string;
  command_executed?: string;
  output?: any;
}

// Action summary statistics
export interface ActionSummary {
  total_actions: number;
  by_type: Record<string, number>;
  by_priority: Record<string, number>;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  total_executed: number;
  total_successful: number;
  total_failed: number;
  total_dismissed: number;
  average_execution_time_ms: number;
  total_estimated_effort_minutes: number;
  total_actual_effort_minutes: number;
  top_actions: OntologyAction[];
  recent_actions: OntologyAction[];
  action_trend: { period: string; created: number; executed: number; completed: number }[];
}

// UI rendering options
export interface UIRenderOptions {
  format: 'html' | 'markdown' | 'json' | 'table' | 'csv';
  max_items?: number;
  include_details?: boolean;
  include_commands?: boolean;
  color_scheme?: 'light' | 'dark' | 'auto';
  compact_mode?: boolean;
  show_icons?: boolean;
  show_progress?: boolean;
  group_by?: 'priority' | 'type' | 'category' | 'status';
  sort_by?: ActionSortOptions;
  filter?: ActionFilter;
}

// Default config values
export const DEFAULT_SUGGESTER_CONFIG: ActionSuggesterConfig = {
  enabled_generators: ['validation', 'enrichment', 'optimization', 'business'],
  auto_execute_critical: false,
  max_actions_per_run: 50,
  max_suggestions_per_category: 10,
  include_already_executed: false,
  prioritize_by_impact_effort: true,
  minimum_impact_threshold: 1,
  maximum_effort_threshold: 120,
  auto_dismiss_completed: true,
  notification_settings: {
    on_critical: true,
    on_high: true,
    on_medium: false,
    on_low: false,
    on_completion: true,
    on_failure: true,
  },
};

export const DEFAULT_EXECUTION_CONFIG: ActionExecutionConfig = {
  max_concurrency: 3,
  retry_count: 2,
  retry_delay_ms: 1000,
  timeout_ms: 30000,
  validate_before_execute: true,
  dry_run: false,
  log_level: 'info',
  on_critical: 'prompt',
  on_high: 'prompt',
  on_medium: 'prompt',
  on_low: 'skip',
};

// Priority scoring for sorting
export const PRIORITY_SCORES: Record<ActionPriority, number> = {
  critical: 100,
  high: 75,
  medium: 50,
  low: 25,
};

// Impact/effort calculation
export function calculateImpactEffortRatio(action: OntologyAction): number {
  const priorityMultiplier = PRIORITY_SCORES[action.priority] / 100;
  const impact = action.impact_score * priorityMultiplier;
  const effort = Math.max(action.estimated_effort, 1); // Avoid division by zero
  return impact / effort;
}
