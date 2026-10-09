import { act, render, screen, waitFor } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Nav } from "@/components/Nav";
import { RunStreamProvider, useRuns } from "@/components/RunStreamProvider";
import type { RunRecord, RunStreamEvent } from "@/lib/types";
import { mockServer } from "./helpers";

const ctx = await mockServer();
beforeAll(() => ctx.server.listen({ onUnhandledFrame: "error" }));
afterAll(() => ctx.server.close());

class FakeEventSource {
  static last: FakeEventSource | null = null;
  listeners = new Map<string, ((e: MessageEvent) => void)[]>();
  onopen: (() => void) | null = null;
  closed = false;
  constructor(public url: string) {
    FakeEventSource.last = this;
    setTimeout(() => this.onopen?.(), 0);
  }
  addEventListener(type: string, fn: (e: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  emit(ev: RunStreamEvent) {
    for (const fn of this.listeners.get(ev.type) ?? []) fn(new MessageEvent(ev.type, { data: JSON.stringify(ev) }));
  }
  fail() {
    for (const fn of this.listeners.get("error") ?? []) fn(new Event("error") as MessageEvent);
  }
  close() {
    this.closed = true;
  }
}

function Probe() {
  const { runs, transport } = useRuns();
  return (
    <p data-testid="probe">
      {transport}:{runs.map((r) => `${r.user_id}=${r.status}`).join(",")}
    </p>
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeEventSource.last = null;
});

describe("live run updates", () => {
  it("applies SSE snapshot and run events and updates the approvals badge", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    render(
      <RunStreamProvider>
        <Nav />
        <Probe />
      </RunStreamProvider>,
    );
    await waitFor(() => expect(FakeEventSource.last?.url).toBe("/api/stream/runs"));
    const runs = (await ctx.api.runtime.listRuns()).slice(0, 2) as RunRecord[];
    act(() => FakeEventSource.last!.emit({ type: "snapshot", runs }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("sse:alice=succeeded,alice=waiting_approval"));
    expect(screen.getByLabelText("1 pending approvals")).toBeInTheDocument();
    expect(screen.getByTestId("transport")).toHaveTextContent("updates: SSE");
    act(() => FakeEventSource.last!.emit({ type: "run", change: "updated", run: { ...runs[1], status: "succeeded" } }));
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("alice=succeeded,alice=succeeded"));
    expect(screen.queryByLabelText(/pending approvals/)).not.toBeInTheDocument();
    expect(await screen.findByText("runtime: mock")).toBeInTheDocument();
  });

  it("falls back to polling when the stream keeps failing", async () => {
    vi.stubGlobal("EventSource", FakeEventSource);
    render(
      <RunStreamProvider pollMs={50}>
        <Probe />
      </RunStreamProvider>,
    );
    await waitFor(() => expect(FakeEventSource.last).not.toBeNull());
    act(() => {
      FakeEventSource.last!.fail();
      FakeEventSource.last!.fail();
    });
    expect(FakeEventSource.last!.closed).toBe(true);
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(/^polling:alice=succeeded/));
    await ctx.api.runtime.startRun({ user_id: "zoe", task: "hello" });
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent("zoe=succeeded"));
  });

  it("polls when EventSource is not available", async () => {
    vi.stubGlobal("EventSource", undefined);
    render(
      <RunStreamProvider pollMs={50}>
        <Probe />
      </RunStreamProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("probe")).toHaveTextContent(/^polling:/));
  });
});
