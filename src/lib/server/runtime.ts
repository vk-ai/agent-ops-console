/** Server-side client for agent-runtime-gcp (src/agent_runtime/api.py). */
import type {
  DecisionRequest,
  Memory,
  MetricsSummary,
  RunRecord,
  RunStatus,
  RunView,
  RuntimeHealth,
  StartRunRequest,
} from "../types";
import { UpstreamError } from "./errors";

export interface RuntimeBackend {
  readonly mode: "mock" | "live";
  health(): Promise<RuntimeHealth>;
  listRuns(status?: RunStatus): Promise<RunRecord[]>;
  getRun(runId: string): Promise<RunView>;
  startRun(req: StartRunRequest): Promise<RunView>;
  decide(runId: string, req: DecisionRequest): Promise<RunView>;
  resume(runId: string): Promise<RunView>;
  memories(userId: string): Promise<Memory[]>;
  metrics(): Promise<MetricsSummary>;
}

type FetchLike = typeof fetch;

export class HttpRuntime implements RuntimeBackend {
  readonly mode = "live" as const;

  constructor(
    private baseUrl: string,
    private approverToken: string | undefined,
    private fetchImpl: FetchLike = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async req<T>(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: { accept: "application/json", ...(body ? { "content-type": "application/json" } : {}), ...headers },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch (e) {
      throw new UpstreamError(502, `agent-runtime unreachable at ${this.baseUrl}: ${(e as Error).message}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const detail = data && typeof data.detail === "string" ? data.detail : JSON.stringify(data?.detail ?? data);
      throw new UpstreamError(res.status, detail);
    }
    return data as T;
  }

  health() {
    return this.req<RuntimeHealth>("GET", "/healthz");
  }
  listRuns(status?: RunStatus) {
    return this.req<RunRecord[]>("GET", `/runs${status ? `?status=${encodeURIComponent(status)}` : ""}`);
  }
  getRun(runId: string) {
    return this.req<RunView>("GET", `/runs/${encodeURIComponent(runId)}`);
  }
  startRun(req: StartRunRequest) {
    return this.req<RunView>("POST", "/runs", req);
  }
  decide(runId: string, req: DecisionRequest) {
    const headers: Record<string, string> = this.approverToken ? { "x-approver-token": this.approverToken } : {};
    return this.req<RunView>("POST", `/runs/${encodeURIComponent(runId)}/decision`, { comment: "", ...req }, headers);
  }
  resume(runId: string) {
    return this.req<RunView>("POST", `/runs/${encodeURIComponent(runId)}/resume`);
  }
  memories(userId: string) {
    return this.req<Memory[]>("GET", `/users/${encodeURIComponent(userId)}/memories`);
  }
  metrics() {
    return this.req<MetricsSummary>("GET", "/metrics/summary");
  }
}
