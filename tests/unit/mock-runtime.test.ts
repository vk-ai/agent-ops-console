// The mock runtime must behave like agent-runtime-gcp; compare against captured real responses.
import { describe, expect, it } from "vitest";
import approved from "../fixtures/run-approved.json";
import edited from "../fixtures/run-edited.json";
import editedLog from "../fixtures/decisions-run-edited.json";
import failed from "../fixtures/run-failed.json";
import memU2 from "../fixtures/memories-u2.json";
import plain from "../fixtures/run-plain.json";
import rejected from "../fixtures/run-rejected.json";
import waiting from "../fixtures/run-waiting.json";
import { UpstreamError } from "@/lib/server/errors";
import { argsDigest, detectAction, extractMemories, MockRuntime, pyJson, uuid5Url } from "@/lib/server/mock-runtime";
import type { RunView } from "@/lib/types";

const VOLATILE = ["owner", "created_at", "heartbeat_at", "finished_at"] as const;
function comparable(v: RunView | object) {
  const c: Record<string, unknown> = { ...(v as Record<string, unknown>) };
  for (const k of VOLATILE) c[k] = c[k] === null ? null : "<t>";
  // pending ids and their timestamps are random/clock-based on both sides
  if (c.pending_decision) c.pending_decision = { ...(c.pending_decision as object), pending_id: "<id>", created_at: "<t>", expires_at: "<t>" };
  if (c.approval && (c.approval as { pending_id?: string }).pending_id) c.approval = { ...(c.approval as object), pending_id: "<id>" };
  return c;
}

describe("MockRuntime parity with captured agent-runtime-gcp responses", () => {
  it("risky task pauses for approval with the same view", async () => {
    const rt = new MockRuntime();
    const v = await rt.startRun({ user_id: "u1", task: waiting.task, run_id: "run-waiting" });
    expect(comparable(v)).toEqual(comparable(waiting));
  });

  it("approve and reject produce the same final views", async () => {
    const rt = new MockRuntime();
    await rt.startRun({ user_id: "u1", task: "Deploy the billing service", run_id: "run-approved" });
    const a = await rt.decide("run-approved", { approved: true, reviewer: "vinay", comment: "ship it" });
    expect(comparable(a)).toEqual(comparable(approved));
    await rt.startRun({ user_id: "u1", task: "Delete stale preview environments", run_id: "run-rejected" });
    const r = await rt.decide("run-rejected", { approved: false, reviewer: "ops-lead", comment: "keep until Friday" });
    expect(comparable(r)).toEqual(comparable(rejected));
  });

  it("plain task succeeds and saves memory with the same uuid5 key", async () => {
    const rt = new MockRuntime();
    const v = await rt.startRun({ user_id: "u2", task: plain.task, run_id: "run-plain" });
    expect(comparable(v)).toEqual(comparable(plain));
    expect(await rt.memories("u2")).toEqual(memU2);
  });

  it("'#fail' marker fails at plan like AllProvidersFailed, and resume recovers", async () => {
    const rt = new MockRuntime();
    const v = await rt.startRun({ user_id: "u3", task: "Compile the weekly report #fail", run_id: "run-failed" });
    expect(v.status).toBe("failed");
    expect(v.error).toBe(failed.error);
    expect(v.next).toEqual(failed.next);
    expect(v.steps).toEqual(failed.steps);
    const r = await rt.resume("run-failed");
    expect(r.status).toBe("succeeded");
    expect(r.attempts).toBe(2);
  });

  it("enforces the same conflicts and not-found errors", async () => {
    const rt = new MockRuntime();
    await rt.startRun({ user_id: "u", task: "hello", run_id: "x" });
    await expect(rt.startRun({ user_id: "u", task: "again", run_id: "x" })).rejects.toMatchObject({ status: 409 });
    await expect(rt.decide("x", { approved: true, reviewer: "r" })).rejects.toMatchObject({
      status: 409, detail: "run x is succeeded, not waiting_approval",
    });
    await expect(rt.resume("x")).rejects.toBeInstanceOf(UpstreamError);
    await expect(rt.getRun("nope")).rejects.toMatchObject({ status: 404 });
  });

  it("lists by status and reports waiting runs in metrics", async () => {
    const rt = new MockRuntime();
    await rt.seed();
    const waitingRuns = await rt.listRuns("waiting_approval");
    expect(waitingRuns).toHaveLength(3);
    expect((await rt.metrics()).waiting_approval).toEqual(waitingRuns.map((r) => r.run_id));
  });

  it("stepMs mode advances nodes in the background", async () => {
    const rt = new MockRuntime({ stepMs: 5 });
    const v = await rt.startRun({ user_id: "u", task: "hello", run_id: "slow" });
    expect(v.status).toBe("running");
    await new Promise((r) => setTimeout(r, 120));
    expect((await rt.getRun("slow")).status).toBe("succeeded");
  });
});

