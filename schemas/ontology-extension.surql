// SurrealDB Ontology Extension Schema for ChartDB-style relationships
// Comprehensive graph relationships with namespace/database awareness
// Run: surreal import --endpoint http://127.0.0.1:8000 --ns cloud-agent --db rules schemas/ontology-extension.surql

-- ==================== ONTOLOGY NODES ====================
DEFINE TABLE ontology_node SCHEMAFULL;
DEFINE FIELD node_id ON ontology_node TYPE string ASSERT $value != NONE;
DEFINE FIELD node_type ON ontology_node TYPE string ASSERT $value IN [
  'concept', 'entity', 'property', 'relationship', 'rule', 'constraint',
  'sdlc_phase', 'verification_type', 'chain_specialty', 'feedback_pattern',
  'file_type', 'code_pattern', 'test_type', 'deployment_target', 'infrastructure_component',
  'sdlc_event_type', 'ai_model', 'repository', 'sandbox'
];
DEFINE FIELD name ON ontology_node TYPE string;
DEFINE FIELD description ON ontology_node TYPE string;
DEFINE FIELD properties ON ontology_node TYPE object;
DEFINE FIELD namespace ON ontology_node TYPE string DEFAULT 'main';
DEFINE FIELD database ON ontology_node TYPE string DEFAULT 'main';
DEFINE FIELD created_at ON ontology_node TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON ontology_node TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_node_type ON ontology_node FIELDS node_type;
DEFINE INDEX idx_node_name ON ontology_node FIELDS name;
DEFINE INDEX idx_namespace_db ON ontology_node FIELDS namespace, database;

-- ==================== ONTOLOGY EDGES (RELATIONSHIPS) ====================
DEFINE TABLE ontology_edge SCHEMAFULL;
DEFINE FIELD edge_id ON ontology_edge TYPE string ASSERT $value != NONE;
DEFINE FIELD source_id ON ontology_edge TYPE string;
DEFINE FIELD target_id ON ontology_edge TYPE string;
DEFINE FIELD relationship_type ON ontology_edge TYPE string ASSERT $value IN [
  'inherits', 'implements', 'depends_on', 'contains', 'validates', 
  'references', 'composes', 'extends', 'triggers', 'causes', 'prevents',
  'belongs_to', 'associated_with', 'version_of', 'migrates_to', 'replaces',
  'occurs_in', 'targets', 'uses', 'follows'
];
DEFINE FIELD weight ON ontology_edge TYPE float DEFAULT 1.0;
DEFINE FIELD properties ON ontology_edge TYPE object;
DEFINE FIELD namespace ON ontology_edge TYPE string DEFAULT 'main';
DEFINE FIELD database ON ontology_edge TYPE string DEFAULT 'main';
DEFINE FIELD created_at ON ontology_edge TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_source_target ON ontology_edge FIELDS source_id, target_id;
DEFINE INDEX idx_relationship ON ontology_edge FIELDS relationship_type;
DEFINE INDEX idx_weight ON ontology_edge FIELDS weight;
DEFINE INDEX idx_namespace_db ON ontology_edge FIELDS namespace, database;

-- ==================== ONTOLOGY RULES ENGINE ====================
DEFINE TABLE ontology_rule SCHEMAFULL;
DEFINE FIELD rule_id ON ontology_rule TYPE string ASSERT $value != NONE;
DEFINE FIELD rule_type ON ontology_rule TYPE string ASSERT $value IN [
  'constraint', 'validation', 'inference', 'transformation', 'consistency',
  'integrity', 'business_rule', 'data_quality', 'compliance'
];
DEFINE FIELD rule_condition ON ontology_rule TYPE string;
DEFINE FIELD rule_action ON ontology_rule TYPE string;
DEFINE FIELD applies_to ON ontology_rule TYPE array;
DEFINE FIELD priority ON ontology_rule TYPE int DEFAULT 1;
DEFINE FIELD enabled ON ontology_rule TYPE bool DEFAULT true;
DEFINE FIELD namespace ON ontology_rule TYPE string DEFAULT 'main';
DEFINE FIELD database ON ontology_rule TYPE string DEFAULT 'main';
DEFINE FIELD created_at ON ontology_rule TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_rule_type ON ontology_rule FIELDS rule_type;
DEFINE INDEX idx_enabled ON ontology_rule FIELDS enabled;
DEFINE INDEX idx_namespace_db ON ontology_rule FIELDS namespace, database;

