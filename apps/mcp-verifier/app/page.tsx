'use client';

import React, { useState, useCallback } from 'react';
import Link from 'next/link';
import { useAuth } from '../hooks/useAuth';
import { useOntology } from '../hooks/useOntology';
import CollapsibleSidebar from './components/CollapsibleSidebar';
import OntologyEditor from './components/OntologyEditor';
import OntologyDiffViewer from './components/OntologyDiffViewer';
import {
  GitBranch,
  History,
  Layers,
  Eye,
  EyeOff,
  ChevronRight,
  FileCode,
  GitCommit,
  ArrowLeftRight,
  Check,
} from 'lucide-react';

export default function HomePage() {
  const { isSignedIn, isDeveloper, isLoaded } = useAuth();
  const ontology = useOntology();
  const [showDiff, setShowDiff] = useState(false);
  const [diffVersions, setDiffVersions] = useState<{ from: number; to: number } | null>(null);
  const [showVersionHistory, setShowVersionHistory] = useState(false);
  const [versions, setVersions] = useState<Array<{ version: number; created_at: string; commit_message?: string }>>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  const handleShowDiff = useCallback(async (versionFrom: number, versionTo: number) => {
    setDiffVersions({ from: versionFrom, to: versionTo });
    setShowDiff(true);
  }, []);

  const handleCloseDiff = useCallback(() => {
    setShowDiff(false);
    setDiffVersions(null);
  }, []);

  const handleLoadVersions = useCallback(async () => {
    if (showVersionHistory) {
      setShowVersionHistory(false);
      return;
    }

    setIsLoadingVersions(true);
    try {
      const response = await fetch('/api/ontology?versions=true');
      if (response.ok) {
        const data = await response.json();
        setVersions(data.versions || []);
        setShowVersionHistory(true);
      }
    } catch (error) {
      console.error('Failed to load versions:', error);
    } finally {
      setIsLoadingVersions(false);
    }
  }, [showVersionHistory]);

  const handleLoadVersion = useCallback(async (version: number) => {
    try {
      const response = await fetch(`/api/ontology?version=${version}`);
      if (response.ok) {
        const data = await response.json();
        ontology.setContent(data.content);
      }
    } catch (error) {
      console.error('Failed to load version:', error);
    }
  }, [ontology]);

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  const isAuthorized = isSignedIn && isDeveloper;

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex flex-col">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <FileCode className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                MCP Verifier
              </h1>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
                Generate and verify MCP tools with Dafny and Midspiral
              </p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            {isSignedIn ? (
              <div className="flex items-center gap-3">
                {isDeveloper && (
                  <Link
                    href="/developer"
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                  >
                    Developer Dashboard
                  </Link>
                )}
                <div className="text-sm text-gray-600 dark:text-gray-400">
                  {isDeveloper ? 'Developer Mode' : 'Standard User'}
                </div>
              </div>
            ) : (
              <Link
                href="/login"
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors text-sm font-medium"
              >
                Sign In
              </Link>
            )}
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        {/* Ontology Editor Sidebar */}
        {isAuthorized && (
          <CollapsibleSidebar
            title="Ontology Editor"
            defaultCollapsed={false}
            width={600}
            collapsedWidth={48}
          >
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Toolbar */}
              <div className="flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700">
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleLoadVersions}
                    disabled={isLoadingVersions}
                    className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-300 transition-colors"
                    title="Version History"
                  >
                    <History className="w-4 h-4" />
                    {!showVersionHistory ? 'History' : 'Hide'}
                  </button>
                  <div className="w-px h-4 bg-gray-300 dark:bg-gray-600" />
                  <button
                    onClick={() => {
                      if (ontology.state.version !== null) {
                        handleShowDiff(ontology.state.version - 1, ontology.state.version);
                      }
                    }}
                    disabled={!ontology.state.version || ontology.state.version <= 1}
                    className="flex items-center gap-1 px-2 py-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-700 text-sm text-gray-700 dark:text-gray-300 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Compare with Previous"
                  >
                    <ArrowLeftRight className="w-4 h-4" />
                    Diff
                  </button>
                </div>
                <div className="flex items-center gap-2">
                  {ontology.state.version !== null && (
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      v{ontology.state.version}
                    </span>
                  )}
                  {ontology.state.hasUnsavedChanges && (
                    <span className="text-xs text-orange-500 dark:text-orange-400 font-medium">
                      Modified
                    </span>
                  )}
                </div>
              </div>

              {/* Version History Panel */}
              {showVersionHistory && (
                <div className="flex-shrink-0 max-h-48 overflow-y-auto bg-gray-50 dark:bg-gray-900 border-b border-gray-200 dark:border-gray-700 p-2">
                  <div className="text-xs font-semibold text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
                    <GitBranch className="w-3 h-3" />
                    Version History
                  </div>
                  {versions.length === 0 ? (
                    <p className="text-xs text-gray-500 dark:text-gray-400">No versions saved yet</p>
                  ) : (
                    <div className="space-y-1">
                      {versions.map((v) => (
                        <div
                          key={v.version}
                          className="flex items-center justify-between p-1.5 rounded hover:bg-gray-200 dark:hover:bg-gray-800 cursor-pointer group transition-colors"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <GitCommit className="w-3 h-3 text-gray-400 dark:text-gray-600 flex-shrink-0" />
                            <div className="min-w-0">
                              <div className="text-xs font-medium text-gray-900 dark:text-white truncate">
                                v{v.version}
                                {v.commit_message && (
                                  <span className="text-gray-500 dark:text-gray-400 ml-1">
                                    - {v.commit_message}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 dark:text-gray-400">
                                {new Date(v.created_at).toLocaleString()}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleLoadVersion(v.version);
                              }}
                              className="p-1 rounded hover:bg-gray-300 dark:hover:bg-gray-700 text-xs text-blue-600 dark:text-blue-400"
                              title="Load this version"
                            >
                              Load
                            </button>
                            {v.version > 1 && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleShowDiff(v.version - 1, v.version);
                                }}
                                className="p-1 rounded hover:bg-gray-300 dark:hover:bg-gray-700 text-xs text-gray-600 dark:text-gray-400"
                                title="Compare with previous"
                              >
                                <ArrowLeftRight className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Diff Viewer */}
              {showDiff && diffVersions && (
                <div className="flex-shrink-0 h-80 border-b border-gray-200 dark:border-gray-700">
                  <OntologyDiffViewer
                    original={ontology.state.content}
                    modified={ontology.state.content}
                    versionFrom={diffVersions.from}
                    versionTo={diffVersions.to}
                    onClose={handleCloseDiff}
                  />
                </div>
              )}

              {/* Editor */}
              <div className="flex-1 min-h-0">
                <OntologyEditor
                  content={ontology.state.content}
                  onChange={ontology.setContent}
                  onSave={ontology.save}
                  onUndo={ontology.undo}
                  onRedo={ontology.redo}
                  canUndo={ontology.canUndo}
                  canRedo={ontology.canRedo}
                  version={ontology.state.version}
                  isSaving={ontology.state.isSaving}
                  hasUnsavedChanges={ontology.state.hasUnsavedChanges}
                  error={ontology.state.error}
                  lastSaved={ontology.state.lastSaved}
                />
              </div>
            </div>
          </CollapsibleSidebar>
        )}

        {/* Main Content Area */}
        <main className="flex-1 overflow-y-auto">
          <div className="max-w-7xl mx-auto px-4 py-12 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto">
              <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
                Welcome to MCP Verifier
              </h2>
              <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
                A secure platform for generating and verifying MCP (Model Context Protocol) tools
                with formal verification using Dafny and runtime state checks using Midspiral.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-12">
                <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                  <div className="text-3xl mb-4">🔒</div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Secure Authentication
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Role-based access control with Clerk authentication. Only developers can access MCP tools.
                  </p>
                </div>
                <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                  <div className="text-3xl mb-4">✅</div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Formal Verification
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Dafny formal verification ensures your MCP tools meet mathematical specifications.
                  </p>
                </div>
                <div className="p-6 bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700">
                  <div className="text-3xl mb-4">🔄</div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">
                    Runtime Checks
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400">
                    Midspiral state verification validates runtime behavior and business rules.
                  </p>
                </div>
              </div>

              {/* Ontology Editor Info Card */}
              {isAuthorized && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6 mb-8">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                      <FileCode className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300">
                      Ontology Editor Active
                    </h3>
                  </div>
                  <p className="text-sm text-blue-700 dark:text-blue-400 mb-4">
                    The ontology editor is now available in the left sidebar. You can edit your LinkML ontology in YAML format with live validation, version control, and diff capabilities.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs text-blue-600 dark:text-blue-400">
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      <span>Live YAML validation with LinkML schema</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      <span>Versioned persistence in SurrealDB</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      <span>Split and inline diff viewer</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Check className="w-4 h-4" />
                      <span>Undo/Redo with history tracking</span>
                    </div>
                  </div>
                </div>
              )}

              {isSignedIn && isDeveloper && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300 mb-2">
                    Developer Tools Ready
                  </h3>
                  <p className="text-sm text-blue-700 dark:text-blue-400 mb-4">
                    You have access to the full MCP tool generator and verification suite.
                  </p>
                  <Link
                    href="/developer"
                    className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Open Developer Dashboard
                  </Link>
                </div>
              )}

              {isSignedIn && !isDeveloper && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-6">
                  <h3 className="text-lg font-semibold text-yellow-900 dark:text-yellow-300 mb-2">
                    Standard Access
                  </h3>
                  <p className="text-sm text-yellow-700 dark:text-yellow-400">
                    You are signed in as a standard user. Contact an administrator to request developer access.
                  </p>
                </div>
              )}

              {!isSignedIn && (
                <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-6">
                  <p className="text-gray-600 dark:text-gray-400 mb-4">
                    Sign in to access the platform features
                  </p>
                  <Link
                    href="/login"
                    className="inline-block px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Get Started
                  </Link>
                </div>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

