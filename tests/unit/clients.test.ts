import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import waiting from "../fixtures/run-waiting.json";
import defaultPolicy from "@/lib/default-policy.json";
import { HttpHub } from "@/lib/server/hub";
import { FilePolicyStore, MemoryPolicyStore } from "@/lib/server/policy-store";
import { HttpRuntime } from "@/lib/server/runtime";
import type { Policy } from "@/lib/types";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("HttpRuntime", () => {
  it("calls the real routes and sends the approver token only on decisions", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => json(waiting));
    const rt = new HttpRuntime("http://rt:8080/", "secret", fetchMock);
    await rt.listRuns("waiting_approval");
    await rt.getRun("a b");
    await rt.decide("r1", { approved: true, reviewer: "v" });
    await rt.memories("u/1");
    const calls = fetchMock.mock.calls.map(([url, init]) => [url, init?.method, (init?.headers as Record<string, string>)["x-approver-token"]]);
    expect(calls).toEqual([
      ["http://rt:8080/runs?status=waiting_approval", "GET", undefined],
      ["http://rt:8080/runs/a%20b", "GET", undefined],
      ["http://rt:8080/runs/r1/decision", "POST", "secret"],
      ["http://rt:8080/users/u%2F1/memories", "GET", undefined],
    ]);
    expect(JSON.parse(fetchMock.mock.calls[2][1]!.body as string)).toEqual({ comment: "", approved: true, reviewer: "v" });
  });

  it("maps FastAPI errors and network failures", async () => {
    const rt409 = new HttpRuntime("http://rt", undefined, (async () => json({ detail: "run x is succeeded, not waiting_approval" }, 409)) as typeof fetch);
    await expect(rt409.decide("x", { approved: true, reviewer: "v" })).rejects.toMatchObject({ status: 409, detail: "run x is succeeded, not waiting_approval" });
    const rt422 = new HttpRuntime("http://rt", undefined, (async () => json({ detail: [{ msg: "field required" }] }, 422)) as typeof fetch);
    await expect(rt422.startRun({ user_id: "", task: "" })).rejects.toMatchObject({ status: 422 });
    const down = new HttpRuntime("http://rt", undefined, (async () => { throw new TypeError("fetch failed"); }) as typeof fetch);
    await expect(down.health()).rejects.toMatchObject({ status: 502 });
  });
});

describe("HttpHub", () => {
  it("sends X-API-Key and builds A2A message/send", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      json({ jsonrpc: "2.0", id: 1, result: { kind: "task", id: "t", status: { state: "rejected" } } }));
    const hub = new HttpHub("http://hub", "k1", fetchMock);
    const task = await hub.a2aSend("slack_post_message", { channel: "#x" }, "k2");
    expect(task.status.state).toBe("rejected");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://hub/a2a");
    expect((init!.headers as Record<string, string>)["x-api-key"]).toBe("k2");
    expect(JSON.parse(init!.body as string).params.message.parts[0].data).toEqual({ skill: "slack_post_message", arguments: { channel: "#x" } });
  });
});

describe("policy stores", () => {
  it("memory store validates and isolates copies", async () => {
    const s = new MemoryPolicyStore();
    const p = await s.get();
    p.roles.viewer.tools = [];
    expect((await s.get()).roles.viewer.tools).toHaveLength(3);
    await expect(s.put({ roles: { a: { inherits: ["a"] } }, tools: {} })).rejects.toThrow(/cycle/);
  });

  it("file store round-trips the hub's policy.json format", async () => {
    const dir = await mkdtemp(join(tmpdir(), "policy-"));
    const path = join(dir, "policy.json");
    await writeFile(path, JSON.stringify(defaultPolicy));
    const s = new FilePolicyStore(path);
    const p = (await s.get()) as Policy;
    p.roles.viewer.tools!.push("slack_post_message");
    await s.put(p);
    expect(JSON.parse(await readFile(path, "utf8")).roles.viewer.tools).toContain("slack_post_message");
    await expect(s.put({ roles: { a: { inherits: ["zz"] } }, tools: {} })).rejects.toThrow(/unknown role/);
    expect(JSON.parse(await readFile(path, "utf8")).roles.a).toBeUndefined();
  });
});
