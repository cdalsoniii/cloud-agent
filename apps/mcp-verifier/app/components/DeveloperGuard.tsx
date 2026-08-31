"use client";

import { useAuth } from "../../hooks/useAuth";

export default function DeveloperGuard({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { isLoaded, isDeveloper, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="text-center p-6 bg-gray-100 dark:bg-gray-800 rounded-lg">
        <p className="text-gray-600 dark:text-gray-400">
          Please sign in to access developer tools
        </p>
      </div>
    );
  }

  if (!isDeveloper) {
    return (
      fallback || (
        <div className="text-center p-6 bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800">
          <p className="text-red-600 dark:text-red-400 font-semibold">
            Developer Access Required
          </p>
          <p className="text-sm text-red-500 dark:text-red-300 mt-2">
            You do not have the developer role. Contact an administrator to request access.
          </p>
        </div>
      )
    );
  }

  return <>{children}</>;
}
