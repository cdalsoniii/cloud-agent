// SurrealDB Research-Report Ontology Extension Schema
// Expansive schema for constructing research reports on top of the existing
// ontology graph (ontology_node / ontology_edge / ontology_rule / ontology_event).
//
// This file is ADDITIVE and type-safe:
//   * extends the ontology_node.node_type enum with report/authoring node kinds
//   * extends the ontology_edge.relationship_type enum with report/argument edges
//   * defines dedicated research-report tables (research_report, report_section,
//     source, citation, claim, argument, evidence, recommendation)
//   * adds authorship / ordering / confidence metadata used in report authoring
//
// Design notes:
//   * Only the natural-key identifier fields are REQUIRED (ASSERT $value != NONE).
//   * All descriptive / metadata fields are NULLABLE via `TYPE option<X>` so
//     reports can be authored incrementally and sparsely. (In schemeful mode a
//     bare `TYPE string` is required; `ASSERT $value = NONE OR ...` does NOT make
//     it nullable — the correct optional idiom is `TYPE option<X>`.)
//   * Run against the ontology graph in cloud-agent/rules.
//
// Run:
//   surreal import --endpoint http://127.0.0.1:8000 --ns cloud-agent --db rules \
//     schemas/report-ontology.surql
//   (or POST to /sql --ns cloud-agent --db rules with OPTION IMPORT; NOT required)

-- ==================== EXTEND NODE TYPES ====================
-- Redefine the ontology_node.node_type enum to ALSO accept research-report
-- authoring node kinds. Field removal is required because a pre-existing
-- field keeps its original enum unless removed and redefined.
REMOVE FIELD node_type ON ontology_node;
DEFINE FIELD node_type ON ontology_node TYPE string ASSERT $value IN [
  'concept', 'entity', 'property', 'relationship', 'rule', 'constraint',
  'sdlc_phase', 'verification_type', 'chain_specialty', 'feedback_pattern',
  'file_type', 'code_pattern', 'test_type', 'deployment_target', 'infrastructure_component',
  'sdlc_event_type', 'ai_model', 'repository', 'sandbox',
  -- research-report authoring
  'report', 'report_section', 'topic', 'claim', 'argument',
  'evidence', 'source', 'citation', 'author', 'recommendation', 'finding'
];

-- Relax the ontology object fields to FLEXIBLE so report metadata
-- (template, color, order, arbitrary attributes) nests without DDL churn.
REMOVE FIELD properties ON ontology_node;
REMOVE FIELD properties ON ontology_edge;
DEFINE FIELD properties ON ontology_node TYPE option<object> FLEXIBLE;
DEFINE FIELD properties ON ontology_edge TYPE option<object> FLEXIBLE;

-- ==================== EXTEND EDGE TYPES ====================
-- Redefine the ontology_edge.relationship_type enum to ALSO accept
-- research-report / argumentative relationships.
REMOVE FIELD relationship_type ON ontology_edge;
DEFINE FIELD relationship_type ON ontology_edge TYPE string ASSERT $value IN [
  'inherits', 'implements', 'depends_on', 'contains', 'validates',
  'references', 'composes', 'extends', 'triggers', 'causes', 'prevents',
  'belongs_to', 'associated_with', 'version_of', 'migrates_to', 'replaces',
  'occurs_in', 'targets', 'uses', 'follows',
  -- research-report structure
  'report_has_section', 'cites', 'supports', 'refutes', 'evidence_for',
  'argues_for', 'argues_against', 'derives_from', 'authored_by',
  'published_in', 'updates', 'recommends', 'finding_for'
];

-- ==================== RESEARCH REPORTS ====================
DEFINE TABLE research_report SCHEMAFULL;
DEFINE FIELD report_id ON research_report TYPE string ASSERT $value != NONE;
DEFINE FIELD title ON research_report TYPE string ASSERT $value != NONE;
DEFINE FIELD topic ON research_report TYPE option<string>;
DEFINE FIELD abstract ON research_report TYPE option<string>;
DEFINE FIELD status ON research_report TYPE option<string> DEFAULT 'draft'
  ASSERT $value = NONE OR $value IN [
    'draft', 'in_progress', 'in_review', 'published', 'archived', 'superseded'
  ];
