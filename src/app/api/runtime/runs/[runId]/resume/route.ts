import type { NextRequest } from "next/server";
import { backends } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";

export async function POST(_req: NextRequest, ctx: RouteContext<"/api/runtime/runs/[runId]/resume">) {
  const { runId } = await ctx.params;
  try {
    return Response.json(await (await backends()).runtime.resume(runId));
  } catch (e) {
    return errorResponse(e);
  }
}
