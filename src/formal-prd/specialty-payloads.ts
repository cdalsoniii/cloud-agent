/**
 * Baseten chain specialty payload builders for formal PRD planning.
 * Shared by baseten-chain-sandbox specialtyMap and unit tests.
 */

export type SpecialtyPayloadBuilder = (
  input: Record<string, unknown>,
) => Record<string, unknown>;

export function buildDeepResearchBriefPayload(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return {
    request: {
      task: input.task || input.request || input,
      product: input.product || 'assistant-ui',
      interpreted: input.interpreted,
      context_summary: input.context_summary,
      mode: 'deep-research-brief',
    },
    specialty: 'deep-research-brief',
    mode: 'execute',
  };
}

export function buildSpecFromResearchPayload(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return {
    request: {
      research: input.research || input,
      focus: input.focus || [
        'happy-path',
        'dafny2js',
        'dafny-replay',
        'stack-enforcement',
      ],
      mode: 'spec-from-research',
    },
    specialty: 'spec-from-research',
    mode: 'execute',
  };
}

export function buildPrdFromAnalysisPayload(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return {
    request: {
      request: input.request,
      interpreted: input.interpreted,
      analysis: input.analysis,
      issues: input.issues,
      milestones: input.milestones,
      mode: 'prd-from-analysis',
    },
    specialty: 'prd-from-analysis',
    mode: 'execute',
  };
}

export function buildRoadmapPayload(
  input: Record<string, unknown>,
): Record<string, unknown> {
  return {
    request: input,
    specialty: 'roadmap',
    mode: 'execute',
  };
}

/** Map used by BasetenChainSandbox.buildChainPayload. */
export const formalPrdSpecialtyMap: Record<string, SpecialtyPayloadBuilder> = {
  'deep-research-brief': buildDeepResearchBriefPayload,
  'spec-from-research': buildSpecFromResearchPayload,
  'prd-from-analysis': buildPrdFromAnalysisPayload,
  roadmap: buildRoadmapPayload,
};
