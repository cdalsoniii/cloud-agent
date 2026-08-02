// Migration: make descriptive/metadata fields on report tables NULLABLE (round 3).
// `TYPE object FLEXIBLE` is also required in schemeful mode; use `TYPE option<object> FLEXIBLE`.
// Natural-key ids stay REQUIRED. All other fields optional. Idempotent.

-- research_report
REMOVE FIELD properties ON research_report;
DEFINE FIELD properties ON research_report TYPE option<object> FLEXIBLE;

-- report_section
REMOVE FIELD properties ON report_section;
DEFINE FIELD properties ON report_section TYPE option<object> FLEXIBLE;

-- source
REMOVE FIELD properties ON source;
DEFINE FIELD properties ON source TYPE option<object> FLEXIBLE;

-- citation
REMOVE FIELD properties ON citation;
DEFINE FIELD properties ON citation TYPE option<object> FLEXIBLE;

-- claim
REMOVE FIELD properties ON claim;
DEFINE FIELD properties ON claim TYPE option<object> FLEXIBLE;

-- evidence
REMOVE FIELD properties ON evidence;
DEFINE FIELD properties ON evidence TYPE option<object> FLEXIBLE;

-- argument
REMOVE FIELD properties ON argument;
DEFINE FIELD properties ON argument TYPE option<object> FLEXIBLE;

-- recommendation
REMOVE FIELD properties ON recommendation;
DEFINE FIELD properties ON recommendation TYPE option<object> FLEXIBLE;
