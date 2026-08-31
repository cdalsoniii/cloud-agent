/**
 * Applied inside Daytona sandbox against a checked-out assistant-ui tree.
 * Usage: node moonlit-patch-remote.js /home/daytona/assistant-ui
 */
const fs = require('fs');
const path = require('path');
const root = process.argv[2] || '/home/daytona/assistant-ui';
const web = path.join(root, 'packages/web/src');
const changes = [];

function read(p) {
  return fs.readFileSync(p, 'utf8');
}
function write(p, s) {
  fs.writeFileSync(p, s);
  changes.push(p);
}
function patch(rel, fn) {
  const p = path.join(web, rel);
  if (!fs.existsSync(p)) {
    console.log('SKIP missing', rel);
    return;
  }
  const before = read(p);
  const after = fn(before);
  if (after !== before) write(p, after);
  else console.log('NOOP', rel);
}

patch('app/layout.tsx', (s) =>
  s.replace(/\n\s*maximumScale:\s*1,\n\s*userScalable:\s*false,/, ''),
);

patch('app/page.tsx', (s) => s.split('text-[#6b6b6b]').join('text-[#9a9a9a]'));

patch('app/page.tsx', (s) => {
  let out = s;
  if (!out.includes('aria-label="Navigation"')) {
    out = out.replace(
      '<aside\n          className={cn(\n            \'flex-shrink-0 flex flex-col bg-black border-r border-[#2c2e33] transition-all duration-200\',',
      '<aside\n          aria-label="Navigation"\n          className={cn(\n            \'flex-shrink-0 flex flex-col bg-black border-r border-[#2c2e33] transition-all duration-200\',',
    );
  }
  if (!out.includes('aria-label="Chat"')) {
    out = out.replace(
      '{/* Chat panel — collapsible sidebar between mode nav and main workspace */}\n        <aside\n          className={cn(',
      '{/* Chat panel — collapsible sidebar between mode nav and main workspace */}\n        <aside\n          aria-label="Chat"\n          className={cn(',
    );
  }
  if (!out.includes('aria-label="Vendors"')) {
    out = out.replace(
      '{/* RIGHT: tabbed panel (Vendors | Rules | Research) (collapsible)   */}\n        {/* ================================================================ */}\n        <aside\n          className={cn(',
      '{/* RIGHT: tabbed panel (Vendors | Rules | Research) (collapsible)   */}\n        {/* ================================================================ */}\n        <aside\n          aria-label="Vendors"\n          className={cn(',
    );
  }
  if (!out.includes('aria-label={leftCollapsed')) {
    out = out.replace(
      "title={leftCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}\n            >",
      "title={leftCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}\n              aria-label={leftCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}\n            >",
    );
  }
  if (!out.includes('aria-label="Search rules"')) {
    out = out.replace(
      'placeholder="Search rules..."\n                      suppressHydrationWarning',
      'placeholder="Search rules..."\n                      aria-label="Search rules"\n                      suppressHydrationWarning',
    );
  }
  if (!out.includes('sr-only">Assistant UI workbench')) {
    out = out.replace(
      '<div className="h-[100dvh] flex flex-col bg-[#1e1e1e] text-[#cccccc]" suppressHydrationWarning>\n      <div className="flex-1 flex min-h-0 overflow-hidden">',
      '<div className="h-[100dvh] flex flex-col bg-[#1e1e1e] text-[#cccccc]" suppressHydrationWarning>\n      <h1 className="sr-only">Assistant UI workbench</h1>\n      <div className="md:hidden px-3 py-2 text-xs text-[#cccccc] bg-[#252526] border-b border-[#2c2e33]" role="status">\n        Best experienced on desktop — use the navigation and Chat controls below; side panels may be collapsed on small screens.\n      </div>\n      <div className="flex-1 flex min-h-0 overflow-hidden">',
    );
  }
  if (!out.includes('<h2 className="text-[11px] font-semibold flex-1">Chat</h2>')) {
    out = out.replace(
      '<span className="text-[11px] font-semibold flex-1">Chat</span>',
      '<h2 className="text-[11px] font-semibold flex-1">Chat</h2>',
    );
  }
  return out;
});

patch('components/ChatPanel.tsx', (s) => {
  let out = s;
  if (!out.includes('aria-label="Model"')) {
    out = out.replace(
      '<select\n                  className="border border-border rounded-md',
      '<select\n                  aria-label="Model"\n                  className="border border-border rounded-md',
    );
  }
  if (!out.includes('aria-label="Message"')) {
    out = out.replace(
      'placeholder="Message…"\n              value={input}',
      'placeholder="Message…"\n              aria-label="Message"\n              value={input}',
    );
  }
  if (!out.includes('aria-label="Add rule"')) {
    out = out.replace(
      'onClick={() => setIsRuleModalOpen(true)}\n            disabled={busy}\n            className="shrink-0"\n          >',
      'onClick={() => setIsRuleModalOpen(true)}\n            disabled={busy}\n            className="shrink-0"\n            aria-label="Add rule"\n          >',
    );
  }
  return out;
});

