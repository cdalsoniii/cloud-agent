import { useUser } from "@clerk/nextjs";

export function useAuth() {
  const { user, isLoaded, isSignedIn } = useUser();

  const isDeveloper =
    !!user && (user.publicMetadata?.role as string) === "developer";

  return {
    user: user as any,
    isDeveloper,
    isLoaded,
    isSignedIn,
  };
}
