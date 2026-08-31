import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

const UpdateRoleSchema = z.object({
  role: z.enum(["developer", "user"]),
});

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

export async function POST(
  request: Request,
  { params }: { params: { id: string } }
) {
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

    const body = await request.json();
    const parsed = UpdateRoleSchema.parse(body);
    const targetUserId = params.id;

    const response = await fetch(
      `https://api.clerk.com/v1/users/${targetUserId}/metadata`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${CLERK_SECRET_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          public_metadata: {
            role: parsed.role,
          },
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { ok: false, error: error.message || "Failed to update role" },
        { status: response.status }
      );
    }

    return NextResponse.json({
      ok: true,
      message: `User role updated to ${parsed.role}`,
    });
  } catch (error: any) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { ok: false, error: error.errors },
        { status: 400 }
      );
    }
    return NextResponse.json(
      { ok: false, error: error.message || "Internal error" },
      { status: 500 }
    );
  }
}