DEFINE FIELD version ON research_report TYPE option<string> DEFAULT '1.0';
DEFINE FIELD authors ON research_report TYPE option<array>;
DEFINE FIELD primary_author ON research_report TYPE option<string>;
DEFINE FIELD confidence ON research_report TYPE option<float> DEFAULT 0.5;
DEFINE FIELD language ON research_report TYPE option<string> DEFAULT 'en';
DEFINE FIELD tags ON research_report TYPE option<array>;
DEFINE FIELD properties ON research_report TYPE option<object> FLEXIBLE;
DEFINE FIELD namespace ON research_report TYPE option<string> DEFAULT 'main';
DEFINE FIELD database ON research_report TYPE option<string> DEFAULT 'main';
DEFINE FIELD created_at ON research_report TYPE option<datetime> DEFAULT time::now();
DEFINE FIELD updated_at ON research_report TYPE option<datetime> DEFAULT time::now();
DEFINE INDEX idx_report_status ON research_report FIELDS status;
DEFINE INDEX idx_report_topic ON research_report FIELDS topic;
DEFINE INDEX idx_report_title ON research_report FIELDS title;
DEFINE INDEX idx_report_created ON research_report FIELDS created_at;

-- ==================== REPORT SECTIONS ====================
DEFINE TABLE report_section SCHEMAFULL;
DEFINE FIELD section_id ON report_section TYPE string ASSERT $value != NONE;
DEFINE FIELD report_id ON report_section TYPE option<string>;
DEFINE FIELD title ON report_section TYPE option<string>;
DEFINE FIELD kind ON report_section TYPE option<string> DEFAULT 'analysis'
  ASSERT $value = NONE OR $value IN [
    'introduction', 'background', 'methodology', 'results', 'analysis',
    'discussion', 'conclusion', 'appendix', 'references', 'executive_summary',
    'recommendations'
  ];
DEFINE FIELD body ON report_section TYPE option<string>;
DEFINE FIELD ordering ON report_section TYPE option<int>;
DEFINE FIELD parent_section_id ON report_section TYPE option<string>;
DEFINE FIELD properties ON report_section TYPE option<object> FLEXIBLE;
DEFINE FIELD namespace ON report_section TYPE option<string> DEFAULT 'main';
DEFINE FIELD database ON report_section TYPE option<string> DEFAULT 'main';
DEFINE FIELD created_at ON report_section TYPE option<datetime> DEFAULT time::now();
DEFINE FIELD updated_at ON report_section TYPE option<datetime> DEFAULT time::now();
DEFINE INDEX idx_section_report ON report_section FIELDS report_id;
DEFINE INDEX idx_section_ordering ON report_section FIELDS report_id, ordering;
DEFINE INDEX idx_section_kind ON report_section FIELDS kind;

-- ==================== SOURCES ====================
DEFINE TABLE source SCHEMAFULL;
DEFINE FIELD source_id ON source TYPE string ASSERT $value != NONE;
DEFINE FIELD title ON source TYPE option<string>;
DEFINE FIELD source_type ON source TYPE option<string> DEFAULT 'other'
  ASSERT $value = NONE OR $value IN [
    'web', 'pdf', 'academic_paper', 'book', 'article', 'report', 'dataset',
    'interview', 'code_repository', 'specification', 'internal_doc', 'other'
  ];
DEFINE FIELD url ON source TYPE option<string>;
DEFINE FIELD doi ON source TYPE option<string>;
DEFINE FIELD authors ON source TYPE option<array>;
DEFINE FIELD publisher ON source TYPE option<string>;
DEFINE FIELD published_at ON source TYPE option<datetime>;
DEFINE FIELD accessed_at ON source TYPE option<datetime> DEFAULT time::now();
DEFINE FIELD language ON source TYPE option<string> DEFAULT 'en';
DEFINE FIELD credibility ON source TYPE option<float>;
DEFINE FIELD properties ON source TYPE option<object> FLEXIBLE;
DEFINE FIELD namespace ON source TYPE option<string> DEFAULT 'main';
DEFINE FIELD database ON source TYPE option<string> DEFAULT 'main';
DEFINE FIELD created_at ON source TYPE option<datetime> DEFAULT time::now();
DEFINE INDEX idx_source_type ON source FIELDS source_type;
DEFINE INDEX idx_source_title ON source FIELDS title;

