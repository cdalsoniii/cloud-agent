"use client";

import React, { useState, useEffect, useRef } from "react";

interface DiagramViewerProps {
  mcpDefinition: unknown;
  type?: "mermaid" | "flow";
}

export default function DiagramViewer({
  mcpDefinition,
  type = "mermaid",
}: DiagramViewerProps) {
  const [svg, setSvg] = useState<string>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!mcpDefinition) {
      setSvg("");
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    const renderDiagram = async () => {
      try {
        if (type === "mermaid") {
          const response = await fetch("/api/diagram", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ mcpDefinition }),
          });

          if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
          }

          const data = await response.json();
          if (data.svg) {
            setSvg(data.svg);
          } else if (data.mermaid) {
            const mermaid = await import("mermaid");
            mermaid.default.initialize({ startOnLoad: false, theme: "default" });
            const id = `mermaid-${Date.now()}`;
            const result = await mermaid.default.render(id, data.mermaid);
            setSvg(result.svg);
          } else {
            throw new Error("No diagram data returned");
          }
        } else {
          const { generateFlowNodes } = await import("@/lib/diagram-engine");
          const flowData = generateFlowNodes(mcpDefinition);
          setSvg(
            `<div class="flow-diagram">Flow diagram with ${flowData.nodes.length} nodes and ${flowData.edges.length} edges</div>`
          );
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to render diagram");
      } finally {
        setLoading(false);
      }
    };

    renderDiagram();
  }, [mcpDefinition, type]);

  if (!mcpDefinition) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
          State Diagram
        </h2>
        <div className="text-gray-500 dark:text-gray-400 text-center py-8">
          Generate an MCP tool to see the diagram
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-lg shadow p-6">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        State Diagram
      </h2>
      <div
        data-testid="state-diagram"
        className="mermaid-container"
        ref={containerRef}
      >
        {loading && (
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto"></div>
            <p className="mt-2 text-gray-500 dark:text-gray-400">Rendering diagram...</p>
          </div>
        )}
        {error && (
          <div className="text-red-500 dark:text-red-400 text-center py-8">
            Error: {error}
          </div>
        )}
        {!loading && !error && svg && (
          <div dangerouslySetInnerHTML={{ __html: svg }} />
        )}
      </div>
    </div>
  );
}
