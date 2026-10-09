import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import approved from "../fixtures/run-approved.json";
import waiting from "../fixtures/run-waiting.json";
import { MemoryViewer } from "@/components/MemoryViewer";
import { RunDetail } from "@/components/RunDetail";
import { RunsTable } from "@/components/RunsTable";
import { RunTimeline } from "@/components/RunTimeline";
import type { RunRecord, RunView } from "@/lib/types";
import { mockServer, renderWithRuns } from "./helpers";

const ctx = await mockServer();
beforeAll(() => ctx.server.listen({ onUnhandledFrame: "error" }));
afterAll(() => ctx.server.close());

describe("RunTimeline", () => {
  it("renders node states from a real waiting run", () => {
    render(<RunTimeline run={waiting as RunView} />);
    expect(within(screen.getByRole("list", { name: "graph nodes" })).getAllByRole("listitem")).toHaveLength(7);
    const approval = document.querySelector('[data-state="waiting"]');
    expect(approval).toHaveTextContent("human_approval");
    expect(approval).toHaveTextContent("waiting for a human decision");
  });

  it("shows who approved", () => {
    render(<RunTimeline run={approved as RunView} />);
    expect(screen.getByText("approved by vinay: ship it")).toBeInTheDocument();
    expect(document.querySelectorAll('[data-state="done"]')).toHaveLength(7);
  });
});

describe("RunsTable", () => {
  it("filters by status, newest first", async () => {
    const runs = await ctx.api.runtime.listRuns();
    render(<RunsTable runs={runs as RunRecord[]} />);
    expect(screen.getAllByRole("row")).toHaveLength(runs.length + 1);
    await userEvent.selectOptions(screen.getByLabelText("status filter"), "failed");
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("dave");
  });
});

describe("RunDetail", () => {
  it("approves from the run page and refreshes the timeline", async () => {
    const run = await ctx.api.runtime.startRun({ user_id: "erin", task: "Send the quarterly report. Remember: erin wants PDFs" });
    await renderWithRuns(<RunDetail runId={run.run_id} />, ctx.api);
    expect(await screen.findByText("waiting for a human decision")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Reviewer name"), "vinay");
    await userEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("succeeded")).toBeInTheDocument());
    expect(screen.getByText(/simulated send executed/)).toBeInTheDocument();
  });

  it("resumes a failed run", async () => {
    const failed = (await ctx.api.runtime.listRuns("failed"))[0];
    await renderWithRuns(<RunDetail runId={failed.run_id} />, ctx.api);
    expect(await screen.findByText(/AllProvidersFailed/, { selector: "dd" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Resume from last checkpoint" }));
    await waitFor(() => expect(screen.getByText("succeeded")).toBeInTheDocument());
  });

  it("shows a 404 from the runtime", async () => {
    await renderWithRuns(<RunDetail runId="missing" />, ctx.api);
    expect(await screen.findByRole("alert")).toHaveTextContent("404");
  });
});

describe("MemoryViewer", () => {
  it("loads memories per user and filters them", async () => {
    await renderWithRuns(<MemoryViewer initialUser="alice" />, ctx.api);
    expect(await screen.findByText("I prefer weekly summaries")).toBeInTheDocument();
    const user = screen.getByLabelText("user id");
    await userEvent.clear(user);
    await userEvent.type(user, "bob");
    expect(await screen.findByText("my team is in IST")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText("search memory text"), "zzz");
    expect(screen.getByText("No memories for bob.")).toBeInTheDocument();
  });
});
