/**
 * MSW request handlers for the console's /api routes, backed by the same
 * MockRuntime / MockHub / MemoryPolicyStore classes the server uses in mock
 * mode. Used by Vitest component and client tests (msw/node).
 */
import { http, HttpResponse } from "msw";
import { PolicyError } from "@/lib/policy";
import { UpstreamError } from "@/lib/server/errors";
import { MockHub } from "@/lib/server/mock-hub";
import { MockRuntime } from "@/lib/server/mock-runtime";
import { MemoryPolicyStore } from "@/lib/server/policy-store";
import type { DecisionRequest, Policy, RunStatus, StartRunRequest } from "@/lib/types";

export interface MockApi {
  runtime: MockRuntime;
  hub: MockHub;
  policy: MemoryPolicyStore;
}

export function createMockApi(): MockApi {
  return { runtime: new MockRuntime(), hub: new MockHub(), policy: new MemoryPolicyStore() };
}

async function wrap(fn: () => Promise<unknown>, status = 200) {
  try {
    return HttpResponse.json((await fn()) as object, { status });
  } catch (e) {
    if (e instanceof UpstreamError) return HttpResponse.json({ detail: e.detail }, { status: e.status });
    if (e instanceof PolicyError) return HttpResponse.json({ detail: e.message }, { status: 422 });
    throw e;
  }
}

export function handlers(m: MockApi) {
  const p = (path: string) => `*${path}`;
  return [
    http.get(p("/api/config"), () =>
      HttpResponse.json({ runtimeMode: "mock", hubMode: "mock", policyStore: "memory", streamPollMs: 1500 }),
    ),
    http.get(p("/api/runtime/health"), () => wrap(() => m.runtime.health())),
    http.get(p("/api/runtime/metrics"), () => wrap(() => m.runtime.metrics())),
    http.get(p("/api/runtime/runs"), ({ request }) => {
      const status = new URL(request.url).searchParams.get("status") as RunStatus | null;
      return wrap(() => m.runtime.listRuns(status ?? undefined));
    }),
    http.post(p("/api/runtime/runs"), async ({ request }) => {
      const body = (await request.json()) as StartRunRequest;
      return wrap(() => m.runtime.startRun(body), 201);
    }),
    http.get(p("/api/runtime/runs/:id"), ({ params }) => wrap(() => m.runtime.getRun(String(params.id)))),
    http.post(p("/api/runtime/runs/:id/decision"), async ({ params, request }) => {
      const body = (await request.json()) as DecisionRequest;
      const token = request.headers.get("x-reviewer-token") ?? undefined;
      return wrap(() => m.runtime.decide(String(params.id), body, token));
    }),
    http.get(p("/api/runtime/decisions"), ({ request }) => {
      const runId = new URL(request.url).searchParams.get("run_id") ?? undefined;
      return wrap(() => m.runtime.decisions(runId));
    }),
    http.post(p("/api/runtime/runs/:id/resume"), ({ params }) => wrap(() => m.runtime.resume(String(params.id)))),
    http.get(p("/api/runtime/users/:user/memories"), ({ params }) =>
      wrap(() => m.runtime.memories(String(params.user))),
    ),
    http.get(p("/api/hub/card"), () => wrap(() => m.hub.card())),
    http.get(p("/api/hub/connections"), () => wrap(() => m.hub.connections())),
    http.get(p("/api/hub/audit"), () => wrap(() => m.hub.auditVerify())),
    http.get(p("/api/policy"), () => wrap(async () => ({ store: "memory", policy: await m.policy.get() }))),
    http.put(p("/api/policy"), async ({ request }) => {
      const body = (await request.json()) as Policy;
      return wrap(async () => ({ store: "memory", policy: await m.policy.put(body) }));
    }),
  ];
}