patch('components/RightPanel.tsx', (s) => {
  let out = s;
  if (!out.includes('API docs (opens in new tab)')) {
    out = out.replace(
      '<a href={v.documentationUrl} target="_blank" rel="noreferrer" className="text-muted-foreground hover:text-[#75beff] opacity-0 group-hover:opacity-100 transition-opacity">',
      '<a href={v.documentationUrl} target="_blank" rel="noreferrer" aria-label={`${v.name} API docs (opens in new tab)`} className="text-muted-foreground hover:text-[#75beff] opacity-0 group-hover:opacity-100 transition-opacity">',
    );
  }
  if (!out.includes('aria-label="Search vendors"')) {
    out = out.replace(
      'placeholder="Search vendors…"\n            className="pl-7 h-7',
      'placeholder="Search vendors…"\n            aria-label="Search vendors"\n            className="pl-7 h-7',
    );
  }
  if (!out.includes('<h2 className="text-[11px] font-semibold text-[#cccccc]">Vendors</h2>')) {
    out = out.replace(
      '<span className="text-[11px] font-semibold text-[#cccccc]">Vendors</span>',
      '<h2 className="text-[11px] font-semibold text-[#cccccc]">Vendors</h2>',
    );
  }
  return out;
});

patch('components/GraphEditor.tsx', (s) => {
  let out = s;
  if (!out.includes('edgesFocusable={false}')) {
    out = out.replace(
      'proOptions={{ hideAttribution: true }}\n        >',
      'proOptions={{ hideAttribution: true }}\n          edgesFocusable={false}\n        >',
    );
  }
  if (!out.includes('bgColor="#111111"')) {
    out = out.replace(
      '<MiniMap\n            nodeStrokeColor="#475569"\n            nodeColor="#2d2d30"\n            maskColor="rgba(30, 30, 30, 0.8)"\n          />',
      '<MiniMap\n            bgColor="#111111"\n            nodeStrokeColor="#475569"\n            nodeColor="#2c2e33"\n            maskColor="rgba(0, 0, 0, 0.6)"\n          />',
    );
  }
  return out;
});

patch('components/viewer/RuleGraph.tsx', (s) => {
  let out = s;
  if (!out.includes('edgesFocusable={false}')) {
    out = out.replace(
      "defaultEdgeOptions={{\n            type: 'relationship',\n            animated: false,\n          }}\n        >",
      "defaultEdgeOptions={{\n            type: 'relationship',\n            animated: false,\n          }}\n          edgesFocusable={false}\n        >",
    );
  }
  if (!out.includes('bgColor="#111111"')) {
    out = out.replace(
      '<MiniMap\n            nodeStrokeWidth={3}\n            zoomable\n            pannable\n            className="bg-[#1a1d24] border border-[#2a2f3a]"',
      '<MiniMap\n            bgColor="#111111"\n            maskColor="rgba(0, 0, 0, 0.6)"\n            nodeStrokeWidth={3}\n            zoomable\n            pannable\n            className="bg-[#1a1d24] border border-[#2a2f3a]"',
    );
  }
  return out;
});

patch('components/BottomStatusBar.tsx', (s) => {
  let out = s;
  if (!out.includes('aria-label="Status bar"')) {
    out = out.replace(
      'return (\n      <div\n        className={cn(\n          \'flex items-center\',\n          \'h-[36px] min-h-[36px]\',\n          \'bg-[#181a1f]\',',
      'return (\n      <footer\n        role="contentinfo"\n        aria-label="Status bar"\n        className={cn(\n          \'flex items-center\',\n          \'h-[36px] min-h-[36px]\',\n          \'bg-[#181a1f\',',
    );
    out = out.replace(
      'return (\n    <div\n      className={cn(\n        \'flex items-center\',\n        \'h-[36px] min-h-[36px]\',\n        \'bg-[#181a1f]\',\n        \'text-[#d4d4d4]\',\n        \'border-t border-[#2c2e33]\',',
      'return (\n    <footer\n      role="contentinfo"\n      aria-label="Status bar"\n      className={cn(\n        \'flex items-center\',\n        \'h-[36px] min-h-[36px]\',\n        \'bg-[#181a1f]\',\n        \'text-[#d4d4d4]\',\n        \'border-t border-[#2c2e33\',',
    );
    const marker = '\nexport default BottomStatusBar';
    const idx = out.lastIndexOf(marker);
    if (idx > 0) {
      const before = out.slice(0, idx);
      const after = out.slice(idx);
      const closed = before.replace(/\n    <\/div>\n  \)\n\}\n$/, '\n    </footer>\n  )\n}\n');
      if (closed !== before) out = closed + after;
    }
  }
  return out;
});

patch('app/globals.css', (s) => {
  if (s.includes('/* moonlit-fiddle focus ring */')) return s;
  return (
    s +
    `

/* moonlit-fiddle focus ring — plan #9 */
:focus-visible {
  outline: 2px solid #75beff !important;
  outline-offset: 2px !important;
}
button:focus-visible,
a:focus-visible,
input:focus-visible,
select:focus-visible,
textarea:focus-visible,
[tabindex]:focus-visible {
  outline: 2px solid #75beff !important;
  outline-offset: 2px !important;
}
`
  );
});

console.log(JSON.stringify({ ok: true, changes, count: changes.length }, null, 2));
