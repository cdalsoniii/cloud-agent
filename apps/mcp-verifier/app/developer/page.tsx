"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useUser, useClerk } from "@clerk/nextjs";
import { useUnifiedAuth } from "../../hooks/useUnifiedAuth";
import McpGenerator from "../components/McpGenerator";
import DiagramViewer from "../components/DiagramViewer";
import VerificationPanel from "../components/VerificationPanel";
import StateInspector from "../components/StateInspector";

export default function DeveloperPage() {
  const { isLoaded, isDeveloper, isSignedIn, userType, isGuest, disableGuest } = useUnifiedAuth();
  const { user } = useUser();
  const { signOut } = useClerk();
  const [mcpDefinition, setMcpDefinition] = useState<Record<string, unknown> | null>(null);
  const [appState, setAppState] = useState<Record<string, unknown>>({});

  const handleGenerate = (mcp: Record<string, unknown>) => {
    setMcpDefinition(mcp);
    setAppState((prev) => ({
      ...prev,
      lastGenerated: mcp,
      timestamp: new Date().toISOString(),
    }));
  };

  const handleSignOut = () => {
    if (isGuest) {
      disableGuest();
    } else {
      signOut({ redirectUrl: "/" });
    }
  };

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center p-8">
          <p className="text-lg text-gray-700 dark:text-gray-300 mb-4">
            Please sign in or use guest access to view the developer dashboard
          </p>
          <div className="space-y-3">
            <Link
              href="/login"
              className="block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Sign In
            </Link>
            <Link
              href="/guest?role=developer"
              className="block px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-300"
            >
              Guest Access (Developer Mode)
            </Link>
          </div>
        </div>
      </div>
    );
  }

  if (!isDeveloper) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center p-8 bg-yellow-50 dark:bg-yellow-900/20 rounded-lg border border-yellow-200 dark:border-yellow-800 max-w-md">
          <h1 className="text-2xl font-bold text-yellow-600 dark:text-yellow-400 mb-4">
            Standard Access
          </h1>
          <p className="text-gray-700 dark:text-gray-300 mb-4">
            You have a standard user account. The developer tools are available in guest mode or by contacting an administrator.
          </p>
          <div className="space-y-3">
            <Link
              href="/"
              className="block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Return Home
            </Link>
            <button
              onClick={handleSignOut}
              className="block w-full px-6 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors dark:bg-gray-700 dark:text-gray-300"
            >
              Sign Out
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <header className="bg-white dark:bg-gray-800 shadow-sm border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 py-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white">
              ← Home
            </Link>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                Developer Dashboard
              </h1>
              <div className="flex items-center gap-2 mt-1">
                <span className="px-2 py-0.5 text-xs bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-300 rounded-full font-medium">
                  Developer Mode
                </span>
                {isGuest && (
                  <span className="px-2 py-0.5 text-xs bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-300 rounded-full font-medium">
                    Guest Access
                  </span>
                )}
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  {user?.firstName || user?.emailAddresses?.[0]?.emailAddress || "Guest User"}
                </span>
              </div>
            </div>
          </div>
          <button
            onClick={handleSignOut}
            className="px-4 py-2 text-sm text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 border border-red-300 dark:border-red-700 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            {isGuest ? "Exit Guest Mode" : "Sign Out"}
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="space-y-6">
            <McpGenerator onGenerate={handleGenerate} />
            <StateInspector state={appState} />
          </div>
          <div className="space-y-6">
            <DiagramViewer
              mcpDefinition={mcpDefinition}
              type="mermaid"
            />
            {mcpDefinition && (
              <VerificationPanel mcpDefinition={mcpDefinition} />
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
