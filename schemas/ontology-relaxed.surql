-- Relax ontology constraints to allow SDLC-specific types
-- First, remove existing tables (careful with data!)
REMOVE TABLE IF EXISTS ontology_node;
REMOVE TABLE IF EXISTS ontology_edge;
REMOVE TABLE IF EXISTS ontology_rule;
REMOVE TABLE IF EXISTS ontology_event;

-- ==================== ONTOLOGY NODES (Relaxed) ====================
DEFINE TABLE ontology_node SCHEMAFULL;
DEFINE FIELD node_id ON ontology_node TYPE string ASSERT $value != NONE;
DEFINE FIELD node_type ON ontology_node TYPE string;
DEFINE FIELD name ON ontology_node TYPE string;
DEFINE FIELD description ON ontology_node TYPE string;
DEFINE FIELD properties ON ontology_node TYPE object FLEXIBLE;
DEFINE FIELD namespace ON ontology_node TYPE string DEFAULT 'main';
DEFINE FIELD database ON ontology_node TYPE string DEFAULT 'main';
DEFINE FIELD created_at ON ontology_node TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON ontology_node TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_node_type ON ontology_node FIELDS node_type;
DEFINE INDEX idx_node_name ON ontology_node FIELDS name;
DEFINE INDEX idx_namespace_db ON ontology_node FIELDS namespace, database;

-- ==================== ONTOLOGY EDGES (Relaxed) ====================
DEFINE TABLE ontology_edge SCHEMAFULL;
DEFINE FIELD edge_id ON ontology_edge TYPE string ASSERT $value != NONE;
DEFINE FIELD source_id ON ontology_edge TYPE string;
DEFINE FIELD target_id ON ontology_edge TYPE string;
DEFINE FIELD relationship_type ON ontology_edge TYPE string;
DEFINE FIELD weight ON ontology_edge TYPE float DEFAULT 1.0;
DEFINE FIELD properties ON ontology_edge TYPE object FLEXIBLE;
DEFINE FIELD namespace ON ontology_edge TYPE string DEFAULT 'main';
DEFINE FIELD database ON ontology_edge TYPE string DEFAULT 'main';
DEFINE FIELD created_at ON ontology_edge TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_source_target ON ontology_edge FIELDS source_id, target_id;
DEFINE INDEX idx_relationship ON ontology_edge FIELDS relationship_type;
DEFINE INDEX idx_weight ON ontology_edge FIELDS weight;
DEFINE INDEX idx_namespace_db ON ontology_edge FIELDS namespace, database;

-- ==================== ONTOLOGY RULES (Relaxed) ====================
DEFINE TABLE ontology_rule SCHEMAFULL;
DEFINE FIELD rule_id ON ontology_rule TYPE string ASSERT $value != NONE;
DEFINE FIELD rule_type ON ontology_rule TYPE string;
DEFINE FIELD rule_name ON ontology_rule TYPE string;
DEFINE FIELD description ON ontology_rule TYPE string;
DEFINE FIELD applies_to ON ontology_rule TYPE array;
DEFINE FIELD condition_text ON ontology_rule TYPE string;
DEFINE FIELD rule_condition ON ontology_rule TYPE string;
DEFINE FIELD rule_action ON ontology_rule TYPE string;
DEFINE FIELD priority ON ontology_rule TYPE int DEFAULT 1;
DEFINE FIELD enabled ON ontology_rule TYPE bool DEFAULT true;
DEFINE FIELD namespace ON ontology_rule TYPE string DEFAULT 'main';
DEFINE FIELD database ON ontology_rule TYPE string DEFAULT 'main';
DEFINE FIELD created_at ON ontology_rule TYPE datetime DEFAULT time::now();
DEFINE FIELD updated_at ON ontology_rule TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_rule_type ON ontology_rule FIELDS rule_type;
DEFINE INDEX idx_rule_name ON ontology_rule FIELDS rule_name;
DEFINE INDEX idx_namespace_db ON ontology_rule FIELDS namespace, database;

-- ==================== ONTOLOGY EVENTS (Relaxed) ====================
DEFINE TABLE ontology_event SCHEMAFULL;
DEFINE FIELD event_id ON ontology_event TYPE string ASSERT $value != NONE;
DEFINE FIELD event_type ON ontology_event TYPE string;
DEFINE FIELD description ON ontology_event TYPE string;
DEFINE FIELD source_node ON ontology_event TYPE string;
DEFINE FIELD target_node ON ontology_event TYPE string;
DEFINE FIELD edge_id ON ontology_event TYPE string;
DEFINE FIELD action ON ontology_event TYPE string;
DEFINE FIELD result ON ontology_event TYPE object;
DEFINE FIELD namespace ON ontology_event TYPE string DEFAULT 'main';
DEFINE FIELD database ON ontology_event TYPE string DEFAULT 'main';
DEFINE FIELD created_at ON ontology_event TYPE datetime DEFAULT time::now();
DEFINE INDEX idx_event_type ON ontology_event FIELDS event_type;
DEFINE INDEX idx_source_target ON ontology_event FIELDS source_node, target_node;
DEFINE INDEX idx_namespace_db ON ontology_event FIELDS namespace, database;