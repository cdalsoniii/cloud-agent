#!/usr/bin/env node
/**
 * Thin MCP server exposing lean-live bridge state to Grok.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const PORT = process.env.LEAN_LIVE_PORT ?? '9474';
const BASE = `http://127.0.0.1:${PORT}`;

async function fetchJson(path) {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res.json();
}

const server = new Server(
  { name: 'lean-live', version: '0.1.0' },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'lean_status',
      description: 'Get latest Lean build status from lean-live bridge',
      inputSchema: { type: 'object', properties: {} },
    },
    {
      name: 'lean_rebuild',
      description: 'Trigger a debounced lake build via lean-live bridge',
      inputSchema: { type: 'object', properties: {} },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name } = request.params;
  if (name === 'lean_status') {
    const state = await fetchJson('/state');
    return {
      content: [{ type: 'text', text: JSON.stringify(state, null, 2) }],
    };
  }
  if (name === 'lean_rebuild') {
    const res = await fetch(`${BASE}/rebuild`, { method: 'POST' });
    const body = await res.json();
    return {
      content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    };
  }
  throw new Error(`Unknown tool: ${name}`);
});

const transport = new StdioServerTransport();
await server.connect(transport);
