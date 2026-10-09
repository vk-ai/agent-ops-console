// Fixtures are real responses captured from agent-runtime-gcp (see tests/fixtures/README.md).
import { describe, expect, it } from "vitest";
import approved from "../fixtures/run-approved.json";
import failed from "../fixtures/run-failed.json";
import plain from "../fixtures/run-plain.json";
import rejected from "../fixtures/run-rejected.json";
import waiting from "../fixtures/run-waiting.json";
import { buildTimeline, formatDuration, runEvents } from "@/lib/timeline";
import type { RunView } from "@/lib/types";

const states = (r: unknown) => Object.fromEntries(buildTimeline(r as RunView).map((n) => [n.node, n.state]));

describe("buildTimeline", () => {
  it("shows a run paused at the approval interrupt", () => {
    expect(states(waiting)).toEqual({
      recall_memory: "done", plan: "done", propose_action: "done", human_approval: "waiting",
      execute_action: "pending", save_memory: "pending", finalize: "pending",
    });
  });

  it("shows an approved run executing the action", () => {
    const tl = buildTimeline(approved as RunView);
    expect(tl.every((n) => n.state === "done")).toBe(true);
    expect(tl.find((n) => n.node === "human_approval")?.note).toBe("approved by vinay: ship it");
    expect(tl.map((n) => n.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("marks execute_action skipped when rejected", () => {
    const s = states(rejected);
    expect(s.execute_action).toBe("skipped");
    expect(s.human_approval).toBe("done");
    expect(s.finalize).toBe("done");
  });

  it("skips the approval branch for a run with no risky action", () => {
    const s = states(plain);
    expect(s.human_approval).toBe("skipped");
    expect(s.execute_action).toBe("skipped");
    expect(buildTimeline(plain as RunView).find((n) => n.node === "propose_action")?.note).toBe("no risky action");
  });

  it("marks the failing node and keeps the error", () => {
    const tl = buildTimeline(failed as RunView);
    const plan = tl.find((n) => n.node === "plan")!;
    expect(plan.state).toBe("failed");
    expect(plan.note).toMatch(/AllProvidersFailed/);
    expect(tl.find((n) => n.node === "recall_memory")?.state).toBe("done");
  });

  it("lists only recorded wall-clock events", () => {
    expect(runEvents(waiting as RunView).map((e) => e.label)).toEqual(["run created", "last heartbeat at human_approval"]);
    expect(runEvents(approved as RunView).at(-1)?.label).toBe("finished: succeeded");
    expect(formatDuration({ created_at: 10, finished_at: 12.5, heartbeat_at: 12 })).toBe("2.5 s");
  });
});
