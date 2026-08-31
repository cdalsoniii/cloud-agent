import { SignUp } from "@clerk/nextjs";

export default function SignUpPage() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="w-full max-w-md p-6">
        <SignUp
          signInUrl="/login"
          afterSignUpUrl="/"
        />
      </div>
    </div>
  );
}
