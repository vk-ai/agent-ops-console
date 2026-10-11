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
  // A reviewer's personal token comes from the browser in x-reviewer-token and is forwarded as
  // X-Approver-Token; without it the server's shared AGENT_RUNTIME_APPROVER_TOKEN is used (legacy).
  const reviewerToken = req.headers.get("x-reviewer-token")?.trim() || undefined;
  const reviewer = typeof body?.reviewer === "string" ? body.reviewer.trim() : "";
  const kinds = ["approve", "reject", "edit"];
  const hasDecision = typeof body?.decision === "string" && kinds.includes(body.decision);
  if (!body || (typeof body.approved !== "boolean" && !hasDecision) || (body.decision !== undefined && !hasDecision)) {
    return Response.json({ detail: "approved (boolean) or decision (approve|reject|edit) is required" }, { status: 422 });
  }
  if (!reviewer && !reviewerToken) {
    return Response.json({ detail: "reviewer (or a reviewer token) is required" }, { status: 422 });
  }
  if (body.decision === "edit" && (typeof body.edited_args !== "object" || body.edited_args === null || Array.isArray(body.edited_args))) {
    return Response.json({ detail: "decision 'edit' needs an edited_args object" }, { status: 422 });
  }
  const out: DecisionRequest = { comment: typeof body.comment === "string" ? body.comment : "" };
  if (reviewer) out.reviewer = reviewer;
  if (hasDecision) out.decision = body.decision;
  else out.approved = body.approved;
  for (const k of ["pending_id", "args_digest"] as const) if (typeof body[k] === "string") out[k] = body[k];
  if (body.decision === "edit") out.edited_args = body.edited_args;
  try {
    const run = await (await backends()).runtime.decide(runId, out, reviewerToken);
    return Response.json(run);
  } catch (e) {
    return errorResponse(e);
  }
}
