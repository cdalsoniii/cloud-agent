import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  bareToolName,
  extractToolPayload,
  isValidationSurfaceTool,
} from './io-enforcement.js';
import { isGatedMcpTool } from './pack-resolve.js';

describe('io-enforcement helpers', () => {
  it('bareToolName strips MCP server prefix', () => {
    assert.equal(bareToolName('cloud-agent-mastra__daytona-exec'), 'daytona-exec');
    assert.equal(bareToolName('daytona-shell'), 'daytona-shell');
  });

  it('validation surface tools recognized', () => {
    assert.equal(isValidationSurfaceTool('tool_io_guard'), true);
    assert.equal(isValidationSurfaceTool('px_ontology_scope'), true);
    assert.equal(isValidationSurfaceTool('cloud-agent-mastra__px_validate_cascade'), true);
    assert.equal(isValidationSurfaceTool('daytona-exec'), false);
  });

  it('extractToolPayload prefers payload/data/command', () => {
    assert.deepEqual(extractToolPayload('x', { payload: { a: 1 } }), { a: 1 });
    assert.deepEqual(extractToolPayload('x', { data: { b: 2 } }), { b: 2 });
    const cmd = extractToolPayload('run_terminal_command', { command: 'ls -la' }) as {
      command: string;
    };
    assert.equal(cmd.command, 'ls -la');
  });

  it('write_file is not cascade-gated; daytona-exec is', () => {
    assert.equal(isGatedMcpTool('write_file'), false);
    assert.equal(isGatedMcpTool('search_replace'), false);
    assert.equal(isGatedMcpTool('daytona-exec'), true);
    assert.equal(isGatedMcpTool('cloud-agent-mastra__daytona-shell'), true);
    assert.equal(isGatedMcpTool('tool_io_guard'), false);
  });
});
