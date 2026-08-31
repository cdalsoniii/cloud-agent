'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Editor from '@monaco-editor/react';
import { editor } from 'monaco-editor';
import { createTwoFilesPatch } from 'diff';
import {
  Split,
  Columns2,
  ArrowLeftRight,
  GitCommit,
  X,
  ChevronDown,
  ChevronUp,
  Check,
  AlertTriangle,
} from 'lucide-react';

export interface OntologyDiffViewerProps {
  original: string;
  modified: string;
  versionFrom: number;
  versionTo: number;
  onClose?: () => void;
}

type DiffMode = 'split' | 'inline';

export default function OntologyDiffViewer({
  original,
  modified,
  versionFrom,
  versionTo,
  onClose,
}: OntologyDiffViewerProps) {
  const [mode, setMode] = useState<DiffMode>('split');
  const [showLineNumbers, setShowLineNumbers] = useState(true);
  const [diffPatch, setDiffPatch] = useState('');
  const [stats, setStats] = useState({ additions: 0, deletions: 0, changes: 0 });
  const [expandedSections, setExpandedSections] = useState<Set<number>>(new Set());

  // Calculate unified diff using 'diff' library
  useEffect(() => {
    const patch = createTwoFilesPatch(
      `ontology-v${versionFrom}.yaml`,
      `ontology-v${versionTo}.yaml`,
      original,
      modified,
      '',
      '',
      { context: 3 }
    );
    setDiffPatch(patch);

    // Calculate stats
    let additions = 0;
    let deletions = 0;
    const lines = patch.split('\n');
    for (const line of lines) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        additions++;
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        deletions++;
      }
    }
    setStats({
      additions,
      deletions,
      changes: Math.min(additions, deletions),
    });
  }, [original, modified, versionFrom, versionTo]);

  // Generate inline diff (simplified unified diff)
  const inlineDiff = useCallback(() => {
    return diffPatch;
  }, [diffPatch]);

  const toggleSection = useCallback((index: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Parse diff into sections for rendering
  const diffSections = useCallback(() => {
    const lines = diffPatch.split('\n');
    const sections: Array<{
      header: string;
      lines: Array<{ type: 'add' | 'remove' | 'context' | 'header'; content: string; lineNum?: number }>;
    }> = [];

    let currentSection: typeof sections[0] | null = null;
    let originalLineNum = 0;
    let modifiedLineNum = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      if (line.startsWith('@@')) {
        // Start of a new hunk
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = {
          header: line,
          lines: [{ type: 'header', content: line }],
        };

        // Parse line numbers from @@ -a,b +c,d @@
        const match = line.match(/@@ -(\d+),\d+ \+(\d+),\d+ @@/);
        if (match) {
          originalLineNum = parseInt(match[1], 10) - 1;
          modifiedLineNum = parseInt(match[2], 10) - 1;
        }
      } else if (currentSection) {
        if (line.startsWith('+') && !line.startsWith('+++')) {
          modifiedLineNum++;
          currentSection.lines.push({
            type: 'add',
            content: line.substring(1),
            lineNum: modifiedLineNum,
          });
        } else if (line.startsWith('-') && !line.startsWith('---')) {
          originalLineNum++;
          currentSection.lines.push({
            type: 'remove',
            content: line.substring(1),
            lineNum: originalLineNum,
          });
        } else if (line.startsWith(' ')) {
          originalLineNum++;
          modifiedLineNum++;
          currentSection.lines.push({
            type: 'context',
            content: line.substring(1),
            lineNum: modifiedLineNum,
          });
        } else if (line.startsWith('\\')) {
          // "No newline at end of file" marker
          currentSection.lines.push({
            type: 'context',
            content: line,
          });
        }
      }
    }

    if (currentSection) {
      sections.push(currentSection);
    }

    return sections;
  }, [diffPatch]);

  const sections = diffSections();

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <GitCommit className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            <div className="flex items-center gap-1 text-sm">
              <span className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded text-gray-700 dark:text-gray-300 font-mono">
                v{versionFrom}
              </span>
              <ArrowLeftRight className="w-4 h-4 text-gray-400" />
              <span className="px-2 py-0.5 bg-blue-100 dark:bg-blue-900/30 rounded text-blue-700 dark:text-blue-400 font-mono">
                v{versionTo}
              </span>
            </div>
          </div>

          {/* Stats */}
          <div className="flex items-center gap-2 text-xs">
            <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
              <span className="w-2 h-2 bg-green-500 rounded-full" />
              +{stats.additions}
            </span>
            <span className="flex items-center gap-1 text-red-600 dark:text-red-400">
              <span className="w-2 h-2 bg-red-500 rounded-full" />
              -{stats.deletions}
            </span>
            {stats.changes > 0 && (
              <span className="flex items-center gap-1 text-yellow-600 dark:text-yellow-400">
                <span className="w-2 h-2 bg-yellow-500 rounded-full" />
                ~{stats.changes}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Mode toggle */}
          <div className="flex items-center bg-gray-100 dark:bg-gray-800 rounded-lg p-0.5">
            <button
              onClick={() => setMode('split')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                mode === 'split'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Columns2 className="w-3 h-3" />
              Split
            </button>
            <button
              onClick={() => setMode('inline')}
              className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${
                mode === 'inline'
                  ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
              }`}
            >
              <Split className="w-3 h-3" />
              Inline
            </button>
          </div>

          {onClose && (
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
              title="Close"
            >
              <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            </button>
          )}
        </div>
      </div>

      {/* Diff content */}
      {mode === 'split' ? (
        <div className="flex-1 flex min-h-0">
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-1 bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400 font-mono">
              v{versionFrom} (original)
            </div>
            <div className="flex-1 overflow-auto">
              <Editor
                height="100%"
                language="yaml"
                value={original}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: showLineNumbers ? 'on' : 'off',
                  wordWrap: 'on',
                  folding: true,
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  tabSize: 2,
                  renderLineHighlight: 'none',
                  renderWhitespace: 'selection',
                  padding: { top: 8, bottom: 8 },
                }}
                theme="vs-dark"
              />
            </div>
          </div>
          <div className="w-px bg-gray-200 dark:bg-gray-700" />
          <div className="flex-1 flex flex-col">
            <div className="px-3 py-1 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800 text-xs text-blue-600 dark:text-blue-400 font-mono">
              v{versionTo} (modified)
            </div>
            <div className="flex-1 overflow-auto">
              <Editor
                height="100%"
                language="yaml"
                value={modified}
                options={{
                  readOnly: true,
                  minimap: { enabled: false },
                  lineNumbers: showLineNumbers ? 'on' : 'off',
                  wordWrap: 'on',
                  folding: true,
                  scrollBeyondLastLine: false,
                  fontSize: 13,
                  tabSize: 2,
                  renderLineHighlight: 'none',
                  renderWhitespace: 'selection',
                  padding: { top: 8, bottom: 8 },
                }}
                theme="vs-dark"
              />
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="font-mono text-sm">
            {/* Diff header */}
            <div className="px-4 py-2 bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400 text-xs">
              <div>--- ontology-v{versionFrom}.yaml</div>
              <div>+++ ontology-v{versionTo}.yaml</div>
            </div>

            {/* Diff sections */}
            {sections.map((section, sectionIdx) => (
              <div key={sectionIdx} className="border-b border-gray-100 dark:border-gray-800">
                {/* Hunk header */}
                <button
                  onClick={() => toggleSection(sectionIdx)}
                  className="w-full flex items-center gap-2 px-4 py-1.5 bg-gray-50 dark:bg-gray-900/50 hover:bg-gray-100 dark:hover:bg-gray-800 text-xs text-gray-500 dark:text-gray-400 font-mono transition-colors"
                >
                  {expandedSections.has(sectionIdx) ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                  {section.header}
                </button>

                {/* Hunk lines */}
                {expandedSections.has(sectionIdx) && (
                  <div>
                    {section.lines.slice(1).map((line, lineIdx) => (
                      <div
                        key={lineIdx}
                        className={`flex px-4 py-0.5 ${
                          line.type === 'add'
                            ? 'bg-green-50 dark:bg-green-900/20 hover:bg-green-100 dark:hover:bg-green-900/30'
                            : line.type === 'remove'
                            ? 'bg-red-50 dark:bg-red-900/20 hover:bg-red-100 dark:hover:bg-red-900/30'
                            : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                        }`}
                      >
                        {showLineNumbers && (
                          <span className="w-12 text-right mr-4 text-xs text-gray-400 dark:text-gray-600 select-none">
                            {line.lineNum || ''}
                          </span>
                        )}
                        <span className="w-4 text-center select-none mr-2">
                          {line.type === 'add' && (
                            <span className="text-green-600 dark:text-green-400">+</span>
                          )}
                          {line.type === 'remove' && (
                            <span className="text-red-600 dark:text-red-400">-</span>
                          )}
                          {line.type === 'context' && (
                            <span className="text-gray-400 dark:text-gray-600"> </span>
                          )}
                        </span>
                        <span
                          className={`${
                            line.type === 'add'
                              ? 'text-green-800 dark:text-green-300'
                              : line.type === 'remove'
                              ? 'text-red-800 dark:text-red-300'
                              : 'text-gray-700 dark:text-gray-300'
                          }`}
                        >
                          {line.content || '\u00A0'}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {sections.length === 0 && (
              <div className="flex items-center justify-center h-32 text-gray-500 dark:text-gray-400">
                <Check className="w-5 h-5 mr-2 text-green-500" />
                No differences found
              </div>
            )}
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-3">
          <span>{original.split('\n').length} lines (original)</span>
          <span>{modified.split('\n').length} lines (modified)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowLineNumbers(!showLineNumbers)}
            className="text-xs hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            {showLineNumbers ? 'Hide' : 'Show'} line numbers
          </button>
        </div>
      </div>
    </div>
  );
}
