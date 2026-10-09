/** Server-side client for mcp-integration-hub (src/mcp_hub/http_app.py). */
import type { AgentCard, AuditVerify, Connection } from "../types";
import { UpstreamError } from "./errors";

export interface A2ATask {
  kind: "task";
  id: string;
  status: { state: string; message?: { parts: { kind: string; text?: string }[] } };
  artifacts?: unknown[];
}

export interface HubBackend {
  readonly mode: "mock" | "live";
  card(): Promise<AgentCard>;
  connections(): Promise<Connection[]>;
  auditVerify(): Promise<AuditVerify>;
}

export class HttpHub implements HubBackend {
  readonly mode = "live" as const;

  constructor(
    private baseUrl: string,
    private apiKey: string | undefined,
    private fetchImpl: typeof fetch = fetch,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async req<T>(method: string, path: string, body?: unknown, apiKey = this.apiKey): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        headers: {
          accept: "application/json",
          ...(apiKey ? { "x-api-key": apiKey } : {}),
          ...(body ? { "content-type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        cache: "no-store",
      });
    } catch (e) {
      throw new UpstreamError(502, `mcp-integration-hub unreachable at ${this.baseUrl}: ${(e as Error).message}`);
    }
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) throw new UpstreamError(res.status, typeof data?.detail === "string" ? data.detail : text);
    return data as T;
  }

  card() {
    return this.req<AgentCard>("GET", "/.well-known/agent-card.json");
  }
  connections() {
    return this.req<Connection[]>("GET", "/connections");
  }
  auditVerify() {
    return this.req<AuditVerify>("GET", "/audit/verify");
  }

  /** A2A `message/send` with a DataPart {skill, arguments}; used by the live parity check. */
  async a2aSend(skill: string, args: Record<string, unknown>, apiKey = this.apiKey): Promise<A2ATask> {
    const res = await this.req<{ result?: A2ATask; error?: { message: string } }>(
      "POST",
      "/a2a",
      {
        jsonrpc: "2.0",
        id: 1,
        method: "message/send",
        params: { message: { kind: "message", role: "user", messageId: "m1", parts: [{ kind: "data", data: { skill, arguments: args } }] } },
      },
      apiKey,
    );
    if (!res.result) throw new UpstreamError(400, res.error?.message ?? "a2a error");
    return res.result;
  }
}
