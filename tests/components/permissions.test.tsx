import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { HubPanel } from "@/components/HubPanel";
import { PermissionsEditor } from "@/components/PermissionsEditor";
import { mockServer } from "./helpers";

const ctx = await mockServer();
beforeAll(() => ctx.server.listen({ onUnhandledFrame: "error" }));
afterAll(() => ctx.server.close());

const row = (tool: string) => document.querySelector(`tr[data-tool="${tool}"]`) as HTMLElement;

describe("PermissionsEditor", () => {
  it("shows direct and inherited grants from the hub policy", async () => {
    render(<PermissionsEditor />);
    const box = await screen.findByLabelText("viewer can use github_list_issues");
    expect(box).toBeChecked();
    expect(screen.getByLabelText("operator can use github_list_issues")).not.toBeChecked();
    expect(within(row("github_list_issues")).getAllByText("via viewer")).toHaveLength(2);
    expect(within(row("slack_post_message")).getByText(/#eng, #alerts/)).toBeInTheDocument();
    expect(screen.getByLabelText("github_create_issue max calls")).toHaveValue(5);
  });

  it("grants a tool, saves, and the hub policy store has it", async () => {
    render(<PermissionsEditor />);
    const save = await screen.findByRole("button", { name: "Save policy" });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByLabelText("viewer can use disconnect"));
    expect(within(row("disconnect")).getAllByText("via viewer")).toHaveLength(1);
    await userEvent.click(save);
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
    expect((await ctx.api.policy.get()).roles.viewer.tools).toContain("disconnect");
  });

  it("blocks saving an inheritance cycle", async () => {
    render(<PermissionsEditor />);
    await userEvent.click(await screen.findByLabelText("viewer inherits admin"));
    expect(screen.getByRole("alert")).toHaveTextContent("Invalid policy: role inheritance cycle");
    expect(screen.getByRole("button", { name: "Save policy" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Discard changes" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("simulates decisions with the ported PolicyEngine", async () => {
    render(<PermissionsEditor />);
    const sim = await screen.findByRole("region", { name: "policy simulator" });
    await userEvent.selectOptions(within(sim).getByLabelText("tool"), "github_create_issue");
    const args = within(sim).getByLabelText("arguments");
    await userEvent.clear(args);
    await userEvent.type(args, '{{"repo": "evil/app"}');
    await userEvent.click(within(sim).getByRole("button", { name: "Check" }));
    expect(screen.getByTestId("decision")).toHaveTextContent("deny: role_not_permitted");
    await userEvent.click(within(sim).getByLabelText("principal has operator"));
    await userEvent.click(within(sim).getByRole("button", { name: "Check" }));
    expect(screen.getByTestId("decision")).toHaveTextContent("deny: arg_not_allowed:repo");
    await userEvent.clear(args);
    await userEvent.type(args, '{{"repo": "acme/app"}');
    await userEvent.click(within(sim).getByRole("button", { name: "Check" }));
    expect(screen.getByTestId("decision")).toHaveTextContent("allow (role operator)");
  });
});

describe("HubPanel", () => {
  it("shows hub card, connections and audit status", async () => {
    render(<HubPanel />);
    expect(await screen.findByText(/A2A 0.3.0 · 6 skills/)).toBeInTheDocument();
    expect(await screen.findByText("github")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId("audit")).toHaveTextContent("intact (12 entries)"));
    expect(within(row("list_connections")).getByText("(not an MCP/A2A skill)")).toBeInTheDocument();
  });
});
