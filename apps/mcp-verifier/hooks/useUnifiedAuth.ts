import { useUser } from "@clerk/nextjs";
import { useGuestMode } from "./useGuestMode";

export function useUnifiedAuth() {
  const { user, isLoaded: clerkLoaded, isSignedIn } = useUser();
  const { guestUser, isGuest, isGuestDeveloper, isLoaded: guestLoaded, enableGuest, disableGuest } = useGuestMode();

  const isLoaded = clerkLoaded && guestLoaded;
  const isAuthenticated = isSignedIn || isGuest;

  const isDeveloper = isSignedIn
    ? (user?.publicMetadata?.role as string) === "developer"
    : isGuestDeveloper;

  const currentUser = isSignedIn ? user : guestUser;
  const userType = isSignedIn ? "clerk" : isGuest ? "guest" : "none";

  return {
    user: currentUser,
    isDeveloper,
    isLoaded,
    isSignedIn: isAuthenticated,
    userType,
    isGuest,
    enableGuest,
    disableGuest,
  };
}
