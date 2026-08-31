import { clerkMiddleware, getAuth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const PUBLIC_ROUTES = ["/", "/login", "/sign-up", "/unauthorized", "/guest"];
const PUBLIC_API_PREFIX = "/api/public/";

const PROTECTED_PREFIXES = [
  "/developer",
  "/api/mastra",
  "/api/generate-mcp",
  "/api/verify",
  "/api/diagram",
  "/api/admin",
];

function startsWithAny(pathname: string, prefixes: string[]): boolean {
  return prefixes.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export default clerkMiddleware(async (req) => {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_ROUTES.includes(pathname) ||
    pathname.startsWith(PUBLIC_API_PREFIX)
  ) {
    return NextResponse.next();
  }

  if (startsWithAny(pathname, PROTECTED_PREFIXES)) {
    const { userId, sessionClaims } = getAuth(req);

    if (!userId) {
      const loginUrl = req.nextUrl.clone();
      loginUrl.pathname = "/login";
      loginUrl.searchParams.set("redirect_url", pathname);
      return NextResponse.redirect(loginUrl);
    }

    const role = sessionClaims?.metadata?.role;
    if (role !== "developer") {
      const unauthorizedUrl = req.nextUrl.clone();
      unauthorizedUrl.pathname = "/unauthorized";
      return NextResponse.redirect(unauthorizedUrl);
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
