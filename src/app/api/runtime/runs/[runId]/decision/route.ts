import type { NextRequest } from "next/server";
import { backends } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";
import type { DecisionRequest } from "@/lib/types";

export async function POST(req: NextRequest, ctx: RouteContext<"/api/runtime/runs/[runId]/decision">) {
  const { runId } = await ctx.params;
  let body: DecisionRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "invalid JSON" }, { status: 400 });
  }
  if (typeof body?.approved !== "boolean" || typeof body?.reviewer !== "string" || !body.reviewer.trim()) {
    return Response.json({ detail: "approved (boolean) and reviewer are required" }, { status: 422 });
  }
  try {
    const run = await (await backends()).runtime.decide(runId, {
      approved: body.approved,
      reviewer: body.reviewer.trim(),
      comment: typeof body.comment === "string" ? body.comment : "",
    });
    return Response.json(run);
  } catch (e) {
    return errorResponse(e);
  }
}
