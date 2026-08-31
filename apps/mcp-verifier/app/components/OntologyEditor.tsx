'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { editor } from 'monaco-editor';
import { validateLinkML, toMonacoMarkers, ValidationResult } from '../../lib/linkml-validator';
import {
  Save,
  Undo,
  Redo,
  Check,
  AlertTriangle,
  X,
  GitCommit,
  RotateCcw,
  Maximize2,
  Minimize2,
} from 'lucide-react';

export interface OntologyEditorProps {
  content: string;
  onChange: (value: string) => void;
  onSave: (commitMessage?: string) => Promise<any>;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  version: number | null;
  isSaving: boolean;
  hasUnsavedChanges: boolean;
  error: string | null;
  lastSaved: string | null;
}

export default function OntologyEditor({
  content,
  onChange,
  onSave,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  version,
  isSaving,
  hasUnsavedChanges,
  error,
  lastSaved,
}: OntologyEditorProps) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<any>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [commitMessage, setCommitMessage] = useState('');
  const [showCommitInput, setShowCommitInput] = useState(false);
  const [editorHeight, setEditorHeight] = useState('calc(100% - 120px)');

  // Configure monaco-yaml on mount
  const handleEditorDidMount = useCallback(
    (editor: editor.IStandaloneCodeEditor, monaco: any) => {
      editorRef.current = editor;
      monacoRef.current = monaco;

      // Configure YAML language support
      monaco.languages.register({ id: 'yaml' });
      monaco.languages.setLanguageConfiguration('yaml', {
        brackets: [
          ['{', '}'],
          ['[', ']'],
          ['(', ')'],
        ],
        autoClosingPairs: [
          { open: '{', close: '}' },
          { open: '[', close: ']' },
          { open: '(', close: ')' },
          { open: '"', close: '"' },
          { open: "'", close: "'" },
        ],
        surroundingPairs: [
          { open: '{', close: '}' },
          { open: '[', close: ']' },
          { open: '(', close: ')' },
          { open: '"', close: '"' },
          { open: "'", close: "'" },
        ],
        indentationRules: {
          increaseIndentPattern: /^.*\{[^}"']*$/,
          decreaseIndentPattern: /^\s*\}/,
        },
      });

      // Set YAML syntax highlighting tokens
      monaco.languages.setMonarchTokensProvider('yaml', {
        tokenPostfix: '.yaml',
        brackets: [
          { token: 'delimiter.bracket', open: '{', close: '}' },
          { token: 'delimiter.square', open: '[', close: ']' },
        ],
        keywords: [
          'true', 'True', 'TRUE', 'false', 'False', 'FALSE',
          'null', 'Null', 'NULL', 'yes', 'Yes', 'YES', 'no', 'No', 'NO',
          'on', 'On', 'ON', 'off', 'Off', 'OFF',
        ],
        numberInteger: /(?:0|[+-]?[0-9]+)/,
        numberFloat: /(?:0|[+-]?[0-9]+)(?:\.[0-9]+)?(?:[eE][-+]?[1-9][0-9]*)?/,
        numberOctal: /0o[0-7]+/,
        numberHex: /0x[0-9a-fA-F]+/,
        numberInfinity: /[+-]?\.inf/,
        numberNaN: /\.NaN/,
        numberDate: /\d{4}-\d\d?-\d\d?(?:(?:[ \t]+)\d\d?:\d\d?\:\d\d?\.\d+)?(?:[ \t]*(?:Z|[+-]\d\d?\:\d\d?))?/,
        escapes: /\\(?:[btnfr\\"']|[0-7][0-7]?|[0-3][0-7]{2})/,
        tokenizer: {
          root: [
            { include: '@whitespace' },
            { include: '@comment' },
            [/\|.*$/, 'string.literal'],
            [/>.*$/, 'string.literal'],
            [/@numberDate/, 'number.date'],
            [/@numberInteger(?![\w.+-])/, 'number'],
            [/@numberFloat(?![\w.+-])/, 'number.float'],
            [/@numberInfinity/, 'number'],
            [/@numberNaN/, 'number'],
            [/@numberHex/, 'number.hex'],
            [/@numberOctal/, 'number.octal'],
            [/\$\w+/, 'variable.predefined'],
            [/\w+\!/, 'keyword.type'],
            [
              /([\w\-]+)(:)/,
              [
                { cases: { '@keywords': 'keyword', '@default': 'key' } },
                'delimiter',
              ],
            ],
            [/\w+/, { cases: { '@keywords': 'keyword', '@default': 'string' } }],
            { include: '@string' },
          ],
          string: [
            [/'.*$/, 'string.single'],
            [/"/, 'string.double', '@string_double'],
          ],
          string_double: [
            [/[^\\"]+/, 'string.double'],
            [/@escapes/, 'string.escape'],
            [/\\./, 'string.escape.invalid'],
            [/"/, 'string.double', '@pop'],
          ],
          whitespace: [
            [/[ \t\r\n]+/, 'white'],
          ],
          comment: [
            [/#.*$/, 'comment'],
          ],
        },
      });

      // Set editor theme colors
      monaco.editor.defineTheme('yaml-light', {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'key', foreground: '0451A5', fontStyle: 'bold' },
          { token: 'string', foreground: 'A31515' },
          { token: 'string.double', foreground: 'A31515' },
          { token: 'string.single', foreground: 'A31515' },
          { token: 'number', foreground: '098658' },
          { token: 'number.float', foreground: '098658' },
          { token: 'keyword', foreground: '0000FF' },
          { token: 'keyword.type', foreground: '0000FF' },
          { token: 'comment', foreground: '008000' },
          { token: 'delimiter', foreground: '000000' },
          { token: 'variable.predefined', foreground: '0451A5' },
        ],
        colors: {
          'editor.background': '#ffffff',
          'editor.lineHighlightBackground': '#f0f0f0',
          'editorLineNumber.foreground': '#237893',
          'editorLineNumber.activeForeground': '#0B216F',
        },
      });

      monaco.editor.defineTheme('yaml-dark', {
        base: 'vs-dark',
        inherit: true,
        rules: [
          { token: 'key', foreground: '9CDCFE', fontStyle: 'bold' },
          { token: 'string', foreground: 'CE9178' },
          { token: 'string.double', foreground: 'CE9178' },
          { token: 'string.single', foreground: 'CE9178' },
          { token: 'number', foreground: 'B5CEA8' },
          { token: 'number.float', foreground: 'B5CEA8' },
          { token: 'keyword', foreground: '569CD6' },
          { token: 'keyword.type', foreground: '4EC9B0' },
          { token: 'comment', foreground: '6A9955' },
          { token: 'delimiter', foreground: 'D4D4D4' },
          { token: 'variable.predefined', foreground: '9CDCFE' },
        ],
        colors: {
          'editor.background': '#1f2937',
          'editor.lineHighlightBackground': '#2d3748',
          'editorLineNumber.foreground': '#858585',
          'editorLineNumber.activeForeground': '#C6C6C6',
        },
      });

      // Apply theme based on current mode
      const isDark = document.documentElement.classList.contains('dark');
      monaco.editor.setTheme(isDark ? 'yaml-dark' : 'yaml-light');

      // Add keyboard shortcuts
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        handleSave();
      });

      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyZ, () => {
        onUndo();
      });

      editor.addCommand(
        monaco.KeyMod.CtrlCmd | monaco.KeyMod.Shift | monaco.KeyCode.KeyZ,
        () => {
          onRedo();
        }
      );

      // Validate on mount
      validateContent(content);
    },
    [content, onUndo, onRedo]
  );

  const validateContent = useCallback((value: string) => {
    const result = validateLinkML(value);
    setValidationResult(result);

    // Update Monaco markers
    if (editorRef.current && monacoRef.current) {
      const model = editorRef.current.getModel();
      if (model) {
        const markers = toMonacoMarkers(result);
        monacoRef.current.editor.setModelMarkers(model, 'linkml-validator', markers);
      }
    }
  }, []);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        onChange(value);
        validateContent(value);
      }
    },
    [onChange, validateContent]
  );

  const handleSave = useCallback(async () => {
    if (showCommitInput && commitMessage.trim()) {
      await onSave(commitMessage.trim());
      setCommitMessage('');
      setShowCommitInput(false);
    } else {
      await onSave();
    }
  }, [onSave, showCommitInput, commitMessage]);

  const handleSaveWithCommit = useCallback(() => {
    if (hasUnsavedChanges) {
      setShowCommitInput(true);
    }
  }, [hasUnsavedChanges]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && showCommitInput) {
        setShowCommitInput(false);
      }
    },
    [showCommitInput]
  );

  // Update validation when content changes externally
  useEffect(() => {
    validateContent(content);
  }, [content, validateContent]);

  const errorCount = validationResult?.errors.length ?? 0;
  const warningCount = validationResult?.warnings.length ?? 0;

  return (
    <div className="flex flex-col h-full" onKeyDown={handleKeyDown}>
      {/* Toolbar */}
      <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-1">
          <button
            onClick={onUndo}
            disabled={!canUndo}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Undo (Ctrl+Z)"
          >
            <Undo className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
          <button
            onClick={onRedo}
            disabled={!canRedo}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            title="Redo (Ctrl+Shift+Z)"
          >
            <Redo className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />
          <button
            onClick={() => onChange('')}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Clear"
          >
            <X className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
          <button
            onClick={() => {
              // Reset to default - trigger via parent
              onChange('');
            }}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title="Reset"
          >
            <RotateCcw className="w-4 h-4 text-gray-600 dark:text-gray-400" />
          </button>
        </div>

        <div className="flex items-center gap-1">
          {/* Validation status */}
          <button
            onClick={() => setShowValidation(!showValidation)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors ${
              errorCount > 0
                ? 'bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 hover:bg-red-200 dark:hover:bg-red-900/50'
                : warningCount > 0
                ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 hover:bg-yellow-200 dark:hover:bg-yellow-900/50'
                : 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 hover:bg-green-200 dark:hover:bg-green-900/50'
            }`}
          >
            {errorCount > 0 ? (
              <AlertTriangle className="w-3 h-3" />
            ) : warningCount > 0 ? (
              <AlertTriangle className="w-3 h-3" />
            ) : (
              <Check className="w-3 h-3" />
            )}
            {errorCount > 0 ? `${errorCount} error${errorCount !== 1 ? 's' : ''}` : warningCount > 0 ? `${warningCount} warning${warningCount !== 1 ? 's' : ''}` : 'Valid'}
          </button>

          <div className="w-px h-4 bg-gray-300 dark:bg-gray-600 mx-1" />

          {/* Version info */}
          {version !== null && (
            <span className="text-xs text-gray-500 dark:text-gray-400">
              v{version}
            </span>
          )}

          {hasUnsavedChanges && (
            <span className="text-xs text-orange-500 dark:text-orange-400 font-medium">
              Modified
            </span>
          )}

          {/* Fullscreen toggle */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
          >
            {isFullscreen ? (
              <Minimize2 className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            ) : (
              <Maximize2 className="w-4 h-4 text-gray-600 dark:text-gray-400" />
            )}
          </button>

          {/* Save button */}
          <button
            onClick={handleSaveWithCommit}
            disabled={isSaving || !hasUnsavedChanges}
            className="flex items-center gap-1 px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm font-medium"
          >
            {isSaving ? (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            ) : (
              <Save className="w-4 h-4" />
            )}
            Save
          </button>
        </div>
      </div>

      {/* Commit message input */}
      {showCommitInput && (
        <div className="flex items-center gap-2 p-2 bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
          <GitCommit className="w-4 h-4 text-blue-600 dark:text-blue-400 flex-shrink-0" />
          <input
            type="text"
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                handleSave();
              } else if (e.key === 'Escape') {
                setShowCommitInput(false);
              }
            }}
            placeholder="Commit message (optional)..."
            className="flex-1 px-2 py-1 text-sm bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded focus:outline-none focus:ring-2 focus:ring-blue-500 dark:text-white"
            autoFocus
          />
          <button
            onClick={handleSave}
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors"
          >
            Commit
          </button>
          <button
            onClick={() => setShowCommitInput(false)}
            className="px-2 py-1 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 text-sm"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="flex items-center gap-2 p-2 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-800 text-red-700 dark:text-red-400 text-sm">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Validation panel */}
      {showValidation && validationResult && (
        <div className="flex-shrink-0 max-h-40 overflow-y-auto bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-2">
          <div className="space-y-1">
            {validationResult.errors.map((err, idx) => (
              <div
                key={`error-${idx}`}
                className="flex items-start gap-2 text-xs text-red-700 dark:text-red-400 p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 cursor-pointer"
                onClick={() => {
                  if (editorRef.current) {
                    editorRef.current.revealLineInCenter(err.line);
                    editorRef.current.setPosition({ lineNumber: err.line, column: err.column });
                    editorRef.current.focus();
                  }
                }}
              >
                <X className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Line {err.line}: {err.message}</span>
              </div>
            ))}
            {validationResult.warnings.map((warn, idx) => (
              <div
                key={`warning-${idx}`}
                className="flex items-start gap-2 text-xs text-yellow-700 dark:text-yellow-400 p-1 rounded hover:bg-yellow-50 dark:hover:bg-yellow-900/20 cursor-pointer"
                onClick={() => {
                  if (editorRef.current) {
                    editorRef.current.revealLineInCenter(warn.line);
                    editorRef.current.setPosition({ lineNumber: warn.line, column: warn.column });
                    editorRef.current.focus();
                  }
                }}
              >
                <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" />
                <span>Line {warn.line}: {warn.message}</span>
              </div>
            ))}
            {validationResult.errors.length === 0 && validationResult.warnings.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-green-700 dark:text-green-400">
                <Check className="w-3 h-3" />
                No issues found
              </div>
            )}
          </div>
        </div>
      )}

      {/* Monaco Editor */}
      <div className="flex-1 min-h-0">
        <Editor
          height={isFullscreen ? '100vh' : '100%'}
          language="yaml"
          value={content}
          onChange={handleEditorChange}
          onMount={handleEditorDidMount}
          options={{
            minimap: { enabled: false },
            lineNumbers: 'on',
            wordWrap: 'on',
            automaticLayout: true,
            scrollBeyondLastLine: false,
            fontSize: 14,
            tabSize: 2,
            insertSpaces: true,
            folding: true,
            foldingHighlight: true,
            showFoldingControls: 'always',
            bracketPairColorization: { enabled: true },
            guides: {
              bracketPairs: true,
              indentation: true,
            },
            renderWhitespace: 'selection',
            formatOnPaste: true,
            formatOnType: true,
            quickSuggestions: true,
            suggestOnTriggerCharacters: true,
            acceptSuggestionOnCommitCharacter: true,
            parameterHints: { enabled: true },
            hover: { enabled: true },
            contextmenu: true,
            mouseWheelZoom: true,
            roundedSelection: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            smoothScrolling: true,
            padding: { top: 16, bottom: 16 },
          }}
          theme="yaml-dark"
        />
      </div>

      {/* Status bar */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 dark:bg-gray-900 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-500 dark:text-gray-400">
        <div className="flex items-center gap-3">
          <span>YAML</span>
          <span>{content.split('\n').length} lines</span>
          <span>{content.length} chars</span>
        </div>
        <div>
          {lastSaved && (
            <span>Last saved: {new Date(lastSaved).toLocaleString()}</span>
          )}
        </div>
      </div>
    </div>
  );
}
