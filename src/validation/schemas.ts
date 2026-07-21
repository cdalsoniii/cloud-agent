import { z } from 'zod';

// Ontology Node Schema
export const OntologyNodeSchema = z.object({
  node_id: z.string().min(1).regex(/^[a-zA-Z0-9_-]+$/, {
    message: 'node_id must be alphanumeric with underscores and hyphens only'
  }),
  node_type: z.enum([
    'sdlc_event_type', 'ai_model', 'repository', 'sdlc_phase',
    'user', 'team', 'project', 'artifact', 'sandbox', 'custom'
  ]),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  properties: z.record(z.any()).optional(),
  namespace: z.string().default('main'),
  database: z.string().default('main'),
  created_at: z.string().datetime().optional(),
  updated_at: z.string().datetime().optional()
});

// Ontology Edge Schema
export const OntologyEdgeSchema = z.object({
  edge_id: z.string().min(1),
  source_id: z.string().min(1),
  target_id: z.string().min(1),
  relationship_type: z.enum([
    'uses_model', 'targets_repo', 'belongs_to_phase', 'follows_event',
    'depends_on', 'references', 'created_by', 'owns', 'part_of', 'custom'
  ]),
  weight: z.number().min(0).max(1).default(1),
  properties: z.record(z.any()).optional(),
  namespace: z.string().default('main'),
  database: z.string().default('main'),
  created_at: z.string().datetime().optional()
});

// SDLC Event Schema
export const SDLCEventSchema = z.object({
  event_id: z.string().min(1),
  event_type: z.string().min(1),
  phase: z.string().optional(),
  repo_target: z.string().optional(),
  model_id: z.string().optional(),
  model_provider: z.string().optional(),
  tokens_in: z.number().nonnegative().optional(),
  tokens_out: z.number().nonnegative().optional(),
  cost_usd: z.number().nonnegative().optional(),
  sandbox_id: z.string().optional(),
  parent_event_id: z.string().optional(),
  ontology_namespace: z.string().default('main'),
  ontology_database: z.string().default('main')
});

// Validation Configuration Schema
export const ValidationConfigSchema = z.object({
  enabled: z.boolean().default(true),
  strict_mode: z.boolean().default(false),
  auto_fix: z.boolean().default(false),
  log_level: z.enum(['error', 'warning', 'info', 'debug']).default('info'),
  performance: z.object({
    max_query_time_ms: z.number().positive().default(5000),
    max_result_size: z.number().positive().default(10000),
    max_memory_mb: z.number().positive().default(512)
  }).default({}),
  business_rules: z.object({
    cost_threshold: z.number().positive().default(100),
    token_ratio_threshold: z.number().positive().default(10),
    max_tokens_per_request: z.number().positive().default(100000)
  }).default({}),
  graph_consistency: z.object({
    no_self_references: z.boolean().default(true),
    no_orphan_nodes: z.boolean().default(true),
    no_orphan_edges: z.boolean().default(true),
    max_path_length: z.number().positive().default(10)
  }).default({})
});

export type ValidatedOntologyNode = z.infer<typeof OntologyNodeSchema>;
export type ValidatedOntologyEdge = z.infer<typeof OntologyEdgeSchema>;
export type ValidatedSDLCEvent = z.infer<typeof SDLCEventSchema>;
export type ValidationConfig = z.infer<typeof ValidationConfigSchema>;
