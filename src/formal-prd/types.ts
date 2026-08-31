/** Types for the formal-system PRD planning pack. */

export interface PlannerOptions {
  request: string;
  target: string;
  dryRun: boolean;
  writeJobs: boolean;
  assistantUiDir?: string;
  cloudAgentRoot?: string;
  slug?: string;
}

export interface InterpretedRequest {
  intent: string;
  success_criteria: string[];
  themes: string[];
  products: string[];
  keywords: string[];
}

export interface ContextBundle {
  target: string;
  root: string;
  docs: Record<string, { path: string; excerpt: string; gap_ids: string[] }>;
  verify_apis: string[];
  verification_dirs: string[];
  kernels: string[];
  ci_workflows: string[];
  npm_scripts: string[];
  forced_themes: string[];
}

export interface ExpandedIssue {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  description: string;
  acceptance_criteria: string[];
  formal_artifacts: string[];
  milestone: string;
  source: string;
}

export interface Milestone {
  id: string;
  title: string;
  summary: string;
  issue_ids: string[];
  exit_criteria: string[];
}

export interface PlanningPack {
  slug: string;
  outDir: string;
  interpreted: InterpretedRequest;
  context: ContextBundle;
  analysisMarkdown: string;
  issues: ExpandedIssue[];
  prdMarkdown: string;
  specs: Record<string, string>;
  milestones: Milestone[];
  jobs?: Record<string, unknown>[];
  chainMeta: {
    dryRun: boolean;
    providers: Record<string, string>;
  };
}
