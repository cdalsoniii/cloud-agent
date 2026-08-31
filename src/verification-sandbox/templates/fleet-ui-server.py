#!/usr/bin/env python3
"""Formal-role verifier-fleet UI server for in-sandbox ports (default 7006)."""
from __future__ import annotations

import argparse
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import urlopen

PORT = int(os.environ.get("FLEET_UI_PORT", "7006"))
STATE_PATH = Path(
    os.environ.get(
        "ONTOLOGY_STATE_PATH",
        os.path.expanduser("~/verifier/px/generated/ontology-state.json"),
    )
)
ONTOLOGY_STATE_URL = os.environ.get(
    "ONTOLOGY_STATE_URL",
    "http://127.0.0.1:7005/api/ontology/state",
)
ROLE = os.environ.get("SANDBOX_ROLE", "formal")


def load_state() -> dict:
    if STATE_PATH.is_file():
        try:
            return json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception as e:
            return {"error": str(e), "reactFlow": {"nodes": [], "edges": []}}
    # fallback: fetch from ontology UI
    try:
        with urlopen(ONTOLOGY_STATE_URL, timeout=5) as r:
            return json.loads(r.read().decode("utf-8"))
    except Exception as e:
        return {
            "error": f"no state: {e}",
            "customerId": "unknown",
            "pack": "unknown",
            "reactFlow": {"nodes": [], "edges": []},
            "nodes": [],
        }


