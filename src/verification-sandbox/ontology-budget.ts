/**
 * Prepaid sandbox budget for ontology viewer bottom status bar.
 * Credits count down: remaining = prepaid − (runtime * rate + mcp * mcpRate).
 * Pattern mirrors assistant-ui BillingCounter rates; does not import AUI.
 */
import fs from 'fs';
import path from 'path';

/** Same demo rate as assistant-ui BottomStatusBar SANDBOX_RATE ($/s). */
export const DEFAULT_SANDBOX_RATE_USD_PER_SEC = 0.0004;
/** Same demo rate as assistant-ui MCP_RATE ($/call). */
export const DEFAULT_MCP_RATE_USD_PER_CALL = 0.0015;
export const DEFAULT_PREPAID_USD = 10;

export interface OntologyBudget {
  prepaidUsd: number;
  rateUsdPerSec: number;
  startedAt: string;
  autoStopMinutes?: number;
  sandboxId?: string | null;
  provider?: string | null;
  mcpCallCount?: number;
  mcpRateUsdPerCall?: number;
  currency: 'USD';
  source: 'session' | 'env' | 'default';
}

export interface BudgetSnapshot {
  elapsedSec: number;
  burnUsd: number;
  remainingUsd: number;
  remainingPct: number;
  prepaidUsd: number;
  rateUsdPerSec: number;
  mcpCallCount: number;
  mcpBurnUsd: number;
  sandboxBurnUsd: number;
  autoStopMinutes?: number;
  autoStopRemainingSec?: number | null;
  exhausted: boolean;
  warn: boolean;
  fmtRuntime: string;
  fmtBurn: string;
  fmtRemaining: string;
  fmtPrepaid: string;
  startedAt: string;
  sandboxId?: string | null;
  provider?: string | null;
  currency: 'USD';
  prepaid: true;
  creditsRemaining: number;
  creditsPrepaid: number;
}

export function fmtDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return (
    String(h).padStart(2, '0') +
    ':' +
    String(m).padStart(2, '0') +
    ':' +
    String(sec).padStart(2, '0')
  );
}

