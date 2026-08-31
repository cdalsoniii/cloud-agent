import { SignIn } from "@clerk/nextjs";
import Link from "next/link";

export default function LoginPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md p-6 space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
            Sign In
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Access your developer dashboard
          </p>
        </div>

        <SignIn
          signUpUrl="/sign-up"
          afterSignInUrl="/"
        />

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-gray-300 dark:border-gray-700"></div>
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="px-2 bg-gray-50 dark:bg-gray-900 text-gray-500 dark:text-gray-400">
              or
            </span>
          </div>
        </div>

        <div className="space-y-3">
          <Link
            href="/guest?role=developer"
            className="block w-full text-center px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
          >
            Continue as Guest (Developer Mode)
          </Link>

          <Link
            href="/guest?role=user"
            className="block w-full text-center px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors font-medium dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            Continue as Guest (Read-Only)
          </Link>

          <p className="text-xs text-center text-gray-500 dark:text-gray-400">
            Guest access expires after 24 hours. No account required.
          </p>
        </div>
      </div>
    </div>
  );
}
