/**
 * Formal verification failure forces retry until input and output pass.
 * Reuses one packed sandbox across attempts.
 */

import { createPackedSandbox } from './provider.js';
import { packVerifiers, type SelectableVerifier } from './packing.js';
import type { VerificationSandbox, VerifierBackend } from './types.js';

export interface VerifyAttemptResult {
  pass: boolean;
  backend: VerifierBackend;
  verifier_id: string;
  detail: string;
}

export interface VerifyRetryOptions {
  selected: readonly SelectableVerifier[];
  /** Invoke payload factory per attempt */
  payloadForAttempt?: (attempt: number) => unknown;
  maxRetries?: number;
  forceMock?: boolean;
  /** When true, force fail first N attempts (tests) */
  failFirstAttempts?: number;
  /** Optional repair: mutate payload / abort */
  repair?: (ctx: {
    attempt: number;
    failures: VerifyAttemptResult[];
  }) => Promise<{ abort?: boolean; payload?: unknown } | void> | { abort?: boolean; payload?: unknown } | void;
}

export interface VerifyRetryResult {
  ok: boolean;
  attempts: number;
  maxRetries: number;
  sandboxId?: string;
  provider?: string;
  sandboxCount: 1;
  exhausted: boolean;
  attemptResults: VerifyAttemptResult[][];
  message: string;
}

function defaultMax(): number {
  const n = Number(process.env.VERIFIER_MAX_RETRIES || 5);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 5;
}

export async function verifyUntilPass(opts: VerifyRetryOptions): Promise<VerifyRetryResult> {
  const maxRetries = opts.maxRetries ?? defaultMax();
  const pack = packVerifiers(opts.selected);
  let box: VerificationSandbox | null = null;
  const attemptResults: VerifyAttemptResult[][] = [];

  try {
    if (opts.selected.length === 0) {
      return {
        ok: true,
        attempts: 0,
        maxRetries,
        sandboxCount: 1,
        exhausted: false,
        attemptResults,
        message: 'No verifiers selected',
      };
    }

    box = await createPackedSandbox({
      selected: opts.selected,
      forceMock: opts.forceMock,
    });

    let payload: unknown = opts.payloadForAttempt?.(0) ?? {};

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      const round: VerifyAttemptResult[] = [];
      let allPass = true;

      for (const v of opts.selected) {
        if (opts.failFirstAttempts != null && attempt < opts.failFirstAttempts) {
          round.push({
            pass: false,
            backend: v.backend,
            verifier_id: v.verifier_id,
            detail: `Attempt ${attempt + 1} not yet satisfied`,
          });
          allPass = false;
          continue;
        }
        const body =
          typeof payload === 'object' && payload
            ? { ...(payload as object), verifier_id: v.verifier_id }
            : { payload, verifier_id: v.verifier_id };
        const r = await box.invoke(v.backend, body);
        round.push({
          pass: r.pass,
          backend: v.backend,
          verifier_id: v.verifier_id,
          detail: r.detail,
        });
        if (!r.pass) allPass = false;
      }

      attemptResults.push(round);

      if (allPass) {
        return {
          ok: true,
          attempts: attempt + 1,
          maxRetries,
          sandboxId: box.sandboxId,
          provider: box.provider,
          sandboxCount: pack.sandboxCount,
          exhausted: false,
          attemptResults,
          message: `All checks passed after ${attempt + 1} attempt(s)`,
        };
      }

      if (attempt + 1 >= maxRetries) break;

      if (opts.repair) {
        const repaired = await opts.repair({
          attempt,
          failures: round.filter((x) => !x.pass),
        });
        if (repaired?.abort) {
          return {
            ok: false,
            attempts: attempt + 1,
            maxRetries,
            sandboxId: box.sandboxId,
            provider: box.provider,
            sandboxCount: 1,
            exhausted: false,
            attemptResults,
            message: 'Repair aborted',
          };
        }
        if (repaired?.payload !== undefined) payload = repaired.payload;
      } else if (opts.payloadForAttempt) {
        payload = opts.payloadForAttempt(attempt + 1);
      }
    }

    return {
      ok: false,
      attempts: attemptResults.length,
      maxRetries,
      sandboxId: box?.sandboxId,
      provider: box?.provider,
      sandboxCount: 1,
      exhausted: true,
      attemptResults,
      message: `Validation did not pass after ${attemptResults.length} attempt(s)`,
    };
  } finally {
    if (box) {
      try {
        await box.destroy();
      } catch {
        /* best-effort */
      }
    }
  }
}
