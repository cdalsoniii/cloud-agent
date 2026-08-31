/**
 * CLI used by host hooks — calls the same handlers as MCP (local entry, not remote MCP process).
 */
import { parseArgs } from 'node:util';
// scripts → plugin → plugins → .grok → repo root
import { handlePxOntologyScope } from '../../../../src/verification-sandbox/handlers.js';

async function main() {
  const { values } = parseArgs({
    options: {
      text: { type: 'string' },
      pack: { type: 'string' },
      tool: { type: 'string' },
    },
    allowPositionals: true,
  });
  const r = await handlePxOntologyScope({
    text: values.text,
    pack: values.pack,
    tool: values.tool || 'user_prompt',
  });
  process.stdout.write(JSON.stringify(r));
}

main().catch((e) => {
  process.stderr.write(String(e));
  process.exit(1);
});
