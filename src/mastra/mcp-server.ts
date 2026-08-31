/**
 * Cloud Agent Mastra MCP server.
 *
 * Transports:
 *   - stdio (default): Cursor / Claude Code compatible
 *   - sse: HTTP SSE on MCP_PORT (legacy)
 *
 *   MCP_TRANSPORT=stdio|sse npm run mastra:mcp
 */
import http from 'http';
import { URL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  daytonaCreateTool,
  daytonaBootstrapTool,
  daytonaConnectivityTool,
  daytonaExecTool,
  daytonaShellTool,
  daytonaDestroyTool,
  envValidationTool,
  verifyRuleTool,
  opencodeLoopTool,
  sdlcBatchTool,
  mastraOrchestrateTool,
} from './tools/daytona-tools.js';
import { formalPrdPlanTool } from './tools/formal-prd-plan.js';
import {
  callVerificationMcpTool,
  VERIFICATION_MCP_SCHEMAS,
  VERIFICATION_MCP_TOOLS,
  verificationMcpManifest,
} from '../verification-sandbox/mcp-tools.js';
import {
  isGatedMcpTool,
  resolvePack,
} from '../verification-sandbox/pack-resolve.js';
import { isOntologyEnforcementEnabled } from '../verification-sandbox/px-config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLOUD_AGENT_ROOT = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(CLOUD_AGENT_ROOT, '.env') });
dotenv.config({ path: path.join(CLOUD_AGENT_ROOT, '../.env') });

if (!process.env.GPU_INFERENCE_STACK_DIR) {
  process.env.GPU_INFERENCE_STACK_DIR = path.resolve(
    CLOUD_AGENT_ROOT,
    '../gpu-inference-stack',
  );
}

const PORT = Number(process.env.MCP_PORT || 3002);
const TRANSPORT = (process.env.MCP_TRANSPORT || 'stdio').toLowerCase();

interface ToolEntry {
  tool: { execute: (args: { context: any }) => Promise<any>; description: string };
  name: string;
  description: string;
  inputSchema: any;
}

