/**
 * Feedback Translator — converts error messages to human-readable feedback and self-healing specs
 */
import { surrealQuery } from './event-logger.js';
import type { SDLCPhase, RepoContext, FeedbackTranslation, FeedbackLoop, SuggestedFix } from './sdlc-types.js';

const BASETEN_URL = `https://model-${process.env.BASETEN_CHAIN_PORTFOLIO_ID || 'qelg6953'}.api.baseten.co/environments/production/sync`;
const API_KEY = process.env.BASETEN_API_KEY || '';

async function callChain(specialty: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const resp = await fetch(BASETEN_URL, {
    method: 'POST',
    headers: { 'Authorization': `Api-Key ${API_KEY}`, 'Content-Type': 'application/json', 'X-Baseten-Chain-Specialty': specialty },
    body: JSON.stringify({ messages: [{ role: 'user', content: JSON.stringify(body) }], max_tokens: 2048 }),
  });
  return await resp.json() as unknown as Record<string, unknown>;
}

export async function translateError(
  error: string,
  context?: { phase?: SDLCPhase; code?: string; spec?: string }
): Promise<FeedbackTranslation> {
  // Pattern matching for known error formats
  const tsMatch = error.match(/^(?<file>[^:]+):(?<line>\d+):(?<col>\d+).+error TS(?<code>\d+):\s+(?<msg>.+)$/m);
  if (tsMatch?.groups) {
    return {
      original_error: error,
      human_readable: `TypeScript error in ${tsMatch.groups.file} at ${tsMatch.groups.line}:${tsMatch.groups.col}: ${tsMatch.groups.msg}`,
      suggested_fixes: [{ description: `Fix type error in ${tsMatch.groups.file}`, verification_impact: 'low', estimated_effort: 'small' }],
      confidence: 0.9,
    };
  }

  const eslintMatch = error.match(/^(?<file>[^:]+):(?<line>\d+):(?<col>\d+):\s+(?<msg>.+?)\s+\[(?<severity>\w+)\/([^\]]+)\]$/m);
  if (eslintMatch?.groups) {
    return {
      original_error: error,
      human_readable: `ESLint in ${eslintMatch.groups.file}: ${eslintMatch.groups.msg}`,
      suggested_fixes: [{ description: `Fix lint issue in ${eslintMatch.groups.file}`, verification_impact: 'low', estimated_effort: 'small' }],
      confidence: 0.9,
    };
  }

  const testMatch = error.match(/Expected:\s*(.+)\s*Received:\s*(.+)/s);
  if (testMatch) {
    return {
      original_error: error,
      human_readable: `Test failure: expected ${testMatch[1].trim()}, received ${testMatch[2].trim()}`,
      suggested_fixes: [{ description: 'Fix test assertion to match expected value', verification_impact: 'medium', estimated_effort: 'medium' }],
      confidence: 0.85,
    };
  }

  // Try LLM chain for unknown error patterns
  try {
    const result = await callChain('feedback-translate', { error, phase: context?.phase, code: context?.code });
    const choices = (result as { choices?: Array<{ message?: { content?: string } }> }).choices;
    const content = choices?.[0]?.message?.content || error;
    return { original_error: error, human_readable: content, suggested_fixes: [], confidence: 0.6 };
  } catch {
    return {
      original_error: error,
      human_readable: `Unknown error: ${error.substring(0, 200)}`,
      suggested_fixes: [{ description: 'Review error manually', verification_impact: 'high', estimated_effort: 'unknown' }],
      confidence: 0.3,
    };
  }
}

export async function generateFix(feedback: FeedbackTranslation, repoContext: RepoContext): Promise<string> {
  try {
    const result = await callChain('feedback-translate', { error: feedback.human_readable, repo: repoContext.target, mode: 'generate_fix' });
    const choices = (result as { choices?: Array<{ message?: { content?: string } }> }).choices;
    return choices?.[0]?.message?.content || JSON.stringify(feedback.suggested_fixes[0] || {});
  } catch {
    return JSON.stringify(feedback.suggested_fixes[0] || { description: 'Auto-fix unavailable' });
  }
}

export async function selfHealSpec(code: string, brokenSpec: string, repoContext: RepoContext): Promise<string> {
  try {
    const result = await callChain('spec-from-research', { code, brokenSpec, repo: repoContext.target, mode: 'self_heal' });
    const choices = (result as { choices?: Array<{ message?: { content?: string } }> }).choices;
    return choices?.[0]?.message?.content || brokenSpec;
  } catch {
    return brokenSpec;
  }
}

export async function getCommonFailures(repoTarget: string): Promise<FeedbackLoop[]> {
  const results = await surrealQuery(`SELECT * FROM feedback_loop WHERE repo_target = '${repoTarget}' ORDER BY created_at DESC LIMIT 20`);
  return (results[0]?.result || []) as FeedbackLoop[];
}

export function rateErrorMessage(error: string): { score: number; reason: string } {
  let score = 0;
  const reasons: string[] = [];
  if (error.includes(':') && /\d+/.test(error)) { score += 0.3; reasons.push('has file:line'); }
  if (error.match(/expected|received|actual/i)) { score += 0.3; reasons.push('has expected/actual'); }
  if (error.match(/fix|change|update|remove|add/i)) { score += 0.4; reasons.push('suggests action'); }
  return { score: Math.min(1, score), reason: reasons.join(', ') || 'unparseable' };
}
