import { connection, type NextRequest } from "next/server";
import { PolicyError } from "@/lib/policy";
import { backends } from "@/lib/server/config";
import { errorResponse } from "@/lib/server/errors";
import type { Policy } from "@/lib/types";

export async function GET() {
  await connection();
  try {
    const b = await backends();
    return Response.json({ store: b.policy.kind, policy: await b.policy.get() });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function PUT(req: NextRequest) {
  let body: Policy;
  try {
    body = await req.json();
  } catch {
    return Response.json({ detail: "invalid JSON" }, { status: 400 });
  }
  try {
    const b = await backends();
    return Response.json({ store: b.policy.kind, policy: await b.policy.put(body) });
  } catch (e) {
    if (e instanceof PolicyError) return Response.json({ detail: e.message }, { status: 422 });
    return errorResponse(e);
  }
}