def fleet_html(state: dict) -> str:
    customer = state.get("customerId") or state.get("customer") or "unknown"
    pack = state.get("pack") or "unknown"
    state_json = json.dumps(state)
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Verifier Fleet — formal sandbox (Daytona)</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reactflow@11.11.4/dist/style.css" />
  <style>
    body {{ margin:0; font-family: system-ui,sans-serif; background:#0b1220; color:#e5e7eb; height:100vh; display:flex; flex-direction:column; }}
    header {{ padding:12px 16px; border-bottom:1px solid #1f2937; background:#111827; display:flex; justify-content:space-between; align-items:center; }}
    h1 {{ font-size:16px; margin:0; }}
    .badge {{ font-size:11px; padding:2px 8px; border-radius:999px; background:rgba(99,102,241,.2); color:#a5b4fc; }}
    main {{ flex:1; display:flex; min-height:0; }}
    #flow {{ flex:1; }}
    aside {{ width:20rem; border-left:1px solid #1f2937; background:#111827; overflow:auto; padding:12px; font-size:12px; }}
    aside h2 {{ font-size:11px; text-transform:uppercase; color:#9ca3af; margin:12px 0 6px; }}
    aside ul {{ list-style:none; padding:0; margin:0; }}
    aside li {{ padding:6px 8px; border:1px solid #1f2937; border-radius:6px; margin-bottom:6px; background:#0f172a; }}
    .react-flow__node {{ font-size:11px; padding:8px; border-radius:8px; border:1px solid #334155; background:#1e293b; color:#e2e8f0; min-width:100px; }}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>Verifier Fleet <span style="opacity:.6">/verifier-fleet</span></h1>
      <div style="font-size:12px;color:#9ca3af">formal sandbox (S2 / Daytona) · customer {customer} · pack {pack}</div>
    </div>
    <div style="display:flex;gap:8px;align-items:center">
      <span class="badge">role={ROLE}</span>
      <span class="badge">react-flow</span>
      <span class="badge">validation I/O</span>
    </div>
  </header>
  <div class="main" style="flex:1;display:flex;min-height:0">
    <div id="flow" class="react-flow" data-surface="verifier-fleet" data-formal-role="formal" data-runtime="daytona"></div>
    <aside>
      <h2>Validation I/O (host Surreal)</h2>
      <div id="vio-meta" style="color:#64748b;margin-bottom:8px">loading…</div>
      <ul id="vio-list"></ul>
    </aside>
  </div>
  <script src="https://cdn.jsdelivr.net/npm/react@18.3.1/umd/react.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/react-dom@18.3.1/umd/react-dom.production.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/reactflow@11.11.4/dist/umd/index.js"></script>
  <script>
    const STATE = {state_json};
    const RF = window.ReactFlow;
    const ReactFlow = RF.default || RF;
    const {{ Background, Controls }} = RF;
    const rf = STATE.reactFlow || {{ nodes: [], edges: [] }};
    let nodes = (rf.nodes || []).filter(n => (n.data && n.data.label) || n.id);
    if (!nodes.length) {{
      nodes = [{{ id: 'fleet-root', type: 'input', position: {{ x: 40, y: 40 }}, data: {{ label: 'Validation checks', detail: STATE.customerId }} }}];
    }}
    const edges = rf.edges || [];
    const root = ReactDOM.createRoot(document.getElementById('flow'));
    function App() {{
      return React.createElement(ReactFlow, {{
        nodes: nodes.map(n => ({{ ...n, data: {{ ...(n.data||{{}}), label: (n.data&&n.data.label)||n.id }} }})),
        edges,
        fitView: true,
        proOptions: {{ hideAttribution: true }},
      }}, React.createElement(Background, {{ color: '#1f2937' }}), React.createElement(Controls));
    }}
    root.render(React.createElement(App));
    // Prefer ontology UI proxy (same host zone) then local /api/validation/calls
    const urls = [
      'http://127.0.0.1:7005/api/validation/calls',
      '/api/validation/calls',
    ];
    (async function loadVio() {{
      const meta = document.getElementById('vio-meta');
      const list = document.getElementById('vio-list');
      for (const u of urls) {{
        try {{
          const r = await fetch(u, {{ cache: 'no-store' }});
          if (!r.ok) continue;
          const j = await r.json();
          const entries = j.entries || [];
          meta.textContent = (j.source || '?') + ' · ' + entries.length + ' calls';
          list.innerHTML = entries.length
            ? entries.slice(0, 20).map(e =>
                '<li><strong>' + String(e.at||'').slice(0,19) + '</strong> ' +
                (e.tool||'') + ' ok=' + e.ok +
                '<br/><span style="color:#64748b">pack=' + (e.pack||'') +
                ' layers=' + ((e.layers||[]).join(',')||'—') + '</span></li>'
              ).join('')
            : '<li style="color:#64748b">' + (j.note || 'no rows') + '</li>';
          return;
        }} catch (e) {{ /* try next */ }}
      }}
      meta.textContent = 'unavailable (host Surreal not reachable from sandbox)';
      list.innerHTML = '<li style="color:#64748b">Run tool_io_guard on host; open ontology UI on host with SURREALDB_URL</li>';
    }})();
  </script>
</body>
</html>"""


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):  # quiet
        pass

    def _headers(self, code: int, ctype: str):
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("X-Formal-Sandbox-Role", ROLE)
        self.send_header("X-Formal-Backed", "1")
        self.send_header("X-Runtime", "daytona")
        self.end_headers()

    def do_GET(self):
        path = self.path.split("?", 1)[0]
        if path in ("/api/validation/calls", "/api/validation-calls"):
            # Proxy/fallback: try ontology-ui then empty
            try:
                with urlopen("http://127.0.0.1:7005/api/validation/calls", timeout=3) as r:
                    body = r.read()
                self._headers(200, "application/json")
                self.wfile.write(body)
                return
            except Exception as e:
                body = json.dumps(
                    {
                        "ok": True,
                        "source": "empty",
                        "entries": [],
                        "note": f"proxy 7005 failed: {e}",
                    }
                ).encode()
                self._headers(200, "application/json")
                self.wfile.write(body)
                return
        if path in ("/health", "/healthz"):
            st = load_state()
            body = json.dumps(
                {
                    "ok": True,
                    "service": "formal-fleet-ui",
                    "role": ROLE,
                    "port": PORT,
                    "runtime": "daytona",
                    "customerId": st.get("customerId"),
                    "pack": st.get("pack"),
                    "nodes": len((st.get("reactFlow") or {}).get("nodes") or []),
                    "surfaces": ["fleet_ui", "verifier-fleet"],
                }
            ).encode()
            self._headers(200, "application/json")
            self.wfile.write(body)
            return
        if path.startswith("/api/ontology/state"):
            st = load_state()
            body = json.dumps(st).encode()
            self._headers(200, "application/json")
            self.wfile.write(body)
            return
        # default + /verifier-fleet
        st = load_state()
        html = fleet_html(st).encode("utf-8")
        self._headers(200, "text/html; charset=utf-8")
        self.wfile.write(html)


def main():
    global PORT
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=PORT)
    args = ap.parse_args()
    PORT = int(args.port)
    srv = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(json.dumps({"ready": True, "service": "formal-fleet-ui", "port": PORT}), flush=True)
    srv.serve_forever()


if __name__ == "__main__":
    main()
