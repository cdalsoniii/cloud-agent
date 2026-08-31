/** @jsxImportSource @opentui/solid */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createMemo, createSignal, Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from '@opencode-ai/plugin/tui';

type PxConfig = {
  ontologyEditing?: boolean;
  updatedAt?: string;
};

function configPath(api: TuiPluginApi): string {
  const root = api.state.path.directory ?? process.cwd();
  return join(root, '.px/config.json');
}

function abbreviateHome(value: string, home: string): string {
  if (!home || home === '/') return value;
  if (value === home) return '~';
  if (value.startsWith(`${home}/`)) return `~${value.slice(home.length)}`;
  return value;
}

function readPxConfig(api: TuiPluginApi): PxConfig {
  if (process.env.PX_ONTOLOGY_EDIT === '1' || process.env.PX_ONTOLOGY_EDIT === 'true') {
    return { ontologyEditing: true };
  }
  const path = configPath(api);
  if (!existsSync(path)) return { ontologyEditing: false };
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PxConfig;
  } catch {
    return { ontologyEditing: false };
  }
}

function writePxConfig(api: TuiPluginApi, ontologyEditing: boolean): void {
  const path = configPath(api);
  mkdirSync(dirname(path), { recursive: true });
  const payload: PxConfig = {
    ontologyEditing,
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  api.kv.set('px_ontology_editing', ontologyEditing);
}

function useOntologyState(api: TuiPluginApi) {
  const [on, setOn] = createSignal(!!readPxConfig(api).ontologyEditing);

  onMount(() => {
    const initial = readPxConfig(api);
    setOn(!!initial.ontologyEditing);
    api.kv.set('px_ontology_editing', !!initial.ontologyEditing);

    const interval = setInterval(() => {
      const cfg = readPxConfig(api);
      setOn(!!cfg.ontologyEditing);
      api.kv.set('px_ontology_editing', !!cfg.ontologyEditing);
    }, 1500);

    onCleanup(() => clearInterval(interval));
  });

  const toggle = () => {
    const next = !on();
    setOn(next);
    writePxConfig(api, next);
    api.ui.toast({
      variant: next ? 'success' : 'info',
      title: 'Ontology editing',
      message: next ? 'Enabled — schema edits allowed' : 'Disabled — read-only ontology mode',
      duration: 2500,
    });
  };

  return { on, toggle };
}

function OntologyBadge(props: { api: TuiPluginApi; compact?: boolean }) {
  const theme = () => props.api.theme.current;
  const state = useOntologyState(props.api);

  return (
    <box flexShrink={0} onMouseDown={() => state.toggle()}>
      <text>
        <span style={{ fg: theme().textMuted }}>{props.compact ? 'Ontology ' : 'Ontology editing: '}</span>
        <span style={{ fg: state.on() ? theme().success : theme().textMuted }}>
          <b>{state.on() ? 'ON' : 'OFF'}</b>
        </span>
      </text>
    </box>
  );
}

function HomeFooter(props: { api: TuiPluginApi }) {
  const theme = () => props.api.theme.current;
  const dir = createMemo(() => {
    const cwd = props.api.state.path.directory ?? process.cwd();
    const home = props.api.state.path.home ?? process.env.HOME ?? '';
    const out = abbreviateHome(cwd, home);
    const branch = props.api.state.vcs?.branch;
    return branch ? `${out}:${branch}` : out;
  });
  const mcps = createMemo(() => props.api.state.mcp());
  const mcpCount = createMemo(() => mcps().filter((item) => item.status === 'connected').length);
  const mcpFailed = createMemo(() => mcps().some((item) => item.status === 'failed'));

  return (
    <box
      width="100%"
      paddingTop={1}
      paddingBottom={1}
      paddingLeft={2}
      paddingRight={2}
      flexDirection="row"
      flexShrink={0}
      gap={2}
    >
      <text fg={theme().textMuted} flexShrink={0}>
        {dir()}
      </text>
      <OntologyBadge api={props.api} compact />
      <Show when={mcps().length > 0}>
        <box gap={1} flexDirection="row" flexShrink={0}>
          <text fg={theme().text}>
            <Switch>
              <Match when={mcpFailed()}>
                <span style={{ fg: theme().error }}>⊙ </span>
              </Match>
              <Match when={true}>
                <span style={{ fg: mcpCount() > 0 ? theme().success : theme().textMuted }}>⊙ </span>
              </Match>
            </Switch>
            {mcpCount()} MCP
          </text>
          <text fg={theme().textMuted}>/status</text>
        </box>
      </Show>
      <box flexGrow={1} />
      <text fg={theme().textMuted} flexShrink={0}>
        {props.api.app.version}
      </text>
    </box>
  );
}

const tui: TuiPlugin = async (api) => {
  const initial = readPxConfig(api);
  api.kv.set('px_ontology_editing', !!initial.ontologyEditing);

  // Imperative toggle used by both the badge click and Shift+O keybinding.
  const doToggle = () => {
    const current = !!readPxConfig(api).ontologyEditing;
    const next = !current;
    writePxConfig(api, next);
    api.ui.toast({
      variant: next ? 'success' : 'info',
      title: 'Ontology editing',
      message: next ? 'Enabled — schema edits allowed' : 'Disabled — read-only ontology mode',
      duration: 2500,
    });
  };

  // Register Shift+O (and make the command available in the palette).
  // This follows the @opencode-ai/plugin TUI keymap layer pattern documented in the TUI plugins spec.
  api.keymap.registerLayer({
    commands: [
      {
        name: 'px.ontology.toggle',
        title: 'Toggle ontology editing',
        run: doToggle,
        namespace: 'palette',
      },
    ],
    bindings: [
      {
        key: 'shift+o',
        cmd: 'px.ontology.toggle',
        desc: 'Toggle ontology editing ON/OFF (affects schema_apply gate)',
      },
    ],
  });

  api.slots.register({
    id: 'px-ontology-home-footer',
    order: 110,
    slots: {
      home_footer() {
        return <HomeFooter api={api} />;
      },
    },
  });

  api.slots.register({
    id: 'px-ontology-session-prompt',
    order: 50,
    slots: {
      session_prompt_right(_ctx, props) {
        return <OntologyBadge api={api} compact />;
      },
      home_prompt_right() {
        return <OntologyBadge api={api} compact />;
      },
    },
  });

  api.slots.register({
    id: 'px-ontology-sidebar-footer',
    order: 101,
    slots: {
      sidebar_footer(_ctx, props) {
        return <OntologyBadge api={api} />;
      },
    },
  });
};

const plugin: TuiPluginModule & { id: string } = {
  id: 'px-ontology-tui',
  tui,
};

export default plugin;
