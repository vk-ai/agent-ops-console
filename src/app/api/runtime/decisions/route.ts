import type { NextRequest } from "next/server";
import { backends } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";

/** Decision log from agent-runtime-gcp (`GET /decisions`, or `/runs/{id}/decisions` with ?run_id=). */
export async function GET(req: NextRequest) {
  const runId = req.nextUrl.searchParams.get("run_id") || undefined;
  const limit = Math.max(1, Math.min(Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50, 500));
  try {
    return Response.json(await (await backends()).runtime.decisions(runId, limit));
  } catch (e) {
    return errorResponse(e);
  }
}
