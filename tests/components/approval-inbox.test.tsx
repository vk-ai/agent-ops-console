import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ApprovalInbox } from "@/components/ApprovalInbox";
import { MockRuntime } from "@/lib/server/mock-runtime";
import { mockServer, renderWithRuns } from "./helpers";

const ctx = await mockServer();
beforeAll(() => ctx.server.listen({ onUnhandledFrame: "error" }));
afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});
afterAll(() => ctx.server.close());

async function freshRuntime(opts: ConstructorParameters<typeof MockRuntime>[0] = {}) {
  const rt = new MockRuntime(opts);
  await rt.seed();
  ctx.api.runtime = rt;
}

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
    expect(view.approval).toMatchObject({ approved: true, reviewer: "vinay", comment: "duplicate confirmed", decision: "approve" });
    expect(view.approval?.approved_args_digest).toBe(view.approval?.original_args_digest);
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

  it("edits an argument, approves with edits, and shows it in the decision log", async () => {
    await freshRuntime();
    await renderWithRuns(<ApprovalInbox />, ctx.api);
    await userEvent.type(screen.getByLabelText("Reviewer name"), "vinay");
    const cards = await screen.findAllByRole("article");
    const deploy = cards.find((c) => within(c).queryByText("deploy"))!;
    const arg = within(deploy).getByLabelText("argument target");
    expect(arg).toHaveValue("the billing service to staging");
    expect(within(deploy).queryByRole("button", { name: "Approve with edits" })).toBeNull();
    await userEvent.clear(arg);
    await userEvent.type(arg, "the billing service to dev");
    expect(within(deploy).getByText(/was: the billing service to staging/)).toBeInTheDocument();
    await userEvent.click(within(deploy).getByRole("button", { name: "Approve with edits" }));
    await waitFor(() => expect(screen.getAllByRole("article")).toHaveLength(2));
    expect(screen.getByRole("region", { name: "recent decisions" })).toHaveTextContent("edited → succeeded");
    const log = await screen.findByRole("region", { name: "decision log" });
    await waitFor(() => expect(log).toHaveTextContent('{"target":"the billing service to dev"}'));
    expect(log).toHaveTextContent("edited");
    const run = (await ctx.api.runtime.listRuns()).find((r) => r.task.startsWith("Deploy the billing"))!;
    const view = await ctx.api.runtime.getRun(run.run_id);
    expect(view.action?.args).toEqual({ target: "the billing service to dev" });
    expect(view.result).toContain('simulated deploy executed with {"target": "the billing service to dev"}');
  });

  it("refuses a stale card when the pending record changed underneath it", async () => {
    await freshRuntime();
    await renderWithRuns(<ApprovalInbox />, ctx.api);
    await userEvent.type(screen.getByLabelText("Reviewer name"), "vinay");
    const [card] = await screen.findAllByRole("article");
    const id = (await ctx.api.runtime.listRuns("waiting_approval"))[0].run_id;
    const internal = ctx.api.runtime as unknown as { runs: Map<string, { st: { pending: { pending_id: string } } }> };
    internal.runs.get(id)!.st.pending.pending_id = "re-issued";
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    expect(await within(card).findByRole("alert")).toHaveTextContent("409: pending_id does not match");
  });

  it("sends the reviewer token instead of a name when one is entered", async () => {
    ctx.api.runtime = new MockRuntime({ reviewerTokens: { "tok-vinay": "vinay" } });
    await ctx.api.runtime.startRun({ user_id: "u", task: "refund order 9", run_id: "tok-run" });
    await renderWithRuns(<ApprovalInbox />, ctx.api);
    await userEvent.type(screen.getByLabelText("Reviewer token"), "tok-vinay");
    const [card] = await screen.findAllByRole("article");
    await userEvent.click(within(card).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.queryAllByRole("article")).toHaveLength(0));
    expect((await ctx.api.runtime.getRun("tok-run")).approval?.reviewer).toBe("vinay");
    expect(sessionStorage.getItem("reviewer-token")).toBe("tok-vinay");
    expect(localStorage.getItem("reviewer-token")).toBeNull();
  });
});
