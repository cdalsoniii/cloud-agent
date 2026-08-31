'use client';

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, FileCode, GitCommit } from 'lucide-react';

export interface CollapsibleSidebarProps {
  children: React.ReactNode;
  title?: string;
  defaultCollapsed?: boolean;
  width?: number;
  collapsedWidth?: number;
}

export default function CollapsibleSidebar({
  children,
  title = 'Ontology Editor',
  defaultCollapsed = false,
  width = 500,
  collapsedWidth = 48,
}: CollapsibleSidebarProps) {
  const [isCollapsed, setIsCollapsed] = useState(defaultCollapsed);

  const toggle = () => setIsCollapsed(!isCollapsed);

  return (
    <div
      className="flex h-full transition-all duration-300 ease-in-out"
      style={{
        width: isCollapsed ? collapsedWidth : width,
        minWidth: isCollapsed ? collapsedWidth : width,
      }}
    >
      {/* Sidebar content */}
      <div className="flex flex-col h-full bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 overflow-hidden">
        {/* Header with toggle */}
        <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900">
          {!isCollapsed && (
            <div className="flex items-center gap-2 min-w-0">
              <FileCode className="w-5 h-5 text-blue-600 dark:text-blue-400 flex-shrink-0" />
              <span className="font-semibold text-sm text-gray-900 dark:text-white truncate">
                {title}
              </span>
            </div>
          )}
          <button
            onClick={toggle}
            className="p-1.5 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors flex-shrink-0"
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? (
              <ChevronRight className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            ) : (
              <ChevronLeft className="w-5 h-5 text-gray-600 dark:text-gray-400" />
            )}
          </button>
        </div>

        {/* Content area */}
        {!isCollapsed && (
          <div className="flex-1 overflow-hidden flex flex-col">
            {children}
          </div>
        )}

        {/* Collapsed icon indicator */}
        {isCollapsed && (
          <div className="flex-1 flex items-center justify-center py-4">
            <div className="flex flex-col items-center gap-3">
              <div title="Ontology Editor">
                <FileCode className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              </div>
              <div title="Version Control">
                <GitCommit className="w-5 h-5 text-gray-400 dark:text-gray-500" />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
