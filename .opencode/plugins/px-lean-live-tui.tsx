/** @jsxImportSource @opentui/solid */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMemo, createSignal, onCleanup, onMount, Show, For } from 'solid-js';
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui';

type LeanState = {
  status?: string;
  workspace?: string;
  updatedAt?: string;
  goals?: string[];
  diagnostics?: Array<{
    file: string;
    line: number;
    severity: string;
    message: string;
  }>;
};

function statePath(api: TuiPluginApi): string {
  const root = api.state.path.directory ?? process.cwd();
  return join(root, '.px', 'lean-live', 'state.json');
}

function readLeanState(api: TuiPluginApi): LeanState {
  const path = statePath(api);
  if (!existsSync(path)) {
    return { status: 'waiting' };
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as LeanState;
  } catch {
    return { status: 'parse_error' };
  }
}

async function triggerRebuild(port: number): Promise<void> {
  try {
    await fetch(`http://127.0.0.1:${port}/rebuild`, { method: 'POST' });
  } catch {
    // bridge may be offline
  }
}

function LeanLiveBadge(props: { api: TuiPluginApi; expanded?: boolean }) {
  const theme = () => props.api.theme.current;
  const [state, setState] = createSignal<LeanState>({ status: '…' });
  const port = Number(process.env.LEAN_LIVE_PORT ?? 9474);

  onMount(() => {
    const refresh = () => setState(readLeanState(props.api));
    refresh();
    const interval = setInterval(refresh, 800);
    onCleanup(() => clearInterval(interval));
  });

  const diagCount = createMemo(() => state().diagnostics?.length ?? 0);
  const goalCount = createMemo(() => state().goals?.length ?? 0);
  const statusColor = createMemo(() => {
    const s = state().status ?? '';
    if (s === 'ok' || s === 'idle') return theme().success;
    if (s === 'building') return theme().warning ?? theme().text;
    if (s === 'error') return theme().error;
    return theme().textMuted;
  });

  return (
    <box flexDirection="column" flexShrink={0} gap={1} paddingLeft={1} paddingRight={1}>
      <box flexDirection="row" gap={1} flexShrink={0}>
        <text>
          <span style={{ fg: theme().textMuted }}>Lean </span>
          <span style={{ fg: statusColor() }}>
            <b>{state().status ?? '?'}</b>
          </span>
        </text>
        <Show when={diagCount() > 0}>
          <text fg={theme().error}>{diagCount()} diag</text>
        </Show>
        <Show when={goalCount() > 0}>
          <text fg={theme().warning ?? theme().text}>{goalCount()} goals</text>
        </Show>
      </box>
      <Show when={props.expanded}>
        <text fg={theme().textMuted} flexShrink={0}>
          {state().updatedAt ?? '—'}
        </text>
        <For each={(state().diagnostics ?? []).slice(0, 6)}>
          {(d) => (
            <text fg={theme().textMuted} flexShrink={0}>
              [{d.severity}] {d.file}:{d.line}
            </text>
          )}
        </For>
      </Show>
      <box onMouseDown={() => triggerRebuild(port)}>
        <text fg={theme().textMuted}>↻ rebuild (Shift+L)</text>
      </box>
    </box>
  );
}

const tui: TuiPlugin = async (api) => {
  const port = Number(process.env.LEAN_LIVE_PORT ?? 9474);

  const doRebuild = () => {
    void triggerRebuild(port);
    api.ui.toast({
      variant: 'info',
      title: 'Lean live',
      message: 'Rebuild requested',
      duration: 2000,
    });
  };

  api.keymap.registerLayer({
    commands: [
      {
        name: 'px.lean.rebuild',
        title: 'Trigger Lean rebuild',
        run: doRebuild,
        namespace: 'palette',
      },
    ],
    bindings: [
      {
        key: 'shift+l',
        cmd: 'px.lean.rebuild',
        desc: 'Rebuild Lean workspace via lean-live-bridge',
      },
    ],
  });

  api.slots.register({
    id: 'px-lean-live-session-prompt',
    order: 40,
    slots: {
      session_prompt_right() {
        return <LeanLiveBadge api={api} expanded />;
      },
      home_prompt_right() {
        return <LeanLiveBadge api={api} />;
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: 'px-lean-live-tui',
  tui,
};

export default plugin;
