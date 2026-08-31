import type { InterpretedRequest } from './types.js';

const THEME_KEYWORDS: Array<{ theme: string; patterns: RegExp[] }> = [
  {
    theme: 'dafny2js',
    patterns: [/dafny2js/i, /dafny\s*2\s*js/i, /translate\s+js/i],
  },
  {
    theme: 'dafny-replay',
    patterns: [/dafny-replay/i, /replay\.dfy/i, /verified.?kernel/i],
  },
  {
    theme: 'formal-stack',
    patterns: [/formal\s+validation/i, /quint/i, /alloy/i, /midspiral/i, /lemma/i],
  },
  {
    theme: 'happy-path',
    patterns: [/happy\s*path/i, /end.to.end/i, /e2e/i, /enforce/i],
  },
  {
    theme: 'ci',
    patterns: [/ci\b/i, /formal-verification\.yml/i],
  },
];

/** Local structured interpretation of the user request (no network). */
export function interpretRequestLocal(request: string): InterpretedRequest {
  const themes = THEME_KEYWORDS.filter((t) =>
    t.patterns.some((p) => p.test(request)),
  ).map((t) => t.theme);

  if (!themes.includes('happy-path') && /validate|test|enforce/i.test(request)) {
    themes.push('happy-path');
  }
  if (themes.length === 0) themes.push('formal-stack');

  const keywords = [
    ...new Set(
      (request.toLowerCase().match(/[a-z][a-z0-9._-]{2,}/g) || []).filter(
        (w) =>
          ![
            'the',
            'and',
            'that',
            'make',
            'sure',
            'full',
            'works',
            'completely',
            'expected',
            'need',
            'want',
          ].includes(w),
      ),
    ),
  ].slice(0, 40);

  const success_criteria = [
    'Dafny proofs for Replay / verification modules pass (`dafny verify`)',
    'JS kernels generated and consumed (`build:dafny` → verified-kernels)',
    'POST /api/verify/dafny2js succeeds for a representative module',
    'POST /api/verify/dafny-replay supports verify | compile | verify-app',
    'Runtime kernel Inv holds for Do / Undo / Redo',
    'Midspiral claimcheck gates reject invalid claims on chat/build paths',
    'CI `.github/workflows/formal-verification.yml` is green',
    'Dedicated E2E covers formal happy path (not Speakeasy Petstore)',
  ];

  const intent =
    themes.includes('dafny2js') || themes.includes('dafny-replay')
      ? 'Establish and prove an end-to-end formal happy path for dafny2js, dafny-replay, and the assistant-ui formal validation stack so runtime enforcement matches offline proofs.'
      : `Deliver a formal planning pack for: ${request.slice(0, 200)}`;

  return {
    intent,
    success_criteria,
    themes: [...new Set(themes)],
    products: ['assistant-ui'],
    keywords,
  };
}

export function slugFromRequest(request: string, explicit?: string): string {
  if (explicit) return explicit.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 64);
  const base = request
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `${base || 'formal-prd'}-${stamp}`;
}
