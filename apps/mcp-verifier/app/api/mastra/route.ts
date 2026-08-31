import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireDeveloper } from "../../../lib/auth";

const MastraSchema = z.object({
  action: z.union([z.literal("generate"), z.literal("verify")]),
  payload: z.unknown(),
});

export async function POST(request: Request) {
  try {
    const authResult = await auth();
    const userId = authResult?.userId;
    if (!userId) {
      return NextResponse.json(
        { ok: false, error: "Unauthorized: Please sign in" },
        { status: 401 }
      );
    }

    await requireDeveloper();

    const body = await request.json();
    const parsed = MastraSchema.parse(body);
    if (parsed.action === "generate") {
      const result = {
        mcpDefinition: {
          name: "GeneratedMCP",
          description: "Simulated description",
          inputSchema: { type: "object", properties: {} },
          outputSchema: { type: "object" },
          implementation: "// placeholder",
          testCases: [] as any[],
        },
      };
      return NextResponse.json({ ok: true, result }, { status: 200 });
    } else {
      const result = {
        dafny: { passed: true, details: {} },
        midspiral: { passed: true, details: {} },
      };
      return NextResponse.json({ ok: true, result }, { status: 200 });
    }
  } catch (error: any) {
    if (error.message === "Developer role required") {
      return NextResponse.json(
        { ok: false, error: "Developer role required" },
        { status: 403 }
      );
    }
    const message = error?.message ?? "Invalid request";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
