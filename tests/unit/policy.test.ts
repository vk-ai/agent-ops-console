// Mirrors mcp-integration-hub tests/test_policy.py against the TypeScript port.
import { describe, expect, it } from "vitest";
import defaultPolicy from "@/lib/default-policy.json";
import {
  allTools, effectiveRoles, grantSource, orphanGrants, PolicyEngine, PolicyError, setGrant, setInherits,
  setRateLimit, toolsFor, validatePolicy,
} from "@/lib/policy";
import type { Policy } from "@/lib/types";

const policy = defaultPolicy as Policy;
const P = (...roles: string[]) => ({ id: "u", tenant: "acme", roles });

function engine() {
  let t = 1000;
  const clock = { now: () => t, advance: (s: number) => (t += s) };
  return { e: new PolicyEngine(structuredClone(policy), clock.now), clock };
}

describe("PolicyEngine parity with mcp_hub/policy.py", () => {
  it("viewer can read, not write", () => {
    const { e } = engine();
    expect(e.evaluate(P("viewer"), "github_list_issues", { repo: "acme/app" }).allowed).toBe(true);
    const d = e.evaluate(P("viewer"), "slack_post_message", { channel: "#eng", text: "hi" });
    expect(d).toMatchObject({ allowed: false, reason: "role_not_permitted" });
  });

  it("operator inherits viewer", () => {
    const { e } = engine();
    expect(e.evaluate(P("operator"), "slack_list_channels", {}).allowed).toBe(true);
    expect(e.evaluate(P("operator"), "slack_post_message", { channel: "#eng", text: "hi" }).allowed).toBe(true);
  });

  it("unknown tool is denied even for admin", () => {
    expect(engine().e.evaluate(P("admin"), "drop_database", {})).toMatchObject({ allowed: false, reason: "unknown_tool" });
  });

  it("no roles is denied", () => {
    expect(engine().e.evaluate(P(), "github_list_issues", { repo: "acme/app" }).allowed).toBe(false);
  });

  it("arg allowlist applies to admin too", () => {
    const d = engine().e.evaluate(P("admin"), "slack_post_message", { channel: "#random", text: "hi" });
    expect(d).toMatchObject({ allowed: false, reason: "arg_not_allowed:channel" });
  });

  it("arg pattern is a full match", () => {
    const { e } = engine();
    expect(e.evaluate(P("operator"), "github_create_issue", { repo: "acme/app", title: "t" }).allowed).toBe(true);
    expect(e.evaluate(P("operator"), "github_create_issue", { repo: "evil/app", title: "t" }).reason).toBe("arg_not_allowed:repo");
    expect(e.evaluate(P("operator"), "github_create_issue", { repo: "acme/app/../x y", title: "t" }).reason).toBe("arg_not_allowed:repo");
    expect(e.evaluate(P("operator"), "github_create_issue", { repo: "xacme/app", title: "t" }).reason).toBe("arg_not_allowed:repo");
  });

  it("missing constrained arg is denied", () => {
    expect(engine().e.evaluate(P("operator"), "github_create_issue", { title: "t" }).reason).toBe("arg_not_allowed:repo");
  });

  it("rate limit is per principal and tool, fixed window", () => {
    const { e, clock } = engine();
    const args = { repo: "acme/app", title: "t" };
    const results = Array.from({ length: 6 }, () => e.evaluate(P("operator"), "github_create_issue", args).allowed);
    expect(results).toEqual([true, true, true, true, true, false]);
    expect(e.evaluate(P("operator"), "github_create_issue", args).reason).toBe("rate_limited");
    expect(e.evaluate({ id: "someone-else", tenant: "acme", roles: ["operator"] }, "github_create_issue", args).allowed).toBe(true);
    clock.advance(61);
    expect(e.evaluate(P("operator"), "github_create_issue", args).allowed).toBe(true);
  });

  it("denied calls do not consume rate limit", () => {
    const { e } = engine();
    for (let i = 0; i < 10; i++) e.evaluate(P("operator"), "github_create_issue", { repo: "evil/app", title: "t" });
    expect(e.evaluate(P("operator"), "github_create_issue", { repo: "acme/app", title: "t" }).allowed).toBe(true);
  });

  it("rejects unknown inherit and cycles", () => {
    expect(() => validatePolicy({ roles: { a: { inherits: ["missing"], tools: [] } }, tools: {} })).toThrow(PolicyError);
    expect(() => validatePolicy({ roles: { a: { inherits: ["b"] }, b: { inherits: ["a"] } }, tools: {} })).toThrow(/cycle/);
    expect(() => validatePolicy({ roles: {}, tools: { t: { args: { x: { pattern: "(" } } } } })).toThrow(/pattern/);
  });

  it("tools_for lists inherited tools", () => {
    expect(toolsFor(policy, ["viewer"]).has("slack_post_message")).toBe(false);
    expect(toolsFor(policy, ["operator"]).has("slack_post_message")).toBe(true);
    expect([...effectiveRoles(policy, ["admin"])].sort()).toEqual(["admin", "operator", "viewer"]);
  });
});

describe("editor helpers", () => {
  it("reports where a grant comes from", () => {
    expect(grantSource(policy, "viewer", "github_list_issues")).toEqual({ kind: "direct" });
    expect(grantSource(policy, "admin", "github_list_issues")).toEqual({ kind: "inherited", via: "viewer" });
    expect(grantSource(policy, "viewer", "disconnect")).toEqual({ kind: "none" });
  });

  it("grants and revokes without mutating the input", () => {
    const next = setGrant(policy, "viewer", "slack_post_message", true);
    expect(next.roles.viewer.tools).toContain("slack_post_message");
    expect(policy.roles.viewer.tools).not.toContain("slack_post_message");
    expect(setGrant(next, "viewer", "slack_post_message", false).roles.viewer.tools).not.toContain("slack_post_message");
  });

  it("flags grants for tools without a spec (hub would deny as unknown_tool)", () => {
    const p = setGrant(policy, "viewer", "jira_create_ticket", true);
    expect(orphanGrants(p)).toEqual(["jira_create_ticket"]);
    expect(allTools(p)).toContain("jira_create_ticket");
    expect(new PolicyEngine(p).evaluate(P("viewer"), "jira_create_ticket", {}).reason).toBe("unknown_tool");
  });

  it("edits inheritance and rate limits", () => {
    const p = setInherits(policy, "operator", []);
    expect(p.roles.operator.inherits).toBeUndefined();
    expect(toolsFor(p, ["operator"]).has("github_list_issues")).toBe(false);
    const q = setRateLimit(policy, "slack_list_channels", { max: 1, per_seconds: 10 });
    const e = new PolicyEngine(q, () => 0);
    expect(e.evaluate(P("viewer"), "slack_list_channels", {}).allowed).toBe(true);
    expect(e.evaluate(P("viewer"), "slack_list_channels", {}).reason).toBe("rate_limited");
    expect(setRateLimit(q, "slack_list_channels", null).tools.slack_list_channels.rate_limit).toBeUndefined();
  });
});
