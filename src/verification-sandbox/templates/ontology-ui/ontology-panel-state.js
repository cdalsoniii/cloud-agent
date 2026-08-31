/**
 * Browser copy of ontology-panel-state (keep in sync with ontology-panel-state.ts).
 */
(function (global) {
  var TAG_STORAGE_KEY = 'ontology-ui-node-tags-v1';
  var GUARDRAILS_ACTIVE_KEY = 'ontology-ui-guardrails-active-v1';
  var GUARDRAILS_SELECTED_KEY = 'ontology-ui-guardrails-selected-v1';
  var FORMAL_GUARDRAILS_PORT = 7003;
  var PANEL_TABS = [
    { id: 'search', label: 'Search' },
    { id: 'summary', label: 'Summary' },
    { id: 'logs', label: 'Logs' },
    { id: 'guardrails', label: 'Guardrails' },
    { id: 'midspiral', label: 'Midspiral' },
    { id: 'node', label: 'Node' },
  ];

  var OVERLAY_STATUS_COLORS = {
    pass: { label: 'Pass', color: '#10b981' },
    fail: { label: 'Fail', color: '#f87171' },
    mixed: { label: 'Mixed', color: '#f59e0b' },
    stale: { label: 'Stale', color: '#64748b' },
    unknown: { label: 'Unknown', color: '#334155' },
  };

  var MIDSPIRAL_TOOL_ORDER = [
    'lemmafit',
    'lemmascript',
    'lemmacore',
    'claimcheck',
    'dafny-replay',
    'dafny2js',
  ];

  function isPanelTab(v) {
    return (
      v === 'search' ||
      v === 'logs' ||
      v === 'node' ||
      v === 'summary' ||
      v === 'guardrails' ||
      v === 'midspiral'
    );
  }

  function mergeNodeOverlay(node, entity) {
    if (!entity || !entity.status || entity.status === 'unknown') {
      return Object.assign({}, node, {
        data: Object.assign({}, node.data || {}, { overlay: entity || null }),
      });
    }
    var color =
      entity.color ||
      (OVERLAY_STATUS_COLORS[entity.status] && OVERLAY_STATUS_COLORS[entity.status].color) ||
      '#334155';
    return Object.assign({}, node, {
      style: Object.assign({}, node.style || {}, {
        borderColor: color,
        boxShadow: '0 0 0 1px ' + color + '55, 0 4px 12px rgba(0,0,0,.35)',
      }),
      data: Object.assign({}, node.data || {}, {
        overlay: entity,
        overlayStatus: entity.status,
        overlayColor: color,
      }),
    });
  }

  function mergeEdgeOverlay(edge, entity) {
    if (!entity || !entity.status || entity.status === 'unknown') {
      return Object.assign({}, edge, {
        data: Object.assign({}, edge.data || {}, { overlay: entity || null }),
      });
    }
    var color =
      entity.color ||
      (OVERLAY_STATUS_COLORS[entity.status] && OVERLAY_STATUS_COLORS[entity.status].color) ||
      '#475569';
    var dashed = entity.status === 'mixed' || entity.status === 'stale';
    var style = Object.assign({}, edge.style || {}, {
      stroke: color,
      strokeWidth: entity.strokeWidth != null ? entity.strokeWidth : entity.status === 'fail' ? 2.5 : 1.5,
    });
    if (dashed) style.strokeDasharray = '6 4';
    return Object.assign({}, edge, {
      animated: entity.status === 'fail' ? true : edge.animated,
      style: style,
      data: Object.assign({}, edge.data || {}, {
        overlay: entity,
        overlayStatus: entity.status,
      }),
    });
  }

  function selectNode(currentId, nodeId) {
    if (nodeId == null || nodeId === '') return null;
    return String(nodeId);
  }

  function selectNodeToggle(currentId, nodeId) {
    if (currentId === nodeId) return null;
    return selectNode(currentId, nodeId);
  }

  function normalizeTag(tag) {
    return String(tag || '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 64);
  }

  function addNodeTag(tags, nodeId, tag) {
    var id = String(nodeId || '');
    if (!id) return tags;
    var t = normalizeTag(tag);
    if (!t) return tags;
    var prev = tags[id] || [];
    if (prev.indexOf(t) !== -1) return tags;
    var next = Object.assign({}, tags);
    next[id] = prev.concat([t]);
    return next;
  }

  function removeNodeTag(tags, nodeId, tag) {
    var id = String(nodeId || '');
    if (!id) return tags;
    var t = normalizeTag(tag);
    var prev = tags[id] || [];
    var filtered = prev.filter(function (x) {
      return x !== t;
    });
    if (filtered.length === prev.length) return tags;
    var next = Object.assign({}, tags);
    if (filtered.length === 0) delete next[id];
    else next[id] = filtered;
    return next;
  }

  function getNodeTags(tags, nodeId) {
    return (tags[String(nodeId)] || []).slice();
  }

  function loadTagsFromStorage(storage) {
    if (!storage) return {};
    try {
      var raw = storage.getItem(TAG_STORAGE_KEY);
      if (!raw) return {};
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return {};
      var out = {};
      Object.keys(parsed).forEach(function (k) {
        if (Array.isArray(parsed[k])) {
          out[k] = parsed[k].map(String).map(normalizeTag).filter(Boolean);
        }
      });
      return out;
    } catch (e) {
      return {};
    }
  }

  function saveTagsToStorage(storage, tags) {
    if (!storage) return false;
    try {
      storage.setItem(TAG_STORAGE_KEY, JSON.stringify(tags));
      return true;
    } catch (e) {
      return false;
    }
  }

  function defaultGuardrailsCatalog(opts) {
    opts = opts || {};
    var port = opts.guardrailsPort != null ? opts.guardrailsPort : FORMAL_GUARDRAILS_PORT;
    var healthOk = opts.healthOk;
    var formalStatus =
      healthOk === true ? 'active' : healthOk === false ? 'unreachable' : 'unknown';
    return [
      {
        id: 'formal.guardrails.content',
        name: 'formal.guardrails.content',
        kind: 'formal_sandbox',
        port: port,
        url: 'http://127.0.0.1:' + port + '/health',
        status: formalStatus,
        inSandbox: true,
        note:
          'Formal multi-service content-check on :' +
          port +
          '. Full Guardrails AI Hub may not fit the sandbox image; this is the in-sandbox Guardrails endpoint.',
      },
      {
        id: 'GuardrailsAI.ValidJson',
        name: 'GuardrailsAI.ValidJson',
        kind: 'guardrails_ai',
        status: 'active',
        inSandbox: false,
        note: 'Guardrails AI-style validator label (I/O guard).',
      },
      {
        id: 'GuardrailsAI.DetectPII',
        name: 'GuardrailsAI.DetectPII',
        kind: 'guardrails_ai',
        status: 'active',
        inSandbox: false,
        note: 'Guardrails AI-style validator label (I/O guard).',
      },
      {
        id: 'GuardrailsAI.RestrictToTopic',
        name: 'GuardrailsAI.RestrictToTopic',
        kind: 'guardrails_ai',
        status: 'active',
        inSandbox: false,
        note: 'Guardrails AI-style validator label (I/O guard).',
      },
      {
        id: 'GuardrailsAI.ToxicLanguage',
        name: 'GuardrailsAI.ToxicLanguage',
        kind: 'guardrails_ai',
        status: 'active',
        inSandbox: false,
        note: 'Guardrails AI-style validator label (I/O guard).',
      },
    ];
  }

  function selectGuardrailsServer(currentId, serverId) {
    if (serverId == null || serverId === '') return null;
    return String(serverId);
  }

  function removeActiveGuardrailsServer(active, serverId) {
    var id = String(serverId || '');
    if (!id) return active;
    return active.filter(function (s) {
      return s.id !== id;
    });
  }

  function addActiveGuardrailsServer(active, server) {
    if (!server || !server.id) return active;
    if (
      active.some(function (s) {
        return s.id === server.id;
      })
    )
      return active;
    return active.concat([server]);
  }

  /** Register any number of Guardrails AI servers (replace by id; no cap of 1). */
  function registerActiveGuardrailsServer(active, server) {
    if (!server || !server.id) return active;
    var id = String(server.id);
    var found = false;
    var next = active.map(function (s) {
      if (s.id === id) {
        found = true;
        return Object.assign({}, s, server, { id: id });
      }
      return s;
    });
    if (!found) next = next.concat([Object.assign({}, server, { id: id })]);
    return next;
  }

  function listActiveGuardrailsServers(active) {
    return active.filter(function (s) {
      return s.status === 'active' || s.status === 'unknown';
    });
  }

  function listAllGuardrailsServers(active) {
    return (active || []).slice();
  }

  function makeGuardrailsServer(partial) {
    partial = partial || {};
    var id = String(partial.id || '').trim();
    var port = partial.port;
    return {
      id: id,
      name: partial.name || id,
      kind: partial.kind || 'guardrails_ai',
      port: port,
      url: partial.url || (port != null ? 'http://127.0.0.1:' + port + '/health' : undefined),
      status: partial.status || 'unknown',
      inSandbox: partial.inSandbox != null ? partial.inSandbox : Boolean(port),
      note: partial.note,
    };
  }

  function loadGuardrailsActiveFromStorage(storage) {
    if (!storage) return null;
    try {
      var raw = storage.getItem(GUARDRAILS_ACTIVE_KEY);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return null;
      return parsed.filter(function (s) {
        return s && typeof s.id === 'string';
      });
    } catch (e) {
      return null;
    }
  }

  function saveGuardrailsActiveToStorage(storage, active) {
    if (!storage) return false;
    try {
      storage.setItem(GUARDRAILS_ACTIVE_KEY, JSON.stringify(active));
      return true;
    } catch (e) {
      return false;
    }
  }

  function loadGuardrailsSelectedFromStorage(storage) {
    if (!storage) return null;
    try {
      var v = storage.getItem(GUARDRAILS_SELECTED_KEY);
      return v || null;
    } catch (e) {
      return null;
    }
  }

  function saveGuardrailsSelectedToStorage(storage, id) {
    if (!storage) return false;
    try {
      storage.setItem(GUARDRAILS_SELECTED_KEY, id == null ? '' : id);
      return true;
    } catch (e) {
      return false;
    }
  }

  global.OntologyPanelState = {
    PANEL_TABS: PANEL_TABS,
    TAG_STORAGE_KEY: TAG_STORAGE_KEY,
    GUARDRAILS_ACTIVE_KEY: GUARDRAILS_ACTIVE_KEY,
    GUARDRAILS_SELECTED_KEY: GUARDRAILS_SELECTED_KEY,
    FORMAL_GUARDRAILS_PORT: FORMAL_GUARDRAILS_PORT,
    OVERLAY_STATUS_COLORS: OVERLAY_STATUS_COLORS,
    MIDSPIRAL_TOOL_ORDER: MIDSPIRAL_TOOL_ORDER,
    isPanelTab: isPanelTab,
    selectNode: selectNode,
    selectNodeToggle: selectNodeToggle,
    normalizeTag: normalizeTag,
    addNodeTag: addNodeTag,
    removeNodeTag: removeNodeTag,
    getNodeTags: getNodeTags,
    loadTagsFromStorage: loadTagsFromStorage,
    saveTagsToStorage: saveTagsToStorage,
    mergeNodeOverlay: mergeNodeOverlay,
    mergeEdgeOverlay: mergeEdgeOverlay,
    defaultGuardrailsCatalog: defaultGuardrailsCatalog,
    selectGuardrailsServer: selectGuardrailsServer,
    removeActiveGuardrailsServer: removeActiveGuardrailsServer,
    addActiveGuardrailsServer: addActiveGuardrailsServer,
    registerActiveGuardrailsServer: registerActiveGuardrailsServer,
    listActiveGuardrailsServers: listActiveGuardrailsServers,
    listAllGuardrailsServers: listAllGuardrailsServers,
    makeGuardrailsServer: makeGuardrailsServer,
    loadGuardrailsActiveFromStorage: loadGuardrailsActiveFromStorage,
    saveGuardrailsActiveToStorage: saveGuardrailsActiveToStorage,
    loadGuardrailsSelectedFromStorage: loadGuardrailsSelectedFromStorage,
    saveGuardrailsSelectedToStorage: saveGuardrailsSelectedToStorage,
  };
})(typeof window !== 'undefined' ? window : globalThis);
