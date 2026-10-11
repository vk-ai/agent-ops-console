/**
 * Live checks against the real backends. Skipped unless the env vars are set:
 *
 *   AGENT_RUNTIME_URL=http://127.0.0.1:8100 AGENT_RUNTIME_APPROVER_TOKEN=dev-approver
 *   REVIEWER_TOKEN=tok-integration                (runtime started with AGENTRT_REVIEWER_TOKENS={"tok-integration":"integration-bot"})
 *   MCP_HUB_URL=http://127.0.0.1:8200            (hub in sandbox mode, dev API keys)
 *
 * See scripts/integration.sh, which starts both from pip installs and runs this file.
 */
import { describe, expect, it } from "vitest";
import defaultPolicy from "@/lib/default-policy.json";
import { PolicyEngine } from "@/lib/policy";
import { buildTimeline } from "@/lib/timeline";
import { HttpHub } from "@/lib/server/hub";
import { MockRuntime } from "@/lib/server/mock-runtime";
import { HttpRuntime } from "@/lib/server/runtime";
import { TOOL_DOCS } from "@/lib/server/mock-hub";
import type { Policy } from "@/lib/types";

const RT = process.env.AGENT_RUNTIME_URL;
const TOKEN = process.env.AGENT_RUNTIME_APPROVER_TOKEN;
const HUB = process.env.MCP_HUB_URL;
const REVIEWER_TOKEN = process.env.REVIEWER_TOKEN;
const uniq = () => `it-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!RT)("agent-runtime-gcp (live)", () => {
  const rt = new HttpRuntime(RT ?? "", TOKEN);

  it("is healthy", async () => {
    expect((await rt.health()).ok).toBe(true);
  });

  it("pauses a risky run, approves it, and saves memory", async () => {
    const user = uniq();
    const run = await rt.startRun({ user_id: user, task: "Remember that I like dark mode. Deploy the docs site" });
    expect(run.status).toBe("waiting_approval");
    expect(run.pending_approval?.action.type).toBe("deploy");
    expect(buildTimeline(run).find((n) => n.node === "human_approval")?.state).toBe("waiting");
    expect((await rt.listRuns("waiting_approval")).map((r) => r.run_id)).toContain(run.run_id);
    expect((await rt.metrics()).waiting_approval).toContain(run.run_id);

    const done = await rt.decide(run.run_id, { approved: true, reviewer: "integration", comment: "ok" });
    expect(done.status).toBe("succeeded");
    expect(done.result).toContain("simulated deploy executed");
    expect(buildTimeline(done).every((n) => n.state === "done")).toBe(true);
    await expect(rt.decide(run.run_id, { approved: true, reviewer: "x" })).rejects.toMatchObject({ status: 409 });
    expect(await rt.memories(user)).toEqual([expect.objectContaining({ text: "I like dark mode", run_id: run.run_id })]);
  });

  it("rejects decisions without the approver token when one is configured", async () => {
    if (!TOKEN) return;
    const run = await rt.startRun({ user_id: uniq(), task: "Refund order 7" });
    const noToken = new HttpRuntime(RT!, undefined);
    await expect(noToken.decide(run.run_id, { approved: true, reviewer: "x" })).rejects.toMatchObject({ status: 401 });
    expect((await rt.decide(run.run_id, { approved: false, reviewer: "integration" })).status).toBe("rejected");
  });

  it("edit-args approval: bound to pending_id + digest, single use, per-reviewer token, decision log", async () => {
    const run = await rt.startRun({ user_id: uniq(), task: "Deploy build 9 to prod" });
    const pd = run.pending_decision;
    expect(pd, "runtime without edit-args approvals (needs vk-ai/agent-runtime-gcp#1)").toBeTruthy();
    expect(pd!.args).toEqual({ target: "build 9 to prod" });
    const mock = await new MockRuntime().startRun({ user_id: run.user_id, task: run.task, run_id: run.run_id });
    expect(mock.pending_decision!.args_digest).toBe(pd!.args_digest);
    await expect(rt.decide(run.run_id, { decision: "approve", reviewer: "x", args_digest: "sha256:stale" })).rejects.toMatchObject({ status: 409 });
    await expect(rt.decide(run.run_id, { decision: "edit", reviewer: "x", edited_args: { extra: "no" } })).rejects.toMatchObject({ status: 422 });
    const body = { decision: "edit" as const, pending_id: pd!.pending_id, args_digest: pd!.args_digest, edited_args: { target: "build 9 to staging" } };
    const done = REVIEWER_TOKEN ? await rt.decide(run.run_id, body, REVIEWER_TOKEN) : await rt.decide(run.run_id, { ...body, reviewer: "integration" });
    expect(done.status).toBe("succeeded");
    expect(done.action?.args).toEqual({ target: "build 9 to staging" });
    expect(done.approval?.decision).toBe("edit");
    if (REVIEWER_TOKEN) expect(done.approval?.reviewer).toBe("integration-bot");
    await expect(rt.decide(run.run_id, body, REVIEWER_TOKEN)).rejects.toMatchObject({ status: 409 });
    const log = await rt.decisions(run.run_id);
    expect(log).toMatchObject([{ decision: "edited", edited_args: { target: "build 9 to staging" }, original_args: { target: "build 9 to prod" } }]);
    expect((await rt.decisions()).some((d) => d.run_id === run.run_id)).toBe(true);
  });

  it("returns 404 for unknown runs", async () => {
    await expect(rt.getRun("does-not-exist")).rejects.toMatchObject({ status: 404 });
  });

  it("mock runtime matches the live view for the same task", async () => {
    const task = "Send the release notes. remember: notes go out on Fridays";
    const live = await rt.startRun({ user_id: uniq(), task });
    const mock = await new MockRuntime().startRun({ user_id: live.user_id, task, run_id: live.run_id });
    const pick = ({ status, steps, next, plan, action, pending_approval, cost_usd, tokens, provider }: typeof live) =>
      ({ status, steps, next, plan, action, pending_approval, cost_usd, tokens, provider });
    expect(pick(mock)).toEqual(pick(live));
  });
});

describe.skipIf(!HUB)("mcp-integration-hub (live, sandbox mode)", () => {
  const hub = new HttpHub(HUB ?? "", "dev-admin-key");
  const policy = defaultPolicy as Policy;

  it("serves an agent card whose skills match the console's list", async () => {
    const card = await hub.card();
    expect(card.protocolVersion).toBe("0.3.0");
    expect(card.skills.map((s) => s.id).sort()).toEqual(Object.keys(TOOL_DOCS).sort());
  });

  it("lists connections and verifies the audit chain with the admin key", async () => {
    expect(Array.isArray(await hub.connections())).toBe(true);
    expect((await hub.auditVerify()).intact).toBe(true);
    await expect(new HttpHub(HUB!, "dev-viewer-key").auditVerify()).rejects.toMatchObject({ status: 403 });
    await expect(new HttpHub(HUB!, undefined).connections()).rejects.toMatchObject({ status: 401 });
  });

  // The hub's dev keys: viewer=victor, operator=alice, admin=root (all tenant acme).
  const keys = { "dev-viewer-key": ["viewer"], "dev-operator-key": ["operator"], "dev-admin-key": ["admin"] } as const;
  const cases: [keyof typeof keys, string, Record<string, unknown>][] = [
    ["dev-viewer-key", "slack_post_message", { channel: "#eng", text: "hi" }],
    ["dev-viewer-key", "github_list_issues", { repo: "evil/app" }],
    ["dev-operator-key", "github_create_issue", { repo: "evil/app", title: "t" }],
    ["dev-operator-key", "slack_post_message", { channel: "#random", text: "hi" }],
    ["dev-admin-key", "slack_post_message", { channel: "#random", text: "hi" }],
    ["dev-viewer-key", "slack_list_channels", {}],
    ["dev-operator-key", "github_list_issues", { repo: "acme/app" }],
  ];

  it.each(cases)("PolicyEngine port agrees with the hub: %s %s", async (key, tool, args) => {
    const local = new PolicyEngine(policy).evaluate({ id: "x", tenant: "acme", roles: [...keys[key]] }, tool, args);
    const task = await hub.a2aSend(tool, args, key);
    const text = task.status.message?.parts.map((p) => p.text).join(" ") ?? "";
    if (local.allowed) {
      // Allowed by policy; with no OAuth connection the tool call then fails with a reconnect message.
      expect(task.status.state).not.toBe("rejected");
    } else {
      expect(task.status.state).toBe("rejected");
      expect(text).toBe(`denied by policy: ${local.reason}`);
    }
  });
});