-- ==================== CITATIONS ====================
DEFINE TABLE citation SCHEMAFULL;
DEFINE FIELD citation_id ON citation TYPE string ASSERT $value != NONE;
DEFINE FIELD source_id ON citation TYPE option<string>;
DEFINE FIELD report_id ON citation TYPE option<string>;
DEFINE FIELD section_id ON citation TYPE option<string>;
DEFINE FIELD claim_id ON citation TYPE option<string>;
DEFINE FIELD quote ON citation TYPE option<string>;
DEFINE FIELD page ON citation TYPE option<string>;
DEFINE FIELD context ON citation TYPE option<string>;
DEFINE FIELD location ON citation TYPE option<string>;
DEFINE FIELD properties ON citation TYPE option<object> FLEXIBLE;
DEFINE FIELD namespace ON citation TYPE option<string> DEFAULT 'main';
DEFINE FIELD database ON citation TYPE option<string> DEFAULT 'main';
DEFINE FIELD created_at ON citation TYPE option<datetime> DEFAULT time::now();
DEFINE INDEX idx_citation_source ON citation FIELDS source_id;
DEFINE INDEX idx_citation_report ON citation FIELDS report_id;
DEFINE INDEX idx_citation_claim ON citation FIELDS claim_id;

-- ==================== CLAIMS ====================
DEFINE TABLE claim SCHEMAFULL;
DEFINE FIELD claim_id ON claim TYPE string ASSERT $value != NONE;
DEFINE FIELD text ON claim TYPE option<string>;
DEFINE FIELD claim_type ON claim TYPE option<string> DEFAULT 'fact'
  ASSERT $value = NONE OR $value IN [
    'fact', 'assertion', 'hypothesis', 'finding', 'interpretation',
    'prediction', 'opinion', 'definition'
  ];
DEFINE FIELD status ON claim TYPE option<string> DEFAULT 'proposed'
  ASSERT $value = NONE OR $value IN [
    'proposed', 'under_investigation', 'supported', 'refuted', 'disputed', 'confirmed'
  ];
DEFINE FIELD confidence ON claim TYPE option<float> DEFAULT 0.5;
DEFINE FIELD report_id ON claim TYPE option<string>;
DEFINE FIELD section_id ON claim TYPE option<string>;
DEFINE FIELD evidence_summary ON claim TYPE option<string>;
DEFINE FIELD properties ON claim TYPE option<object> FLEXIBLE;
DEFINE FIELD namespace ON claim TYPE option<string> DEFAULT 'main';
DEFINE FIELD database ON claim TYPE option<string> DEFAULT 'main';
DEFINE FIELD created_at ON claim TYPE option<datetime> DEFAULT time::now();
DEFINE FIELD updated_at ON claim TYPE option<datetime> DEFAULT time::now();
DEFINE INDEX idx_claim_status ON claim FIELDS status;
DEFINE INDEX idx_claim_type ON claim FIELDS claim_type;
DEFINE INDEX idx_claim_report ON claim FIELDS report_id;

-- ==================== EVIDENCE ====================
DEFINE TABLE evidence SCHEMAFULL;
DEFINE FIELD evidence_id ON evidence TYPE string ASSERT $value != NONE;
DEFINE FIELD claim_id ON evidence TYPE option<string>;
DEFINE FIELD source_id ON evidence TYPE option<string>;
DEFINE FIELD description ON evidence TYPE option<string>;
DEFINE FIELD evidence_type ON evidence TYPE option<string> DEFAULT 'direct'
  ASSERT $value = NONE OR $value IN [
    'direct', 'statistical', 'anecdotal', 'expert', 'documentary',
    'experimental', 'observational', 'computational', 'other'
  ];
DEFINE FIELD strength ON evidence TYPE option<string> DEFAULT 'moderate'
  ASSERT $value = NONE OR $value IN ['weak', 'moderate', 'strong', 'conclusive'];
DEFINE FIELD confidence ON evidence TYPE option<float> DEFAULT 0.5;
DEFINE FIELD direction ON evidence TYPE option<string> DEFAULT 'for'
  ASSERT $value = NONE OR $value IN ['for', 'against', 'neutral'];
DEFINE FIELD properties ON evidence TYPE option<object> FLEXIBLE;
DEFINE FIELD namespace ON evidence TYPE option<string> DEFAULT 'main';
DEFINE FIELD database ON evidence TYPE option<string> DEFAULT 'main';
DEFINE FIELD created_at ON evidence TYPE option<datetime> DEFAULT time::now();
DEFINE INDEX idx_evidence_claim ON evidence FIELDS claim_id;
DEFINE INDEX idx_evidence_source ON evidence FIELDS source_id;
DEFINE INDEX idx_evidence_strength ON evidence FIELDS strength;

