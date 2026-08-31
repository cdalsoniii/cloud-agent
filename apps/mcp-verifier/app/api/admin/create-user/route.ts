import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { z } from "zod";

const CreateUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  role: z.enum(["developer", "user"]).default("user"),
});

const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

export async function POST(request: Request) {
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
    const parsed = CreateUserSchema.parse(body);

    // Create user via Clerk API
    const response = await fetch("https://api.clerk.com/v1/users", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${CLERK_SECRET_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email_address: [parsed.email],
        password: parsed.password,
        first_name: parsed.firstName,
        last_name: parsed.lastName,
        public_metadata: {
          role: parsed.role,
        },
      }),
    });

    if (!response.ok) {
      const error = await response.json();
      return NextResponse.json(
        { ok: false, error: error.message || "Failed to create user" },
        { status: response.status }
      );
    }

    const user = await response.json();

    return NextResponse.json({
      ok: true,
      user: {
        id: user.id,
        email: parsed.email,
        role: parsed.role,
      },
      message: `User created successfully with ${parsed.role} role`,
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
