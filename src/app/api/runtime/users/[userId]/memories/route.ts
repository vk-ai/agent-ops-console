import type { NextRequest } from "next/server";
import { backends } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";

export async function GET(_req: NextRequest, ctx: RouteContext<"/api/runtime/users/[userId]/memories">) {
  const { userId } = await ctx.params;
  try {
    return Response.json(await (await backends()).runtime.memories(userId));
  } catch (e) {
    return errorResponse(e);
  }
}