describe("graph.py helpers", () => {
  it("detects risky actions on word boundaries", () => {
    expect(detectAction("Please deploy it")?.type).toBe("deploy");
    expect(detectAction("redeployment notes")).toBeNull();
    expect(detectAction("Send an Email")?.type).toBe("email");
  });
  it("extracts remember facts", () => {
    expect(extractMemories("Remember that I prefer Python. Deploy x")).toEqual(["I prefer Python"]);
    expect(extractMemories("notes, remember: team is in IST")).toEqual(["team is in IST"]);
  });
  it("uuid5 matches Python uuid.uuid5(NAMESPACE_URL, ...)", () => {
    expect(uuid5Url("u1:i prefer python")).toBe("650e6319-8948-5d11-9039-f1bb251bac24");
  });
});

describe("MockRuntime edit-args approvals (parity with agent-runtime-gcp approvals.py)", () => {
  it("computes the same args digest and Python json.dumps text as the runtime", () => {
    expect(argsDigest({ type: "deploy", args: { target: "build 7 to prod" } })).toBe(edited.approval.original_args_digest);
    expect(argsDigest(edited.action)).toBe(edited.approval.approved_args_digest);
    expect(pyJson({ b: 1, a: "é" })).toBe('{"a": "\\u00e9", "b": 1}');
    expect(detectAction("Deploy build 7 to prod.")?.args).toEqual({ target: "build 7 to prod" });
  });

  it("a pending record binds the decision; edit matches the captured real response and log", async () => {
    const rt = new MockRuntime();
    const w = await rt.startRun({ user_id: "u1", task: "Deploy build 7 to prod", run_id: "run-edited" });
    const pd = w.pending_decision!;
    expect(pd.args).toEqual({ target: "build 7 to prod" });
    expect(pd.args_digest).toBe(edited.approval.original_args_digest);
    await expect(rt.decide("run-edited", { decision: "approve", reviewer: "v", pending_id: "stale" })).rejects.toMatchObject({ status: 409 });
    await expect(rt.decide("run-edited", { decision: "approve", reviewer: "v", args_digest: "sha256:0" })).rejects.toMatchObject({ status: 409 });
    await expect(rt.decide("run-edited", { decision: "edit", reviewer: "v", edited_args: { evil: 1 } })).rejects.toMatchObject({ status: 422 });
    const v = await rt.decide("run-edited", {
      decision: "edit", reviewer: "vinay", comment: "prod is frozen", pending_id: pd.pending_id, args_digest: pd.args_digest,
      edited_args: { target: "build 7 to staging" },
    });
    expect(comparable(v)).toEqual(comparable(edited));
    const log = await rt.decisions("run-edited");
    const strip = (e: object) => ({ ...e, pending_id: "<id>", decided_at: "<t>" });
    expect(log.map(strip)).toEqual(editedLog.map(strip));
    await expect(rt.decide("run-edited", { decision: "approve", reviewer: "v", pending_id: pd.pending_id })).rejects.toMatchObject({ status: 409 });
  });

  it("expires pending approvals and enforces per-reviewer tokens", async () => {
    let t = 1000;
    const rt = new MockRuntime({ clock: () => t, approvalTtlS: 60, reviewerTokens: { "tok-a": "alice" } });
    await rt.startRun({ user_id: "u", task: "pay invoice 7", run_id: "p" });
    await expect(rt.decide("p", { approved: true, reviewer: "x" })).rejects.toMatchObject({ status: 401 });
    await expect(rt.decide("p", { approved: true, reviewer: "bob" }, "tok-a")).rejects.toMatchObject({ status: 403 });
    t += 61;
    await expect(rt.decide("p", { approved: true }, "tok-a")).rejects.toMatchObject({ status: 410 });
    const v = await rt.getRun("p");
    expect(v.status).toBe("rejected");
    expect(v.approval?.decision).toBe("expired");
    expect((await rt.decisions())[0]).toMatchObject({ decision: "expired", reviewer: "system" });
  });
});
