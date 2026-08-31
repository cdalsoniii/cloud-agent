# M1 CONTEXT — Prove → translate → kernels

## Goal

Connect prove → translate → kernel Inv path; track DF gaps without fabricating closure.

## Key paths

- dafny-replay API (assistant-ui)
- `createKernel` Inv in `packages/verified-kernels/src/kernel.ts`
- Midspiral claimcheck API
- Gap analysis DF-1..DF-5

## Rule

Closing a GAP-* issue requires either product evidence or explicit deferral with rationale in `gaps/tracking.md`.
