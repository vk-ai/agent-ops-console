/** Server-side client for agent-runtime-gcp (src/agent_runtime/api.py). */
import type {
  DecisionLogEntry,
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
  /** `reviewerToken` (a per-reviewer token typed by the reviewer) replaces the shared approver token. */
  decide(runId: string, req: DecisionRequest, reviewerToken?: string): Promise<RunView>;
  decisions(runId?: string, limit?: number): Promise<DecisionLogEntry[]>;
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
  decide(runId: string, req: DecisionRequest, reviewerToken?: string) {
    const token = reviewerToken || this.approverToken;
    const headers: Record<string, string> = token ? { "x-approver-token": token } : {};
    return this.req<RunView>("POST", `/runs/${encodeURIComponent(runId)}/decision`, { comment: "", ...req }, headers);
  }
  /** Decision log. Runtimes from before edit-args approvals have no such route: an empty log, not an error. */
  async decisions(runId?: string, limit = 100) {
    const path = runId ? `/runs/${encodeURIComponent(runId)}/decisions` : `/decisions?limit=${limit}`;
    try {
      return await this.req<DecisionLogEntry[]>("GET", path);
    } catch (e) {
      if (!runId && e instanceof UpstreamError && e.status === 404) return [];
      throw e;
    }
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
