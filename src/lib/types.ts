/**
 * Types mirroring the real backends.
 *
 * agent-runtime-gcp: src/agent_runtime/{api,service,runs,graph}.py
 * mcp-integration-hub: src/mcp_hub/{http_app,policy,a2a,audit}.py and config/policy.json
 *
 * Python floats for timestamps are Unix seconds.
 */

// ---------------------------------------------------------------- runtime

export type RunStatus = "running" | "waiting_approval" | "succeeded" | "failed" | "rejected";

export const RUN_STATUSES: readonly RunStatus[] = [
  "running",
  "waiting_approval",
  "succeeded",
  "failed",
  "rejected",
] as const;

/** `RunRecord` dataclass (runs.py) as returned by `GET /runs`. */
export interface RunRecord {
  run_id: string;
  user_id: string;
  task: string;
  status: RunStatus;
  owner: string;
  created_at: number;
  heartbeat_at: number;
  finished_at: number | null;
  current_node: string | null;
  attempts: number;
  cost_usd: number;
  provider: string | null;
  error: string | null;
}

export interface ProposedAction {
  type: string;
  description: string;
  /** Arguments the action will execute with (agent-runtime-gcp >= edit-args approvals). */
  args?: Record<string, unknown>;
  /** Present after an edit: the arguments originally proposed. */
  original_args?: Record<string, unknown>;
}

/** Payload passed to `langgraph.types.interrupt` in the `human_approval` node. */
export interface PendingApproval {
  run_id: string;
  action: ProposedAction;
  plan: string | null;
}

export interface ApprovalDecision {
  approved: boolean;
  reviewer: string;
  comment: string;
  /** approve | reject | edit | expired (newer runtimes only). */
  decision?: string;
  pending_id?: string;
  original_args_digest?: string;
  approved_args_digest?: string;
}

/** `pending_decision` in `GET /runs/{id}`: the single-use, expiring record a decision binds to. */
export interface PendingDecision {
  pending_id: string;
  args_digest: string;
  args: Record<string, unknown>;
  created_at: number;
  expires_at: number | null;
}

export type DecisionKind = "approve" | "reject" | "edit";

/** Entry of `GET /decisions` / `GET /runs/{id}/decisions`. */
export interface DecisionLogEntry {
  run_id: string;
  pending_id: string;
  user_id: string;
  action_type: string | null;
  reviewer: string;
  comment: string;
  decided_at: number;
  decision: "approved" | "rejected" | "edited" | "expired";
  original_args: Record<string, unknown>;
  original_args_digest: string;
  edited_args?: Record<string, unknown>;
  approved_args_digest?: string;
}

/** `RunManager.view()` (service.py): `GET /runs/{id}`, and the body of POST /runs, /decision, /resume. */
export interface RunView extends RunRecord {
  next: string[];
  pending_approval: PendingApproval | null;
  /** Missing on agent-runtime-gcp versions before edit-args approvals. */
  pending_decision?: PendingDecision | null;
  result: string | null;
  plan: string | null;
  action: ProposedAction | null;
  approval: ApprovalDecision | null;
  steps: string[];
  memories_used: string[];
  tokens: number;
}

export interface StartRunRequest {
  user_id: string;
  task: string;
  run_id?: string;
}

/** `POST /runs/{id}/decision` body (api.py `Decision`). */
export interface DecisionRequest {
  /** Legacy form. */
  approved?: boolean;
  decision?: DecisionKind;
  /** Optional when a per-reviewer token is used (the runtime takes the reviewer from the token). */
  reviewer?: string;
  comment?: string;
  pending_id?: string;
  args_digest?: string;
  edited_args?: Record<string, unknown>;
}

/** Item from `GET /users/{user_id}/memories`. */
export interface Memory {
  key: string;
  text: string;
  run_id: string;
}

/** `GET /metrics/summary`. */
export interface MetricsSummary {
  stuck: string[];
  waiting_approval: string[];
}

export interface RuntimeHealth {
  ok: boolean;
  persistence: string;
}

/** Node order of the LangGraph graph in graph.py. */
export const GRAPH_NODES = [
  "recall_memory",
  "plan",
  "propose_action",
  "human_approval",
  "execute_action",
  "save_memory",
  "finalize",
] as const;
export type GraphNode = (typeof GRAPH_NODES)[number];

// ---------------------------------------------------------------- hub

export interface ArgRule {
  allow?: string[];
  pattern?: string;
}

export interface RateLimit {
  max: number;
  per_seconds: number;
}

export interface ToolSpec {
  args?: Record<string, ArgRule>;
  rate_limit?: RateLimit;
}

export interface RoleSpec {
  inherits?: string[];
  tools?: string[];
}

/** Shape of mcp_hub/config/policy.json, consumed by `PolicyEngine`. */
export interface Policy {
  roles: Record<string, RoleSpec>;
  tools: Record<string, ToolSpec>;
}

export interface Principal {
  id: string;
  tenant: string;
  roles: string[];
}

export type DenyReason = "unknown_tool" | "role_not_permitted" | "rate_limited" | `arg_not_allowed:${string}`;

export interface PolicyDecision {
  allowed: boolean;
  reason: "ok" | DenyReason;
  matched_role: string | null;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
}

/** Subset of the A2A 0.3 agent card served at `/.well-known/agent-card.json`. */
export interface AgentCard {
  protocolVersion: string;
  name: string;
  description: string;
  url: string;
  version: string;
  capabilities: { streaming: boolean; pushNotifications: boolean; stateTransitionHistory: boolean };
  skills: AgentSkill[];
}

/** Item from `GET /connections` (X-API-Key). */
export interface Connection {
  provider: string;
  subject: string;
  scope: string;
  expires_at: number | null;
}

/** `GET /audit/verify` (admin key). */
export interface AuditVerify {
  intact: boolean;
  first_bad_seq: number | null;
  entries: number;
}

// ---------------------------------------------------------------- console

export type BackendMode = "mock" | "live";

export interface ConsoleConfig {
  runtimeMode: BackendMode;
  hubMode: BackendMode;
  policyStore: "memory" | "file";
  streamPollMs: number;
}

/** Server-sent event payloads from /api/stream/runs. */
export type RunStreamEvent =
  | { type: "snapshot"; runs: RunRecord[] }
  | { type: "run"; change: "created" | "updated"; run: RunRecord }
  | { type: "error"; message: string };
