// lib/midspiral-client.ts

export interface MidspiralVerifyOptions {
  ruleId: string;
  state: Record<string, unknown>;
  expected?: unknown;
}

export interface MidspiralVerifyResult {
  verified: boolean;
  coverage: number; // percentage 0-100
  matched: string[];
  missing: string[];
}

import { RULES } from "./midspiral-rules";

/**
 * Get the spec string for a rule by its ID.
 */
export function getRuleSpec(ruleId: string): string | undefined {
  const rule = RULES.find((r) => r.ruleId === ruleId);
  return rule?.spec;
}

/**
 * Helper to extract keyword list from a spec string.
 * Words longer than 3 characters and not in a basic stop‑word list.
 */
function extractKeywords(spec: string): string[] {
  const stopwords = new Set([
    "must",
    "have",
    "with",
    "and",
    "all",
    "the",
    "be",
    "to",
    "of",
    "in",
    "for",
    "or",
    "not",
    "is",
    "on",
    "at",
    "by",
    "required",
    "present",
    "must",
  ]);
  return spec
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3 && !stopwords.has(w));
}

/**
 * Verify a state against a Midspiral rule.
 */
export async function verifyWithMidspiral(
  options: MidspiralVerifyOptions,
): Promise<MidspiralVerifyResult> {
  const { ruleId, state } = options;
  const spec = getRuleSpec(ruleId);
  if (!spec) {
    return {
      verified: false,
      coverage: 0,
      matched: [],
      missing: ["Rule not found"],
    };
  }

  const keywords = extractKeywords(spec);
  const stateStr = JSON.stringify(state).toLowerCase();
  const matched = keywords.filter((k) => stateStr.includes(k));
  const missing = keywords.filter((k) => !stateStr.includes(k));
  const coverageRatio = keywords.length ? matched.length / keywords.length : 0;

  return {
    verified: coverageRatio >= 0.5,
    coverage: coverageRatio * 100,
    matched,
    missing,
  };
}
