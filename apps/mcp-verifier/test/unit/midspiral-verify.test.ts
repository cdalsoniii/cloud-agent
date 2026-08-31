import { describe, it, expect } from '@jest/globals';
import { verifyWithMidspiral } from '../../lib/midspiral-client';

describe('Midspiral verification', () => {
  it('validates MCP schema rule', async () => {
    const result = await verifyWithMidspiral({
      ruleId: 'rule-mcp-schema-valid',
      state: {
        name: 'test',
        schema: { type: 'object', properties: { foo: { type: 'string' } }, required: ['foo'] },
        valid: true,
        json: true,
        definitions: {},
      },
    });
    expect(result.verified).toBe(true);
    expect(result.coverage).toBeGreaterThanOrEqual(50);
  });

  it('fails invalid rule', async () => {
    const result = await verifyWithMidspiral({
      ruleId: 'nonexistent',
      state: {},
    });
    expect(result.verified).toBe(false);
  });

  it('validates diagram renders rule', async () => {
    const result = await verifyWithMidspiral({
      ruleId: 'rule-diagram-renders',
      state: {
        diagram: 'flowchart',
        nodes: [{ id: '1', label: 'A' }, { id: '2', label: 'B' }],
        edges: [{ id: 'e1', source: '1', target: '2' }],
        render: 'svg',
        errors: [],
        visible: true,
        output: 'success',
      },
    });
    expect(result.verified).toBe(true);
  });
});