const tools: Record<string, ToolEntry> = {
  'env-validation': {
    tool: envValidationTool,
    name: 'env-validation',
    description: envValidationTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        requiredVars: {
          type: 'array',
          items: { type: 'string' },
          default: ['DAYTONA_API_KEY', 'BASETEN_API_KEY'],
        },
      },
    },
  },
  'daytona-create': {
    tool: daytonaCreateTool,
    name: 'daytona-create',
    description: daytonaCreateTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false },
        timeoutSeconds: { type: 'number', default: 300 },
      },
    },
  },
  'daytona-bootstrap': {
    tool: daytonaBootstrapTool,
    name: 'daytona-bootstrap',
    description: daytonaBootstrapTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false },
        timeoutSeconds: { type: 'number', default: 1800 },
      },
    },
  },
  'daytona-connectivity': {
    tool: daytonaConnectivityTool,
    name: 'daytona-connectivity',
    description: daytonaConnectivityTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false },
        timeoutSeconds: { type: 'number', default: 60 },
      },
    },
  },
  'daytona-exec': {
    tool: daytonaExecTool,
    name: 'daytona-exec',
    description: daytonaExecTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'The task or command to execute' },
        harness: { type: 'string', enum: ['goose', 'opencode', 'pi'], default: 'opencode' },
        runtime: { type: 'string', default: '' },
        timeoutSeconds: { type: 'number', default: 1800 },
        dryRun: { type: 'boolean', default: false },
      },
      required: ['task'],
    },
  },
  'daytona-shell': {
    tool: daytonaShellTool,
    name: 'daytona-shell',
    description: daytonaShellTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Shell command to execute' },
        timeoutSeconds: { type: 'number', default: 120 },
        dryRun: { type: 'boolean', default: false },
      },
      required: ['command'],
    },
  },
  'daytona-destroy': {
    tool: daytonaDestroyTool,
    name: 'daytona-destroy',
    description: daytonaDestroyTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        dryRun: { type: 'boolean', default: false },
      },
    },
  },
  'opencode-loop': {
    tool: opencodeLoopTool,
    name: 'opencode-loop',
    description: opencodeLoopTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        workItem: { type: 'string', default: 'factory-item-02' },
        batchFile: { type: 'string', default: '' },
        opencodeBaseUrls: {
          type: 'string',
          description: 'Comma-separated OpenCode serve URLs from Daytona preview links',
          default: '',
        },
        dryRun: { type: 'boolean', default: false },
        timeoutSeconds: { type: 'number', default: 1800 },
      },
    },
  },
  'sdlc-batch': {
    tool: sdlcBatchTool,
    name: 'sdlc-batch',
    description: sdlcBatchTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        jobsFile: { type: 'string', default: 'jobs-1-test.json' },
        dryRun: { type: 'boolean', default: false },
        timeoutSeconds: { type: 'number', default: 3600 },
      },
    },
  },
  'mastra-orchestrate': {
    tool: mastraOrchestrateTool,
    name: 'mastra-orchestrate',
    description: mastraOrchestrateTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string' },
        harness: { type: 'string', enum: ['goose', 'opencode', 'pi'], default: 'opencode' },
        dryRun: { type: 'boolean', default: false },
        skipCleanup: { type: 'boolean', default: false },
        timeoutSeconds: { type: 'number', default: 3600 },
      },
      required: ['task'],
    },
  },
  'verify-rule': {
    tool: verifyRuleTool,
    name: 'verify-rule',
    description: verifyRuleTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        ruleSpec: { type: 'string', description: 'Formal specification of the rule' },
        ruleCode: { type: 'string', description: 'Implementation code to verify' },
      },
      required: ['ruleSpec', 'ruleCode'],
    },
  },
  'formal-prd-plan': {
    tool: formalPrdPlanTool,
    name: 'formal-prd-plan',
    description: formalPrdPlanTool.description,
    inputSchema: {
      type: 'object',
      properties: {
        request: {
          type: 'string',
          description:
            'Natural-language request for formal PRD / happy-path / issue expansion',
        },
        target: { type: 'string', default: 'assistant-ui' },
        dryRun: { type: 'boolean', default: false },
        writeJobs: { type: 'boolean', default: false },
        slug: { type: 'string' },
      },
      required: ['request'],
    },
  },
};

/** Registry-driven verification tools — always mirror VERIFICATION_MCP_SCHEMAS (no allowlist drift). */
for (const t of VERIFICATION_MCP_TOOLS) {
  const schema = VERIFICATION_MCP_SCHEMAS[t.name];
  if (!schema) continue;
  tools[t.name] = {
    tool: {
      description: schema.description,
      execute: async ({ context }: { context: Record<string, unknown> }) =>
        callVerificationMcpTool(t.name, context || {}),
    },
    name: t.name,
    description: schema.description,
    inputSchema: schema.inputSchema,
  };
}
// px_load uses manifest helper (schema still registered)
if (tools.px_load) {
  tools.px_load.tool.execute = async () => verificationMcpManifest();
}