-- ==================== ONTOLOGY EVENT TRACKING ====================
DEFINE TABLE ontology_event SCHEMAFULL;
DEFINE FIELD event_id ON ontology_event TYPE string ASSERT $value != NONE;
DEFINE FIELD event_type ON ontology_event TYPE string ASSERT $value IN [
  'node_created', 'node_updated', 'node_deleted',
  'edge_created', 'edge_updated', 'edge_deleted',
  'rule_created', 'rule_updated', 'rule_deleted',
  'rule_applied', 'constraint_violated', 'inference_made'
];
DEFINE FIELD target_id ON ontology_event TYPE string;
DEFINE FIELD target_type ON ontology_event TYPE string;
DEFINE FIELD payload ON ontology_event TYPE object;
DEFINE FIELD namespace ON ontology_event TYPE string;
DEFINE FIELD database ON ontology_event TYPE string;
DEFINE FIELD created_at ON ontology_event TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_event_type ON ontology_event FIELDS event_type;
DEFINE INDEX idx_target ON ontology_event FIELDS target_id, target_type;
DEFINE INDEX idx_namespace_db ON ontology_event FIELDS namespace, database;

-- ==================== EXTEND EXISTING SDLC EVENTS ====================
-- Add ontology tracking to existing sdlc_event table
DEFINE FIELD ontology_nodes ON sdlc_event TYPE array;
DEFINE FIELD ontology_edges ON sdlc_event TYPE array;
DEFINE FIELD ontology_rules_applied ON sdlc_event TYPE array;
DEFINE FIELD ontology_namespace ON sdlc_event TYPE string DEFAULT 'main';
DEFINE FIELD ontology_database ON sdlc_event TYPE string DEFAULT 'main';

-- ==================== CROSS-REFERENCE INDEXES ====================
-- Index for quick lookup of ontology elements by SDLC event
DEFINE INDEX idx_sdlc_ontology_nodes ON sdlc_event FIELDS ontology_nodes;
DEFINE INDEX idx_sdlc_ontology_edges ON sdlc_event FIELDS ontology_edges;
DEFINE INDEX idx_sdlc_ontology_rules ON sdlc_event FIELDS ontology_rules_applied;

-- ==================== INITIAL ONTOLOGY DATA ====================
-- Pre-populate with common SDLC concepts
CREATE ontology_node CONTENT {
  node_id: "sdlc_phase_research",
  node_type: "sdlc_phase",
  name: "Research",
  description: "Initial research and requirements gathering phase",
  properties: { order: 1, color: "#4f46e5" },
  namespace: "main",
  database: "main"
};

CREATE ontology_node CONTENT {
  node_id: "sdlc_phase_implement",
  node_type: "sdlc_phase",
  name: "Implementation",
  description: "Code implementation and development phase",
  properties: { order: 4, color: "#10b981" },
  namespace: "main",
  database: "main"
};

CREATE ontology_node CONTENT {
  node_id: "sdlc_phase_verify",
  node_type: "sdlc_phase",
  name: "Verification",
  description: "Testing and verification phase",
  properties: { order: 5, color: "#f59e0b" },
  namespace: "main",
  database: "main"
};

-- Create relationships between phases
CREATE ontology_edge CONTENT {
  edge_id: "phase_flow_research_to_implement",
  source_id: "sdlc_phase_research",
  target_id: "sdlc_phase_implement",
  relationship_type: "precedes",
  weight: 1.0,
  properties: { condition: "research_completed", temporal_order: 1 },
  namespace: "main",
  database: "main"
};

CREATE ontology_edge CONTENT {
  edge_id: "phase_flow_implement_to_verify",
  source_id: "sdlc_phase_implement",
  target_id: "sdlc_phase_verify",
  relationship_type: "precedes",
  weight: 1.0,
  properties: { condition: "implementation_completed", temporal_order: 2 },
  namespace: "main",
  database: "main"
};

-- Create consistency rule
CREATE ontology_rule CONTENT {
  rule_id: "rule_phase_consistency",
  rule_type: "consistency",
  rule_condition: "SELECT * FROM ontology_edge WHERE relationship_type = 'precedes' AND source_id = target_id",
  rule_action: "DELETE FROM ontology_edge WHERE relationship_type = 'precedes' AND source_id = target_id",
  applies_to: ["ontology_edge"],
  priority: 1,
  enabled: true,
  namespace: "main",
  database: "main"
};