export function fmtMoney(n: number, digits = 4): string {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toFixed(digits)}`;
}

export function fmtMoneyShort(n: number): string {
  const v = Number.isFinite(n) ? n : 0;
  return `$${v.toFixed(2)}`;
}

export function seedOntologyBudget(opts?: {
  prepaidUsd?: number;
  rateUsdPerSec?: number;
  startedAt?: string;
  autoStopMinutes?: number;
  sandboxId?: string | null;
  provider?: string | null;
  mcpCallCount?: number;
  mcpRateUsdPerCall?: number;
  source?: OntologyBudget['source'];
  env?: NodeJS.ProcessEnv;
}): OntologyBudget {
  const env = opts?.env || process.env;
  const prepaidRaw = opts?.prepaidUsd ?? Number(env.ONTOLOGY_PREPAID_USD);
  const rateRaw =
    opts?.rateUsdPerSec ?? Number(env.ONTOLOGY_SANDBOX_RATE_USD_PER_SEC);
  const autoRaw =
    opts?.autoStopMinutes ?? Number(env.DAYTONA_AUTO_STOP_MINUTES ?? 5);
  const prepaidUsd =
    Number.isFinite(prepaidRaw) && prepaidRaw > 0
      ? prepaidRaw
      : DEFAULT_PREPAID_USD;
  const rateUsdPerSec =
    Number.isFinite(rateRaw) && rateRaw >= 0
      ? rateRaw
      : DEFAULT_SANDBOX_RATE_USD_PER_SEC;
  let autoStopMinutes: number | undefined;
  if (Number.isFinite(autoRaw) && autoRaw > 0) {
    autoStopMinutes = Math.min(5, Math.max(1, Math.floor(autoRaw)));
  }
  return {
    prepaidUsd,
    rateUsdPerSec,
    startedAt: opts?.startedAt || new Date().toISOString(),
    autoStopMinutes,
    sandboxId: opts?.sandboxId ?? null,
    provider: opts?.provider ?? null,
    mcpCallCount: opts?.mcpCallCount ?? 0,
    mcpRateUsdPerCall:
      opts?.mcpRateUsdPerCall ?? DEFAULT_MCP_RATE_USD_PER_CALL,
    currency: 'USD',
    source: opts?.source || 'default',
  };
}

/**
 * Compute live prepaid countdown snapshot.
 * remaining never goes below 0.
 */
export function computeBudgetSnapshot(
  budget: OntologyBudget,
  nowMs: number = Date.now(),
): BudgetSnapshot {
  const startedMs = Date.parse(budget.startedAt);
  const base = Number.isFinite(startedMs) ? startedMs : nowMs;
  const elapsedSec = Math.max(0, (nowMs - base) / 1000);
  const rate = budget.rateUsdPerSec >= 0 ? budget.rateUsdPerSec : 0;
  const mcpCount = Math.max(0, budget.mcpCallCount || 0);
  const mcpRate =
    budget.mcpRateUsdPerCall != null && budget.mcpRateUsdPerCall >= 0
      ? budget.mcpRateUsdPerCall
      : DEFAULT_MCP_RATE_USD_PER_CALL;
  const sandboxBurnUsd = elapsedSec * rate;
  const mcpBurnUsd = mcpCount * mcpRate;
  const burnUsd = sandboxBurnUsd + mcpBurnUsd;
  const prepaidUsd = budget.prepaidUsd > 0 ? budget.prepaidUsd : DEFAULT_PREPAID_USD;
  const remainingUsd = Math.max(0, prepaidUsd - burnUsd);
  const remainingPct = Math.max(
    0,
    Math.min(100, (remainingUsd / prepaidUsd) * 100),
  );
  const exhausted = remainingUsd <= 0;
  const warn = !exhausted && remainingPct < 20;

  let autoStopRemainingSec: number | null = null;
  if (budget.autoStopMinutes && budget.autoStopMinutes > 0) {
    const limit = budget.autoStopMinutes * 60;
    autoStopRemainingSec = Math.max(0, limit - elapsedSec);
  }

  return {
    elapsedSec,
    burnUsd,
    remainingUsd,
    remainingPct,
    prepaidUsd,
    rateUsdPerSec: rate,
    mcpCallCount: mcpCount,
    mcpBurnUsd,
    sandboxBurnUsd,
    autoStopMinutes: budget.autoStopMinutes,
    autoStopRemainingSec,
    exhausted,
    warn,
    fmtRuntime: fmtDuration(elapsedSec),
    fmtBurn: fmtMoney(burnUsd),
    fmtRemaining: fmtMoneyShort(remainingUsd),
    fmtPrepaid: fmtMoneyShort(prepaidUsd),
    startedAt: budget.startedAt,
    sandboxId: budget.sandboxId,
    provider: budget.provider,
    currency: 'USD',
    prepaid: true,
    creditsRemaining: remainingUsd,
    creditsPrepaid: prepaidUsd,
  };
}

/** Persist prepaid ledger under .px/session/ontology-budget.json */
export function writeOntologyBudgetFile(
  budget: OntologyBudget,
  sessionDir?: string,
): string {
  const dir =
    sessionDir ||
    path.join(
      process.env.GROK_PROJECT_DIR ||
        process.env.CLOUD_AGENT_ROOT ||
        process.cwd(),
      '.px/session',
    );
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'ontology-budget.json');
  fs.writeFileSync(file, JSON.stringify(budget, null, 2));
  return file;
}

/** Merge partial session JSON into a full budget. */
export function normalizeBudget(raw: unknown, env?: NodeJS.ProcessEnv): OntologyBudget {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return seedOntologyBudget({
    prepaidUsd:
      typeof o.prepaidUsd === 'number'
        ? o.prepaidUsd
        : typeof o.creditsPrepaid === 'number'
          ? (o.creditsPrepaid as number)
          : undefined,
    rateUsdPerSec:
      typeof o.rateUsdPerSec === 'number' ? o.rateUsdPerSec : undefined,
    startedAt: typeof o.startedAt === 'string' ? o.startedAt : undefined,
    autoStopMinutes:
      typeof o.autoStopMinutes === 'number' ? o.autoStopMinutes : undefined,
    sandboxId:
      o.sandboxId === null || typeof o.sandboxId === 'string'
        ? (o.sandboxId as string | null)
        : undefined,
    provider: typeof o.provider === 'string' ? o.provider : undefined,
    mcpCallCount: typeof o.mcpCallCount === 'number' ? o.mcpCallCount : undefined,
    mcpRateUsdPerCall:
      typeof o.mcpRateUsdPerCall === 'number' ? o.mcpRateUsdPerCall : undefined,
    source:
      o.source === 'session' || o.source === 'env' || o.source === 'default'
        ? o.source
        : 'session',
    env,
  });
}