function createMcpServer(): Server {
  const server = new Server(
    { name: 'cloud-agent-mastra', version: '1.0.0' },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: Object.values(tools).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const entry = tools[name];
    if (!entry) {
      throw new Error(`Tool not found: ${name}`);
    }

    const context = { ...(args || {}) } as Record<string, unknown>;

    try {
      // Always-on middleware: resolve pack + optional pre-gate for gated tools
      const resolved = resolvePack({
        pack: context.pack as string | undefined,
        className: context.className as string | undefined,
        tool: (context.tool as string) || name,
        text: (context.text as string) || (context.task as string) || '',
        payload: context.payload ?? context.data ?? context,
      });
      if (!context.pack) context.pack = resolved.pack;
      if (!context.className) context.className = resolved.className;

      let preValidation: unknown = null;
      if (isGatedMcpTool(name) && isOntologyEnforcementEnabled()) {
        preValidation = await callVerificationMcpTool('tool_io_guard', {
          tool: name,
          phase: 'pre',
          enforceSchema: true,
          pack: context.pack,
          className: context.className,
          payload: context.payload ?? context.data ?? {
            tool: name,
            args: context,
          },
        });
        if (preValidation && typeof preValidation === 'object' && (preValidation as any).ok === false) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    ok: false,
                    error: 'validation_pre_blocked',
                    message: `tool_io_guard pre failed for gated tool ${name}`,
                    phase: 'pre',
                    packResolve: resolved,
                    validation: preValidation,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }

      const result = await entry.tool.execute({ context });

      let postValidation: unknown = null;
      if (isGatedMcpTool(name) && isOntologyEnforcementEnabled()) {
        postValidation = await callVerificationMcpTool('tool_io_guard', {
          tool: name,
          phase: 'post',
          enforceSchema: true,
          pack: context.pack,
          className: context.className,
          payload: context.payload ?? context.data,
          result: typeof result === 'object' && result !== null ? result : { value: result },
        });
        // Hard post-block: output must pass cascade before success is returned
        if (
          postValidation &&
          typeof postValidation === 'object' &&
          (postValidation as any).ok === false
        ) {
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify(
                  {
                    ok: false,
                    error: 'validation_post_blocked',
                    message: `tool_io_guard post failed for gated tool ${name}`,
                    phase: 'post',
                    packResolve: resolved,
                    result,
                    validationPre: preValidation,
                    validationPost: postValidation,
                  },
                  null,
                  2,
                ),
              },
            ],
            isError: true,
          };
        }
      }

      // Always attach pack resolve + optional validation envelope for agents
      const envelope =
        result && typeof result === 'object' && !Array.isArray(result)
          ? {
              ...(result as object),
              packResolve: resolved,
              ...(preValidation ? { validationPre: preValidation } : {}),
              ...(postValidation ? { validationPost: postValidation } : {}),
            }
          : {
              result,
              packResolve: resolved,
              ...(preValidation ? { validationPre: preValidation } : {}),
              ...(postValidation ? { validationPost: postValidation } : {}),
            };

      return {
        content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
      };
    } catch (error: any) {
      return {
        content: [{ type: 'text', text: `Error: ${error.message || String(error)}` }],
        isError: true,
      };
    }
  });

  return server;
}

async function startStdio(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // stderr only — stdout is the MCP protocol stream
  console.error(`cloud-agent-mastra MCP (stdio) ready; stack=${process.env.GPU_INFERENCE_STACK_DIR}`);
}

async function startSse(): Promise<void> {
  const server = createMcpServer();
  const transports: Record<string, SSEServerTransport> = {};

  const httpServer = http.createServer(async (req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      transports[transport.sessionId] = transport;
      transport.onclose = () => {
        delete transports[transport.sessionId];
      };
      transport.onerror = (error) => {
        console.error('SSE transport error:', error);
      };
      await server.connect(transport);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/messages') {
      const sessionId = url.searchParams.get('sessionId');
      if (!sessionId || !transports[sessionId]) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid or missing sessionId' }));
        return;
      }
      await transports[sessionId].handlePostMessage(req, res);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          ok: true,
          transport: 'sse',
          tools: Object.keys(tools),
          stackDir: process.env.GPU_INFERENCE_STACK_DIR,
        }),
      );
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  });

  httpServer.listen(PORT, () => {
    console.error(`MCP SSE listening on http://127.0.0.1:${PORT}/sse`);
  });
}

async function main(): Promise<void> {
  if (TRANSPORT === 'sse' || TRANSPORT === 'http') {
    await startSse();
  } else {
    await startStdio();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
