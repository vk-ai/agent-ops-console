/**
 * Backend selection from environment variables (server only).
 *
 *   AGENT_RUNTIME_URL            e.g. http://127.0.0.1:8100; unset -> mock runtime
 *   AGENT_RUNTIME_APPROVER_TOKEN sent as X-Approver-Token on decisions (never sent to the browser)
 *   MCP_HUB_URL                  e.g. http://127.0.0.1:8200; unset -> mock hub
 *   MCP_HUB_API_KEY              sent as X-API-Key (admin key needed for /audit/verify)
 *   HUB_POLICY_FILE              path to mcp_hub/config/policy.json to edit; unset -> in-memory copy
 *   OPS_CONSOLE_MOCK=1           force mock mode for everything
 *   MOCK_REVIEWER_TOKENS         mock runtime: JSON {token: reviewer}, like the runtime's AGENTRT_REVIEWER_TOKENS
 *   MOCK_APPROVAL_TTL_S          mock runtime: pending approval expiry (default 3600, 0 = never)
 *   MOCK_STEP_MS                 mock runtime: advance one node per N ms (0 = synchronous like the real API)
 *   STREAM_POLL_MS               how often /api/stream/runs polls the runtime (default 1500)
 */
import type { ConsoleConfig } from "../types";
import { HttpHub, type HubBackend } from "./hub";
import { MockHub } from "./mock-hub";
import { MockRuntime } from "./mock-runtime";
import { FilePolicyStore, MemoryPolicyStore, type PolicyStore } from "./policy-store";
import { HttpRuntime, type RuntimeBackend } from "./runtime";

interface Backends {
  runtime: RuntimeBackend;
  hub: HubBackend;
  policy: PolicyStore;
  streamPollMs: number;
  ready: Promise<void>;
}

const KEY = Symbol.for("agent-ops-console.backends");
type G = typeof globalThis & { [KEY]?: Backends };

function build(env: NodeJS.ProcessEnv): Backends {
  const forceMock = env.OPS_CONSOLE_MOCK === "1";
  let ready: Promise<void> = Promise.resolve();
  let runtime: RuntimeBackend;
  if (!forceMock && env.AGENT_RUNTIME_URL) {
    runtime = new HttpRuntime(env.AGENT_RUNTIME_URL, env.AGENT_RUNTIME_APPROVER_TOKEN);
  } else {
    const mock = new MockRuntime({
      stepMs: Number(env.MOCK_STEP_MS ?? 0),
      reviewerTokens: env.MOCK_REVIEWER_TOKENS ? JSON.parse(env.MOCK_REVIEWER_TOKENS) : undefined,
      approvalTtlS: env.MOCK_APPROVAL_TTL_S ? Number(env.MOCK_APPROVAL_TTL_S) : undefined,
    });
    ready = mock.seed();
    runtime = mock;
  }
  const hub: HubBackend = !forceMock && env.MCP_HUB_URL ? new HttpHub(env.MCP_HUB_URL, env.MCP_HUB_API_KEY) : new MockHub();
  const policy: PolicyStore = env.HUB_POLICY_FILE ? new FilePolicyStore(env.HUB_POLICY_FILE) : new MemoryPolicyStore();
  return { runtime, hub, policy, streamPollMs: Number(env.STREAM_POLL_MS ?? 1500), ready };
}

/** Process-wide singletons (survive Next.js module reloads in dev). */
export async function backends(): Promise<Backends> {
  const g = globalThis as G;
  g[KEY] ??= build(process.env);
  await g[KEY].ready;
  return g[KEY];
}

export function resetBackends(env: NodeJS.ProcessEnv = process.env): void {
  (globalThis as G)[KEY] = build(env);
}

export async function consoleConfig(): Promise<ConsoleConfig> {
  const b = await backends();
  return { runtimeMode: b.runtime.mode, hubMode: b.hub.mode, policyStore: b.policy.kind, streamPollMs: b.streamPollMs };
}
