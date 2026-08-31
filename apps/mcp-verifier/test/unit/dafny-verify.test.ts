import { describe, it, expect } from '@jest/globals';
import { verifyWithDafny } from '../../lib/dafny-runtime';

describe('Dafny verification', () => {
  it('validates MCP schema with correct predicates', async () => {
    const result = await verifyWithDafny({
      spec: 'predicate ValidSchema; predicate ValidType;',
      target: 'mcp-schema',
    });
    expect(result.verified).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('fails when predicates are missing', async () => {
    const result = await verifyWithDafny({
      spec: 'method foo() {}',
      target: 'mcp-schema',
    });
    expect(result.verified).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('validates UI state', async () => {
    const result = await verifyWithDafny({
      spec: 'predicate ValidSchema; predicate ValidType; predicate ValidState;',
      target: 'ui-state',
    });
    expect(result.verified).toBe(true);
  });

  it('validates diagram', async () => {
    const result = await verifyWithDafny({
      spec: 'predicate ValidSchema; predicate ValidType; predicate ValidDiagram;',
      target: 'diagram',
    });
    expect(result.verified).toBe(true);
  });
});
