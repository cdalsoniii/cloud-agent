import { useState, useCallback, useEffect } from "react";

const GUEST_MODE_KEY = "mcp_guest_mode";
const GUEST_ROLE_KEY = "mcp_guest_role";
const GUEST_EXPIRY_KEY = "mcp_guest_expiry";

export interface GuestUser {
  id: string;
  email: string;
  firstName: string;
  role: "developer" | "user";
  isGuest: true;
}

export function useGuestMode() {
  const [guestUser, setGuestUser] = useState<GuestUser | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(GUEST_MODE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const expiry = localStorage.getItem(GUEST_EXPIRY_KEY);
        if (expiry && new Date(expiry) > new Date()) {
          setGuestUser(parsed);
        } else {
          localStorage.removeItem(GUEST_MODE_KEY);
          localStorage.removeItem(GUEST_ROLE_KEY);
          localStorage.removeItem(GUEST_EXPIRY_KEY);
        }
      } catch {
        localStorage.removeItem(GUEST_MODE_KEY);
      }
    }
    setIsLoaded(true);
  }, []);

  const enableGuest = useCallback((role: "developer" | "user" = "user") => {
    const user: GuestUser = {
      id: `guest_${Date.now()}`,
      email: "guest@mcp-verifier.local",
      firstName: "Guest User",
      role,
      isGuest: true,
    };

    const expiry = new Date();
    expiry.setHours(expiry.getHours() + 24); // 24-hour guest session

    localStorage.setItem(GUEST_MODE_KEY, JSON.stringify(user));
    localStorage.setItem(GUEST_ROLE_KEY, role);
    localStorage.setItem(GUEST_EXPIRY_KEY, expiry.toISOString());
    setGuestUser(user);

    return user;
  }, []);

  const disableGuest = useCallback(() => {
    localStorage.removeItem(GUEST_MODE_KEY);
    localStorage.removeItem(GUEST_ROLE_KEY);
    localStorage.removeItem(GUEST_EXPIRY_KEY);
    setGuestUser(null);
  }, []);

  const isGuest = !!guestUser;
  const isGuestDeveloper = guestUser?.role === "developer";

  return {
    guestUser,
    isGuest,
    isGuestDeveloper,
    isLoaded,
    enableGuest,
    disableGuest,
  };
}
