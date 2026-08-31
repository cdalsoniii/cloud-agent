import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

export async function GET() {
  try {
    const authResult = await auth();
    const userId = authResult?.userId;

    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized" },
        { status: 401 }
      );
    }

    if (!CLERK_SECRET_KEY) {
      return NextResponse.json(
        { ok: false, error: "Clerk not configured" },
        { status: 500 }
      );
    }

    const response = await fetch("https://api.clerk.com/v1/users?limit=100", {
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
      },
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { ok: false, error: error.message || "Failed to fetch users" },
        { status: response.status }
      );
    }

    const data = await response.json();

    const users = data.map((user: any) => ({
      id: user.id,
      email: user.email_addresses?.[0]?.email_address,
      firstName: user.first_name,
      lastName: user.last_name,
      role: user.public_metadata?.role || "user",
      createdAt: user.created_at,
      lastSignInAt: user.last_sign_in_at,
    }));

    return NextResponse.json({ ok: true, users });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}
