/**
 * Smoke-test cloud-agent-mastra MCP over stdio: initialize + tools/list + env-validation.
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const launcher = path.join(root, 'scripts/run-mastra-mcp.sh');

const transport = new StdioClientTransport({
  command: 'bash',
  args: [launcher],
  env: {
    ...process.env,
    MCP_TRANSPORT: 'stdio',
    SANDBOX_PROVIDER: 'daytona',
    GPU_INFERENCE_STACK_DIR:
      process.env.GPU_INFERENCE_STACK_DIR ||
      path.resolve(root, '../gpu-inference-stack'),
  },
});

const client = new Client({ name: 'mastra-mcp-smoke', version: '1.0.0' });
await client.connect(transport);

const listed = await client.listTools();
const names = listed.tools.map((t) => t.name).sort();
console.log('TOOLS', names.join(', '));

const expected = [
  'env-validation',
  'daytona-create',
  'daytona-bootstrap',
  'daytona-connectivity',
  'daytona-exec',
  'daytona-shell',
  'daytona-destroy',
  'opencode-loop',
  'sdlc-batch',
  'mastra-orchestrate',
  'verify-rule',
];
const missing = expected.filter((n) => !names.includes(n));
if (missing.length) {
  console.error('MISSING_TOOLS', missing);
  process.exit(1);
}

const envResult = await client.callTool({
  name: 'env-validation',
  arguments: {},
});
console.log('ENV_VALIDATION', envResult.content?.[0]?.text?.slice(0, 500));

const createDry = await client.callTool({
  name: 'daytona-create',
  arguments: { dryRun: true },
});
console.log('DAYTONA_CREATE_DRY', createDry.content?.[0]?.text?.slice(0, 400));

await client.close();
console.log('MCP_SMOKE_OK');
