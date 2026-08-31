'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  fetchLeanState,
  leanLiveEventsUrl,
  triggerLeanRebuild,
  type LeanLiveState,
} from '../../lib/lean-live-client';

export default function LeanLivePanel() {
  const [state, setState] = useState<LeanLiveState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchLeanState();
      setState(next);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load state');
    }
  }, []);

  useEffect(() => {
    refresh();
    const es = new EventSource(leanLiveEventsUrl());
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = () => {
      refresh();
    };
    const interval = setInterval(refresh, 5000);
    return () => {
      es.close();
      clearInterval(interval);
    };
  }, [refresh]);

  const onRebuild = async () => {
    await triggerLeanRebuild();
    await refresh();
  };

  return (
    <div className="flex h-full flex-col gap-3 p-4 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Lean Live</h2>
        <span className={connected ? 'text-green-600' : 'text-amber-600'}>
          {connected ? 'live' : 'polling'}
        </span>
      </div>

      {error && (
        <p className="rounded border border-red-300 bg-red-50 p-2 text-red-800">{error}</p>
      )}

      <div className="grid gap-1 text-xs text-gray-600">
        <div>status: <strong>{state?.status ?? '—'}</strong></div>
        <div>workspace: {state?.workspace ?? '—'}</div>
        <div>updated: {state?.updatedAt ?? '—'}</div>
      </div>

      <button
        type="button"
        onClick={onRebuild}
        className="rounded bg-slate-900 px-3 py-1.5 text-white hover:bg-slate-700"
      >
        Rebuild
      </button>

      {state?.goals && state.goals.length > 0 && (
        <section>
          <h3 className="mb-1 font-medium">Goals</h3>
          <pre className="max-h-40 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-100">
            {state.goals.join('\n')}
          </pre>
        </section>
      )}

      {state?.diagnostics && state.diagnostics.length > 0 && (
        <section>
          <h3 className="mb-1 font-medium">Diagnostics</h3>
          <ul className="max-h-48 space-y-1 overflow-auto">
            {state.diagnostics.map((d, i) => (
              <li key={`${d.file}:${d.line}:${i}`} className="rounded border p-2">
                <span className="font-mono text-xs text-gray-500">
                  [{d.severity}] {d.file}:{d.line}
                </span>
                <div>{d.message}</div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {state?.lastOutputTail && (
        <section>
          <h3 className="mb-1 font-medium">Build output</h3>
          <pre className="max-h-56 overflow-auto rounded bg-slate-100 p-2 text-xs">
            {state.lastOutputTail}
          </pre>
        </section>
      )}
    </div>
  );
}
