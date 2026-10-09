import type { NextRequest } from "next/server";
import { backends } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";
import { RUN_STATUSES, type RunStatus, type StartRunRequest } from "@/lib/types";

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get("status") ?? undefined;
  if (status && !RUN_STATUSES.includes(status as RunStatus)) {
    return Response.json({ detail: `unknown status ${status}` }, { status: 400 });
  }
  try {
    return Response.json(await (await backends()).runtime.listRuns(status as RunStatus | undefined));
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(req: NextRequest) {
  let body: StartRunRequest;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "invalid JSON" }, { status: 400 });
  }
  if (typeof body?.user_id !== "string" || typeof body?.task !== "string" || !body.user_id || !body.task) {
    return Response.json({ detail: "user_id and task are required strings" }, { status: 422 });
  }
  try {
    const run = await (await backends()).runtime.startRun({ user_id: body.user_id, task: body.task, run_id: body.run_id || undefined });
    return Response.json(run, { status: 201 });
  } catch (e) {
    return errorResponse(e);
  }
}
