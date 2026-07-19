// OpenCode Sessions Schema for SurrealDB
// Run: surreal import --endpoint http://127.0.0.1:8000 --ns main --db main schemas/opencode-sessions.surql

DEFINE TABLE opencode_sessions SCHEMAFULL;
DEFINE FIELD id ON opencode_sessions TYPE string ASSERT $value != NONE;
DEFINE FIELD title ON opencode_sessions TYPE string;
DEFINE FIELD status ON opencode_sessions TYPE string ASSERT $value INSIDE ['completed', 'failed', 'in_progress'];
DEFINE FIELD pass ON opencode_sessions TYPE option<bool>;
DEFINE FIELD reasons ON opencode_sessions TYPE array;
DEFINE FIELD cost ON opencode_sessions TYPE decimal;
DEFINE FIELD tokens ON opencode_sessions TYPE object;
DEFINE FIELD tokens.input ON opencode_sessions TYPE int;
DEFINE FIELD tokens.output ON opencode_sessions TYPE int;
DEFINE FIELD tokens.cache_read ON opencode_sessions TYPE int;
DEFINE FIELD tokens.cache_write ON opencode_sessions TYPE int;
DEFINE FIELD duration ON opencode_sessions TYPE duration;
DEFINE FIELD created ON opencode_sessions TYPE datetime;
DEFINE FIELD updated ON opencode_sessions TYPE datetime;
DEFINE FIELD project_id ON opencode_sessions TYPE string;
DEFINE FIELD directory ON opencode_sessions TYPE string;
DEFINE FIELD agent ON opencode_sessions TYPE string;
DEFINE FIELD model ON opencode_sessions TYPE string;
DEFINE FIELD summary ON opencode_sessions TYPE object;
DEFINE FIELD summary.additions ON opencode_sessions TYPE int;
DEFINE FIELD summary.deletions ON opencode_sessions TYPE int;
DEFINE FIELD summary.files ON opencode_sessions TYPE array;
DEFINE INDEX idx_session_id ON opencode_sessions COLUMNS id UNIQUE;
DEFINE INDEX idx_session_date ON opencode_sessions COLUMNS created;
DEFINE INDEX idx_session_status ON opencode_sessions COLUMNS status;
DEFINE INDEX idx_session_pass ON opencode_sessions COLUMNS pass;