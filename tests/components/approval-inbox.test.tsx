import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApprovalInbox } from "@/components/ApprovalInbox";
import { mockServer, renderWithRuns } from "./helpers";

const ctx = await mockServer();
beforeAll(() => ctx.server.listen({ onUnhandledFrame: "error" }));
afterEach(() => localStorage.clear());
afterAll(() => ctx.server.close());

describe("ApprovalInbox", () => {
  it("lists runs waiting at human_approval with their proposed action", async () => {
    await renderWithRuns(<ApprovalInbox />, ctx.api);
    const cards = await screen.findAllByRole("article");
    expect(cards).toHaveLength(3);
    expect(screen.getByText("Deploy the billing service to staging")).toBeInTheDocument();
    expect(within(cards[1]).getByText("refund")).toBeInTheDocument();
  });

  it("requires a reviewer name", async () => {
    await renderWithRuns(<ApprovalInbox />, ctx.api);
    const [first] = await screen.findAllByRole("article");
    await userEvent.click(within(first).getByRole("button", { name: "Approve" }));
    expect(within(first).getByRole("alert")).toHaveTextContent("Enter your reviewer name first.");
  });

  it("approves and rejects through the runtime API", async () => {
    await renderWithRuns(<ApprovalInbox />, ctx.api);
    await userEvent.type(screen.getByLabelText("Reviewer name"), "vinay");
    const cards = await screen.findAllByRole("article");
    const refund = cards.find((c) => within(c).queryByText("refund"))!;
    await userEvent.type(within(refund).getByLabelText("Comment"), "duplicate confirmed");
    await userEvent.click(within(refund).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    const decided = screen.getByRole("region", { name: "recent decisions" });
    expect(decided).toHaveTextContent("approved → succeeded");

    const email = screen.getAllByRole("article").find((c) => within(c).queryByText("email"))!;
    await userEvent.click(within(email).getByRole("button", { name: "Reject" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(1));
    expect(decided).toHaveTextContent("rejected → rejected");

    const runs = await ctx.api.runtime.listRuns();
    const refundRun = runs.find((r) => r.task.startsWith("Refund"))!;
    const view = await ctx.api.runtime.getRun(refundRun.run_id);
    expect(view.approval).toEqual({ approved: true, reviewer: "vinay", comment: "duplicate confirmed" });
    expect(view.result).toContain("simulated refund executed");
    expect(localStorage.getItem("reviewer")).toBe("vinay");
  });

  it("shows the backend's conflict message if the run was already decided elsewhere", async () => {
    const { push } = await renderWithRuns(<ApprovalInbox />, ctx.api);
    await userEvent.type(screen.getByLabelText("Reviewer name"), "vinay");
    const [card] = await screen.findAllByRole("article");
    const id = (await ctx.api.runtime.listRuns("waiting_approval"))[0].run_id;
    await ctx.api.runtime.decide(id, { approved: false, reviewer: "someone-else" });
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent(`409: run ${id} is rejected, not waiting_approval`);
    await push();
    await waitFor(() => expect(screen.queryAllByRole("article")).toHaveLength(0));
    expect(screen.getByText("No runs are waiting for approval.")).toBeInTheDocument();
  });
});
