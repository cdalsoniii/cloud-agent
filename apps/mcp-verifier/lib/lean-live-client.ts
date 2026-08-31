export type LeanDiagnostic = {
  file: string;
  line: number;
  column: number;
  severity: string;
  message: string;
};

export type LeanLiveState = {
  status?: string;
  workspace?: string;
  updatedAt?: string;
  exitCode?: number;
  goals?: string[];
  diagnostics?: LeanDiagnostic[];
  lastBuildAt?: string;
  lastOutputTail?: string;
};

const DEFAULT_PORT = process.env.NEXT_PUBLIC_LEAN_LIVE_PORT ?? '9474';
const BASE = process.env.NEXT_PUBLIC_LEAN_LIVE_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`;

export async function fetchLeanState(): Promise<LeanLiveState> {
  const res = await fetch(`${BASE}/state`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`lean-live state HTTP ${res.status}`);
  return res.json();
}

export function leanLiveEventsUrl(): string {
  return `${BASE}/events`;
}

export async function triggerLeanRebuild(): Promise<void> {
  await fetch(`${BASE}/rebuild`, { method: 'POST' });
}
