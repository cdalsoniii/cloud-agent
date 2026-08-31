import { currentUser, auth } from "@clerk/nextjs/server";

export async function getCurrentUser() {
  return currentUser();
}

export function isDeveloper(user: any): boolean {
  if (!user) return false;
  return (user.publicMetadata?.role as string) === "developer";
}

export async function requireDeveloper(): Promise<void> {
  const authResult = await auth();
  const userId = authResult?.userId;
  if (!userId) {
    throw new Error("Unauthorized: Please sign in");
  }

  const user = await getCurrentUser();
  if (!isDeveloper(user)) {
    throw new Error("Developer role required");
  }
}
