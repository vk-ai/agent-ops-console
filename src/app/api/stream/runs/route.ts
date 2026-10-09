import type { NextRequest } from "next/server";
import { backends } from "@/lib/server/config";
import { runEventStream } from "@/lib/stream";

/** SSE: snapshot, then created/updated run events (server-side polling of GET /runs). */
export async function GET(req: NextRequest) {
  const b = await backends();
  const body = runEventStream(() => b.runtime.listRuns(), b.streamPollMs, req.signal);
  return new Response(body, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
