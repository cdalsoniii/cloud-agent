"use client";

import { useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useGuestMode } from "../../hooks/useGuestMode";

function GuestPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { enableGuest, isLoaded } = useGuestMode();

  useEffect(() => {
    if (!isLoaded) return;

    const role = searchParams.get("role") as "developer" | "user";
    if (role === "developer" || role === "user") {
      enableGuest(role);
      router.push("/");
    } else {
      router.push("/login");
    }
  }, [isLoaded, searchParams, enableGuest, router]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
        <p className="text-gray-600 dark:text-gray-400">
          Setting up guest access...
        </p>
      </div>
    </div>
  );
}

export default function GuestPage() {
  return (
    <Suspense fallback={
      <div className="flex items-center justify-center min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            Loading...
          </p>
        </div>
      </div>
    }>
      <GuestPageInner />
    </Suspense>
  );
}
