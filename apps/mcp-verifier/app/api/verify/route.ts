import { NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@clerk/nextjs/server";
import { requireDeveloper } from "../../../lib/auth";
import { verifyWithDafny } from "../../../lib/dafny-runtime";
import { verifyWithMidspiral } from "../../../lib/midspiral-client";

const VerifySchema = z.object({
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
    const parsed = VerifySchema.parse(body);
    const dafnyResult = await verifyWithDafny({
      spec: JSON.stringify(parsed.mcpDefinition),
      target: "mcp-schema",
    });
    const midspiralResult = await verifyWithMidspiral({
      ruleId: "rule-mcp-schema-valid",
      state: parsed.mcpDefinition,
    });
    const passed = dafnyResult.verified && midspiralResult.verified;
    return NextResponse.json(
      { ok: true, dafny: dafnyResult, midspiral: midspiralResult, passed },
      { status: 200 }
    );
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