-- ==================== ARGUMENTS ====================
DEFINE TABLE argument SCHEMAFULL;
DEFINE FIELD argument_id ON argument TYPE string ASSERT $value != NONE;
DEFINE FIELD claim_id ON argument TYPE option<string>;
DEFINE FIELD premise ON argument TYPE option<string>;
DEFINE FIELD conclusion ON argument TYPE option<string>;
DEFINE FIELD argument_type ON argument TYPE option<string> DEFAULT 'deductive'
  ASSERT $value = NONE OR $value IN [
    'deductive', 'inductive', 'abductive', 'analogical', 'causal', 'statistical', 'other'
  ];
DEFINE FIELD soundness ON argument TYPE option<float>;
DEFINE FIELD properties ON argument TYPE option<object> FLEXIBLE;
DEFINE FIELD namespace ON argument TYPE option<string> DEFAULT 'main';
DEFINE FIELD database ON argument TYPE option<string> DEFAULT 'main';
DEFINE FIELD created_at ON argument TYPE option<datetime> DEFAULT time::now();
DEFINE INDEX idx_argument_claim ON argument FIELDS claim_id;
DEFINE INDEX idx_argument_type ON argument FIELDS argument_type;

-- ==================== RECOMMENDATIONS ====================
DEFINE TABLE recommendation SCHEMAFULL;
DEFINE FIELD recommendation_id ON recommendation TYPE string ASSERT $value != NONE;
DEFINE FIELD report_id ON recommendation TYPE option<string>;
DEFINE FIELD text ON recommendation TYPE string ASSERT $value != NONE;
DEFINE FIELD priority ON recommendation TYPE option<string> DEFAULT 'medium'
  ASSERT $value = NONE OR $value IN ['critical', 'high', 'medium', 'low', 'optional'];
DEFINE FIELD rationale ON recommendation TYPE option<string>;
DEFINE FIELD action_type ON recommendation TYPE option<string>;
DEFINE FIELD owner ON recommendation TYPE option<string>;
DEFINE FIELD due_by ON recommendation TYPE option<datetime>;
DEFINE FIELD properties ON recommendation TYPE option<object> FLEXIBLE;
DEFINE FIELD namespace ON recommendation TYPE option<string> DEFAULT 'main';
DEFINE FIELD database ON recommendation TYPE option<string> DEFAULT 'main';
DEFINE FIELD created_at ON recommendation TYPE option<datetime> DEFAULT time::now();
DEFINE INDEX idx_recommendation_report ON recommendation FIELDS report_id;
DEFINE INDEX idx_recommendation_priority ON recommendation FIELDS priority;

-- ==================== REPORT AUTHORSHIP FEEDBACK LOOP ====================
-- Wire reports back into the SDLC learning loop so authored findings become
-- first-class learning patterns (confidence-aware).
DEFINE FIELD authored_reports ON sdlc_learning TYPE option<array>;
DEFINE FIELD source_claims ON sdlc_learning TYPE option<array>;
DEFINE FIELD report_confidence ON sdlc_learning TYPE option<float>;
DEFINE INDEX idx_learning_authored ON sdlc_learning FIELDS authored_reports;

-- ==================== SAMPLE SEED DATA ====================
-- Demonstrate the report ontology shape (idempotent natural keys).
CREATE ontology_node CONTENT {
  node_id: "report_type_technical",
  node_type: "report",
  name: "Technical research report",
  description: "A structured research report with sections, claims, evidence and citations",
  properties: { template: "technical" },
  namespace: "main",
  database: "main"
};

CREATE ontology_node CONTENT {
  node_id: "report_type_finding",
  node_type: "finding",
  name: "Finding",
  description: "A key finding surfaced from a research report",
  properties: { },
  namespace: "main",
  database: "main"
};

CREATE ontology_node CONTENT {
  node_id: "source_type_spec",
  node_type: "source",
  name: "Specification source",
  description: "A specification document used as a research source",
  properties: { },
  namespace: "main",
  database: "main"
};

CREATE ontology_edge CONTENT {
  edge_id: "report_structure_has_section",
  source_id: "report_type_technical",
  target_id: "report_type_finding",
  relationship_type: "report_has_section",
  weight: 1.0,
  properties: { note: "reports are composed of findings and sections" },
  namespace: "main",
  database: "main"
};
