import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireDeveloper } from "../../../lib/auth";

const GenerateMcpSchema = z.object({
  description: z.string(),
  name: z.string().optional(),
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
    const parsed = GenerateMcpSchema.parse(body);
    const name = parsed.name ?? "GeneratedMCP";
    const mcpDefinition = {
      name,
      description: parsed.description,
      inputSchema: {
        type: "object",
        properties: {},
      },
      outputSchema: {
        type: "object",
      },
      implementation: "// implementation placeholder",
      testCases: [] as any[],
    };
    return NextResponse.json({ ok: true, mcpDefinition }, { status: 200 });
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
