// Calls the Next.js route handlers directly in mock mode.
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as decide } from "@/app/api/runtime/runs/[runId]/decision/route";
import { GET as listRuns, POST as startRun } from "@/app/api/runtime/runs/route";
import { GET as stream } from "@/app/api/stream/runs/route";
import { resetBackends } from "@/lib/server/config";

const req = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => new NextRequest(new URL(url, "http://localhost"), init);
const ctx = (runId: string) => ({ params: Promise.resolve({ runId }) }) as never;

beforeEach(() => resetBackends({ OPS_CONSOLE_MOCK: "1" } as unknown as NodeJS.ProcessEnv));

describe("BFF route handlers (mock mode)", () => {
  it("lists seeded runs and filters by status", async () => {
    const all = await (await listRuns(req("/api/runtime/runs"))).json();
    expect(all.length).toBe(7);
    const waiting = await (await listRuns(req("/api/runtime/runs?status=waiting_approval"))).json();
    expect(waiting.every((r: { status: string }) => r.status === "waiting_approval")).toBe(true);
    expect((await listRuns(req("/api/runtime/runs?status=bogus"))).status).toBe(400);
  });

  it("validates bodies before calling the backend", async () => {
    expect((await startRun(req("/api/runtime/runs", { method: "POST", body: "{}" }))).status).toBe(422);
    expect((await startRun(req("/api/runtime/runs", { method: "POST", body: "nope" }))).status).toBe(400);
    expect((await decide(req("/x", { method: "POST", body: JSON.stringify({ approved: "yes" }) }), ctx("r"))).status).toBe(422);
  });

  it("starts a risky run and approves it", async () => {
    const res = await startRun(req("/api/runtime/runs", { method: "POST", body: JSON.stringify({ user_id: "u", task: "pay the invoice" }) }));
    expect(res.status).toBe(201);
    const run = await res.json();
    expect(run.status).toBe("waiting_approval");
    const d = await decide(req("/x", { method: "POST", body: JSON.stringify({ approved: true, reviewer: "  vinay " }) }), ctx(run.run_id));
    const after = await d.json();
    expect(after.status).toBe("succeeded");
    expect(after.approval.reviewer).toBe("vinay");
    const again = await decide(req("/x", { method: "POST", body: JSON.stringify({ approved: true, reviewer: "v" }) }), ctx(run.run_id));
    expect(again.status).toBe(409);
  });

  it("streams a snapshot over SSE", async () => {
    const ac = new AbortController();
    const res = await stream(req("/api/stream/runs", { signal: ac.signal }));
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    let text = "";
    while (!text.includes("event: snapshot")) text += new TextDecoder().decode((await reader.read()).value);
    ac.abort();
    expect(text).toContain('"type":"snapshot"');
  });
});
