'use client';

import { useState } from 'react';

interface McpGeneratorProps {
  onGenerate?: (mcp: Record<string, unknown>) => void;
}

export default function McpGenerator({ onGenerate }: McpGeneratorProps) {
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);

  const handleGenerate = async () => {
    if (!description.trim()) return;

    setLoading(true);
    try {
      const response = await fetch('/api/generate-mcp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: description.trim() }),
      });

      if (response.status === 401) {
        setResult({ error: 'Please sign in to generate MCP tools' });
        return;
      }
      if (response.status === 403) {
        setResult({ error: 'Developer access required. Contact an administrator.' });
        return;
      }
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      setResult(data);
      onGenerate?.(data);
    } catch (error) {
      console.error('Failed to generate MCP:', error);
      setResult({ error: 'Failed to generate MCP tool' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-4">MCP Tool Generator</h2>
      
      <div className="space-y-4">
        <div>
          <label htmlFor="tool-description" className="block text-sm font-medium text-gray-700 mb-2">
            Tool Description
          </label>
          <textarea
            id="tool-description"
            data-testid="tool-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the MCP tool you want to generate..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            rows={4}
          />
        </div>

        <button
          data-testid="generate-button"
          onClick={handleGenerate}
          disabled={loading || !description.trim()}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="flex items-center justify-center">
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
              Generating...
            </div>
          ) : (
            'Generate MCP'
          )}
        </button>

        {result && (
          <div className="mt-6">
            <h3 className="text-lg font-medium mb-2">Generated Result</h3>
            <pre className="bg-gray-100 p-4 rounded-md overflow-x-auto text-sm">
              <code>{JSON.stringify(result, null, 2)}</code>
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
