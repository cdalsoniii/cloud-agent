import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireDeveloper } from "../../../lib/auth";
import { generateMermaidFromMCP } from "../../../lib/diagram-engine";

const DiagramSchema = z.object({
  mcpDefinition: z.record(z.any()),
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
    const parsed = DiagramSchema.parse(body);
    const mermaid = generateMermaidFromMCP(parsed.mcpDefinition);
    return NextResponse.json({ ok: true, mermaid, svg: "" }, { status: 200 });
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
