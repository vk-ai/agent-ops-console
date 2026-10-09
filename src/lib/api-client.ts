/**
 * Typed browser client for the console's own /api routes (the BFF). The BFF
 * forwards to agent-runtime-gcp / mcp-integration-hub, which keeps the
 * approver token and hub API key on the server and avoids CORS (neither
 * backend enables it).
 */
import type {
  AgentCard,
  AuditVerify,
  Connection,
  ConsoleConfig,
  DecisionRequest,
  Memory,
  MetricsSummary,
  Policy,
  RunRecord,
  RunStatus,
  RunView,
  RuntimeHealth,
  StartRunRequest,
} from "./types";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string,
  ) {
    super(detail);
  }
}

export interface PolicyResponse {
  store: "memory" | "file";
  policy: Policy;
}

export class ApiClient {
  constructor(
    private base = "",
    private fetchImpl: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const url =
      this.base || typeof window === "undefined" ? `${this.base}${path}` : new URL(path, window.location.origin).toString();
    const res = await this.fetchImpl(url, {
      method,
      headers: body === undefined ? { accept: "application/json" } : { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { detail: text };
    }
    if (!res.ok) {
      const d = (data as { detail?: unknown } | null)?.detail;
      throw new ApiError(res.status, typeof d === "string" ? d : `HTTP ${res.status}`);
    }
    return data as T;
  }

  config = () => this.req<ConsoleConfig>("GET", "/api/config");
  health = () => this.req<RuntimeHealth>("GET", "/api/runtime/health");
  metrics = () => this.req<MetricsSummary>("GET", "/api/runtime/metrics");
  listRuns = (status?: RunStatus) =>
    this.req<RunRecord[]>("GET", `/api/runtime/runs${status ? `?status=${status}` : ""}`);
  getRun = (id: string) => this.req<RunView>("GET", `/api/runtime/runs/${encodeURIComponent(id)}`);
  startRun = (body: StartRunRequest) => this.req<RunView>("POST", "/api/runtime/runs", body);
  decide = (id: string, body: DecisionRequest) =>
    this.req<RunView>("POST", `/api/runtime/runs/${encodeURIComponent(id)}/decision`, body);
  resume = (id: string) => this.req<RunView>("POST", `/api/runtime/runs/${encodeURIComponent(id)}/resume`);
  memories = (userId: string) =>
    this.req<Memory[]>("GET", `/api/runtime/users/${encodeURIComponent(userId)}/memories`);
  hubCard = () => this.req<AgentCard>("GET", "/api/hub/card");
  hubConnections = () => this.req<Connection[]>("GET", "/api/hub/connections");
  hubAudit = () => this.req<AuditVerify>("GET", "/api/hub/audit");
  getPolicy = () => this.req<PolicyResponse>("GET", "/api/policy");
  putPolicy = (policy: Policy) => this.req<PolicyResponse>("PUT", "/api/policy", policy);
}

export const api = new ApiClient();
