/**
 * Core types for the Intelligent SDLC Loop system
 * Extended from the existing types.ts with repo targeting,
 * formal verification, learning, and event logging support
 */

// ── Repo Registry ──

export interface RepoEntry {
  url: string;
  provider: 'github' | 'gitlab' | 'bitbucket' | 'custom';
  token_env: string;
  default_branch: string;
  verify_rules: { rule: string }[];
  sandbox: {
    provider: 'daytona' | 'northflank' | 'cloudflare';
    plan?: string;
  };
}

export interface RepoRegistry {
  repos: Record<string, RepoEntry>;
  global_rules: { rule: string }[];
  chains: Record<string, ChainConfig>;
}

export interface ChainConfig {
  id: string;
  description: string;
  inputs?: string[];
  outputs?: string[];
}

export interface RepoContext {
  target: string;
  repoUrl: string;
  provider: string;
  token: string;
  branch: string;
  verifyRules: string[];
  sandboxProvider: string;
  sandboxPlan?: string;
}

// ── SDLC Phases ──

export type SDLCPhase =
  | 'research'
  | 'specify'
  | 'design'
  | 'implement'
  | 'verify'
  | 'review'
  | 'deploy'
  | 'monitor'
  | 'feedback';

export interface SDLCTask {
  task: string;
  target: string;
  repoUrl?: string;
  tokenEnv?: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  verify_mode: 'none' | 'standard' | 'full';
  max_loop_iterations: number;
  phases?: SDLCPhase[];
  context?: Record<string, unknown>;
}

// ── SDLC Event (mirrors sdlc_event table) ──

export interface SDLCEvent {
  event_id: string;
  event_type: 'chain_input' | 'chain_output' | 'verification' | 'verification_result' | 'sandbox_exec' | 'git_commit' | 'deploy' | 'feedback' | 'learning_update' | 'error';
  phase: SDLCPhase;
  repo_target: string;
  task: string;
  payload?: Record<string, unknown>;
  result?: Record<string, unknown>;
  model_id?: string;
  model_provider?: string;
  tokens_in?: number;
  tokens_out?: number;
  latency_ms?: number;
  cost_usd?: number;
  success: boolean;
  error_message?: string;
  sandbox_id?: string;
  branch?: string;
  pr_url?: string;
  correlation_id: string;
  parent_event_id?: string;
  file_path?: string;
}

// ── Learning ──

export interface LearningPattern {
  pattern_id: string;
  pattern_type: 'code_pattern' | 'flaky_test' | 'risk_profile' | 'successful_strategy' | 'counterexample' | 'spec_template' | 'fix_strategy';
  repo_target: string;
  file_path?: string;
  pattern_data: Record<string, unknown>;
  frequency: number;
  last_seen: string;
  confidence: number;
  source_events: string[];
}

export interface SDLCLearning {
  repoPatterns: Record<string, CodePattern[]>;
  flakyTests: TestFailure[];
  riskProfile: Record<string, RiskScore>;
  successfulStrategies: Strategy[];
  commonCounterexamples: Counterexample[];
  specReuseRate: number;
  falsePositiveRate: number;
}

export interface CodePattern {
  file: string;
  pattern: string;
  frequency: number;
  lastSeen: Date;
}

export interface TestFailure {
  testName: string;
  failureCount: number;
  lastFailure: Date;
  isFlaky: boolean;
}

export interface RiskScore {
  score: number;        // 0-1
  changeFrequency: number;
  bugDensity: number;
  testCoverage: number;
  lastModified: Date;
}

export interface Strategy {
  name: string;
  description: string;
  successRate: number;
  applicablePhases: SDLCPhase[];
  preconditions: string[];
}

export interface Counterexample {
  spec: string;
  input: Record<string, unknown>;
  expected: unknown;
  actual: unknown;
  source: string;
}

// ── Verification Pipeline ──

export interface VerificationRequest {
  code: string;
  spec: string;
  repo_target: string;
  mode: 'standard' | 'full';
  include_dafny?: boolean;
  include_property_tests?: boolean;
  include_fuzzing?: boolean;
  include_tla?: boolean;
  timeout_sec?: number;
}

export interface VerificationResult {
  passed: boolean;
  artifacts: VerificationArtifact[];
  counterexamples: Counterexample[];
  summary: string;
  risk_score: number;
  recommendations: string[];
}

export interface VerificationArtifact {
  artifact_id: string;
  artifact_type: 'dafny_spec' | 'dafny_result' | 'property_test' | 'fuzz_result' | 'tla_model' | 'tla_result' | 'contract_test' | 'invariant_check';
  rule_id: string;
  spec_text: string;
  passed: boolean;
  counterexamples: Counterexample[];
  hash: string;
}

// ── Feedback Loop ──

export interface FeedbackLoop {
  loop_id: string;
  task: string;
  repo_target: string;
  attempt: number;
  max_attempts: number;
  phase: SDLCPhase;
  error_type: string;
  error_detail: Record<string, unknown>;
  fix_applied?: string;
  resolved: boolean;
}

export interface FeedbackTranslation {
  original_error: string;
  human_readable: string;
  suggested_fixes: SuggestedFix[];
  confidence: number;
}

export interface SuggestedFix {
  description: string;
  code_diff?: string;
  verification_impact: 'low' | 'medium' | 'high';
  estimated_effort: string;
}

// ── Chain Execution Log ──

export interface ChainExecutionLog {
  execution_id: string;
  chain_specialty: string;
  specialty?: string;
  input_payload: Record<string, unknown>;
  output_payload?: Record<string, unknown>;
  model_id: string;
  tokens_in: number;
  tokens_out: number;
  latency_ms: number;
  cost_usd: number;
  dry_run: boolean;
  success: boolean;
  error?: string;
}

// ── Chain Result Types ──

export interface ResearchResult { research: Record<string, unknown>; }
export interface SpecResult { spec: string; }
export interface DesignDecision { decision: Record<string, unknown>; }
export interface ImplementationResult { code: string; tests: string; }
export interface ReviewResult { summary: string; risk: number; }
export interface DeployValidation { valid: boolean; }
export interface TelemetryAnalysis { anomalies: unknown[]; suggestions: string[]; }

// ── Orchestration ──

export interface SDLCLoopConfig {
  phases: SDLCPhase[];
  verify_mode: 'none' | 'standard' | 'full';
  max_loop_iterations: number;
  risk_threshold: number;
  enable_spec_reuse: boolean;
  enable_counterexample_library: boolean;
  enable_parallel_hypothesis: boolean;
}

export interface SDLCLoopResult {
  success: boolean;
  iterations: number;
  phases_completed: SDLCPhase[];
  pr_url?: string;
  artifacts: SDLCEvent[];
  learnings_added: number;
  total_cost_usd: number;
  total_tokens: number;
  summary: string;
}

export interface OrchestrationRequest {
  task: SDLCTask;
  loop_config: SDLCLoopConfig;
  repo_context: RepoContext;
}
