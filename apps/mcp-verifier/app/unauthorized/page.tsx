import Link from "next/link";

export default function UnauthorizedPage() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900 p-4">
      <div className="text-center max-w-md">
        <h1 className="text-3xl font-bold text-red-600 dark:text-red-400 mb-4">
          Access Denied
        </h1>
        <p className="text-gray-700 dark:text-gray-300 mb-2">
          Developer role required
        </p>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          You do not have the necessary permissions to access this resource.
          Please contact an administrator if you believe this is an error.
        </p>
        <Link
          href="/"
          className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Return to Home
        </Link>
      </div>
    </div>
  );
}
