'use client';

interface StateInspectorProps {
  state: Record<string, unknown>;
}

function StateTree({ data, depth = 0 }: { data: unknown; depth?: number }) {
  const indent = depth * 20;

  if (data === null || data === undefined) {
    return (
      <div style={{ marginLeft: `${indent}px` }} className="text-gray-500">
        {String(data)}
      </div>
    );
  }

  if (typeof data === 'object' && !Array.isArray(data)) {
    const obj = data as Record<string, unknown>;
    const entries = Object.entries(obj);

    if (entries.length === 0) {
      return (
        <div style={{ marginLeft: `${indent}px` }} className="text-gray-500">
          {'{}'}
        </div>
      );
    }

    return (
      <div style={{ marginLeft: `${indent}px` }}>
        {entries.map(([key, value]) => (
          <div key={key} className="border-l-2 border-gray-200 pl-3 py-1">
            <span className="font-medium text-blue-600">{key}:</span>
            <StateTree data={value} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <div style={{ marginLeft: `${indent}px` }} className="text-gray-500">
          {'[]'}
        </div>
      );
    }

    return (
      <div style={{ marginLeft: `${indent}px` }}>
        {data.map((item, index) => (
          <div key={index} className="border-l-2 border-gray-200 pl-3 py-1">
            <span className="font-medium text-purple-600">[{index}]:</span>
            <StateTree data={item} depth={depth + 1} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div style={{ marginLeft: `${indent}px` }} className="font-mono text-sm text-gray-700">
      {typeof data === 'string' ? `"${data}"` : String(data)}
    </div>
  );
}

export default function StateInspector({ state }: StateInspectorProps) {
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold mb-4">State Inspector</h2>
      
      <div data-testid="state-inspector">
        {Object.keys(state).length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No state available
          </div>
        ) : (
          <div className="bg-gray-50 rounded-md p-4 overflow-x-auto">
            <StateTree data={state} />
          </div>
        )}
      </div>
    </div>
  );
}