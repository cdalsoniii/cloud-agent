/**
 * React Hook for Ontology State Management
 * Manages current ontology YAML with live editing and versioning
 */

import { useState, useCallback, useEffect, useRef } from 'react';
import { OntologyVersion } from '../lib/ontology-db';

export interface OntologyState {
  content: string;
  version: number | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
  hasUnsavedChanges: boolean;
  lastSaved: string | null;
}

export interface UseOntologyReturn {
  state: OntologyState;
  setContent: (content: string) => void;
  save: (commitMessage?: string) => Promise<OntologyVersion | null>;
  load: () => Promise<void>;
  reset: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const DEFAULT_ONTOLOGY = `id: https://example.org/ontology
name: example_ontology
prefixes:
  linkml: https://w3id.org/linkml/
  ex: https://example.org/
default_range: string

classes:
  Person:
    attributes:
      name:
        range: string
        required: true
      age:
        range: integer
`;

const HISTORY_LIMIT = 100;

export function useOntology(): UseOntologyReturn {
  const [state, setState] = useState<OntologyState>({
    content: DEFAULT_ONTOLOGY,
    version: null,
    isLoading: false,
    isSaving: false,
    error: null,
    hasUnsavedChanges: false,
    lastSaved: null,
  });

  // History for undo/redo
  const historyRef = useRef<string[]>([DEFAULT_ONTOLOGY]);
  const historyIndexRef = useRef<number>(0);

  const setContent = useCallback((content: string) => {
    setState((prev) => ({
      ...prev,
      content,
      hasUnsavedChanges: true,
      error: null,
    }));

    // Add to history if different from current
    const currentHistory = historyRef.current[historyIndexRef.current];
    if (content !== currentHistory) {
      // Truncate future history if we were in the middle
      historyRef.current = historyRef.current.slice(0, historyIndexRef.current + 1);
      
      // Add new state
      historyRef.current.push(content);
      
      // Limit history size
      if (historyRef.current.length > HISTORY_LIMIT) {
        historyRef.current.shift();
      } else {
        historyIndexRef.current++;
      }
    }
  }, []);

  const undo = useCallback(() => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const previousContent = historyRef.current[historyIndexRef.current];
      setState((prev) => ({
        ...prev,
        content: previousContent,
        hasUnsavedChanges: true,
      }));
    }
  }, []);

  const redo = useCallback(() => {
    if (historyIndexRef.current < historyRef.current.length - 1) {
      historyIndexRef.current++;
      const nextContent = historyRef.current[historyIndexRef.current];
      setState((prev) => ({
        ...prev,
        content: nextContent,
        hasUnsavedChanges: true,
      }));
    }
  }, []);

  const canUndo = historyIndexRef.current > 0;
  const canRedo = historyIndexRef.current < historyRef.current.length - 1;

  const load = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const response = await fetch('/api/ontology/latest');
      if (!response.ok) {
        if (response.status === 404) {
          // No ontology exists yet, use default
          setState((prev) => ({
            ...prev,
            isLoading: false,
            hasUnsavedChanges: false,
          }));
          return;
        }
        throw new Error(`Failed to load ontology: ${response.status}`);
      }
      
      const data: OntologyVersion = await response.json();
      setState((prev) => ({
        ...prev,
        content: data.content,
        version: data.version,
        isLoading: false,
        hasUnsavedChanges: false,
        lastSaved: data.created_at,
      }));
      
      // Reset history with loaded content
      historyRef.current = [data.content];
      historyIndexRef.current = 0;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isLoading: false,
        error: error instanceof Error ? error.message : 'Failed to load ontology',
      }));
    }
  }, []);

  const save = useCallback(async (commitMessage?: string): Promise<OntologyVersion | null> => {
    setState((prev) => ({ ...prev, isSaving: true, error: null }));
    try {
      const response = await fetch('/api/ontology', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: state.content,
          commitMessage,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to save ontology: ${response.status}`);
      }

      const data: OntologyVersion = await response.json();
      setState((prev) => ({
        ...prev,
        version: data.version,
        isSaving: false,
        hasUnsavedChanges: false,
        lastSaved: data.created_at,
      }));

      return data;
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isSaving: false,
        error: error instanceof Error ? error.message : 'Failed to save ontology',
      }));
      return null;
    }
  }, [state.content]);

  const reset = useCallback(() => {
    setState((prev) => ({
      ...prev,
      content: DEFAULT_ONTOLOGY,
      version: null,
      hasUnsavedChanges: false,
      error: null,
    }));
    historyRef.current = [DEFAULT_ONTOLOGY];
    historyIndexRef.current = 0;
  }, []);

  // Load on mount
  useEffect(() => {
    load();
  }, [load]);

  return {
    state,
    setContent,
    save,
    load,
    reset,
    undo,
    redo,
    canUndo,
    canRedo,
  };
}

export default useOntology;
