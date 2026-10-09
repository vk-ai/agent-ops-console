import { describe, expect, it } from "vitest";
import list from "../fixtures/runs-list.json";
import { applyRunEvent, diffRuns, encodeSse, runEventStream } from "@/lib/stream";
import type { RunRecord, RunStreamEvent } from "@/lib/types";

const runs = list as RunRecord[];

describe("diffRuns", () => {
  it("emits created for new runs and updated for watched changes only", () => {
    const prev = new Map(runs.slice(0, 2).map((r) => [r.run_id, r]));
    const changed = { ...runs[0], status: "succeeded" as const };
    const evs = diffRuns(prev, [changed, runs[1], runs[2]]);
    expect(evs).toEqual([
      { type: "run", change: "updated", run: changed },
      { type: "run", change: "created", run: runs[2] },
    ]);
    expect(diffRuns(prev, [runs[0], { ...runs[1], task: "edited" }])).toEqual([]);
  });
});

describe("applyRunEvent", () => {
  it("replaces, appends and keeps created_at order", () => {
    let s = applyRunEvent([], { type: "snapshot", runs: [runs[1]] });
    s = applyRunEvent(s, { type: "run", change: "created", run: runs[0] });
    expect(s.map((r) => r.run_id)).toEqual([runs[0].run_id, runs[1].run_id]);
    s = applyRunEvent(s, { type: "run", change: "updated", run: { ...runs[1], status: "failed" } });
    expect(s[1].status).toBe("failed");
    expect(applyRunEvent(s, { type: "error", message: "x" })).toBe(s);
  });
});

describe("SSE encoding and stream", () => {
  it("encodes named events", () => {
    expect(encodeSse({ type: "error", message: "boom" })).toBe('event: error\ndata: {"type":"error","message":"boom"}\n\n');
  });

  it("sends a snapshot then only changes", async () => {
    let current = runs.slice(0, 1);
    const ac = new AbortController();
    const reader = runEventStream(async () => current, 10, ac.signal).getReader();
    const dec = new TextDecoder();
    const events: RunStreamEvent[] = [];
    let buf = "";
    setTimeout(() => (current = [...runs.slice(0, 1), runs[1]]), 15);
    const deadline = Date.now() + 2000;
    while (events.length < 2 && Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value);
      const frames = buf.split("\n\n");
      buf = frames.pop()!;
      for (const f of frames) {
        const data = f.split("\n").find((l) => l.startsWith("data: "));
        if (data) events.push(JSON.parse(data.slice(6)));
      }
    }
    ac.abort();
    expect(events[0]).toMatchObject({ type: "snapshot" });
    expect(events[1]).toEqual({ type: "run", change: "created", run: runs[1] });
  });

  it("reports upstream errors as error events", async () => {
    const ac = new AbortController();
    const reader = runEventStream(async () => { throw new Error("down"); }, 1000, ac.signal).getReader();
    const dec = new TextDecoder();
    let text = "";
    while (!text.includes("event: error")) text += dec.decode((await reader.read()).value);
    ac.abort();
    expect(text).toContain('"message":"down"');
  });
});
