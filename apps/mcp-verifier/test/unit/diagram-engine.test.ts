import { describe, it, expect } from '@jest/globals';
import {
  generateMermaidFromMCP,
  validateDiagramData,
  generateFlowNodes,
} from '../../lib/diagram-engine';

describe('Diagram engine', () => {
  const sampleMCP = {
    name: 'WeatherTool',
    description: 'Fetch weather data',
    inputSchema: {
      type: 'object',
      properties: { location: { type: 'string' } },
    },
    outputSchema: {
      type: 'object',
      properties: { temperature: { type: 'number' } },
    },
  };

  it('generates mermaid from MCP', () => {
    const result = generateMermaidFromMCP(sampleMCP);
    expect(result).toContain('flowchart TD');
    expect(result).toContain('WeatherTool');
  });

  it('validates correct diagram', () => {
    const data = {
      nodes: [{ id: '1', label: 'A' }, { id: '2', label: 'B' }],
      edges: [{ id: 'e1', source: '1', target: '2' }],
    };
    const result = validateDiagramData(data);
    expect(result.valid).toBe(true);
    expect(result.errors.length).toBe(0);
  });

  it('catches duplicate node IDs', () => {
    const data = {
      nodes: [{ id: '1', label: 'A' }, { id: '1', label: 'B' }],
      edges: [],
    };
    const result = validateDiagramData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('Duplicate'))).toBe(true);
  });

  it('catches missing edge source', () => {
    const data = {
      nodes: [{ id: '1', label: 'A' }],
      edges: [{ id: 'e1', source: '2', target: '1' }],
    };
    const result = validateDiagramData(data);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e: string) => e.includes('does not exist'))).toBe(true);
  });

  it('generates flow nodes', () => {
    const result = generateFlowNodes(sampleMCP);
    expect(result.nodes.length).toBeGreaterThan(0);
    expect(result.edges.length).toBeGreaterThan(0);
  });
});
