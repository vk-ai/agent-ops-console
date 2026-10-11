/**
 * In-memory stand-in for agent-runtime-gcp, used in mock mode (no backend).
 *
 * It replays the same graph as graph.py with the same deterministic mock
 * provider text, risky-action keywords, "remember ..." memory extraction and
 * status/conflict rules as service.py, so the UI behaves the same against
 * either. It is not LangGraph: there is no checkpointer, no crash recovery and
 * no OpenTelemetry. Mock-only knobs:
 *  - a task containing "#fail" fails at `plan` like AllProvidersFailed would
 *  - `stepMs > 0` advances one node per tick in the background so live updates
 *    are visible (the real POST /runs blocks until the run pauses or ends)
 */
import { createHash, randomUUID } from "node:crypto";
import type {
  DecisionLogEntry,
  DecisionRequest,
  PendingDecision,
  Memory,
  MetricsSummary,
  RunRecord,
  RunStatus,
  RunView,
  RuntimeHealth,
  StartRunRequest,
} from "../types";
import { UpstreamError } from "./errors";
import type { RuntimeBackend } from "./runtime";

const RISKY_ACTIONS = ["deploy", "delete", "refund", "pay", "email", "send"];
const PRICES: Record<string, [number, number]> = { "mock-small": [0.0005, 0.0015] };

interface State {
  memories: string[];
  plan: string | null;
  provider: string | null;
  cost: number;
  tokens: number;
  action: ProposedActionM | null;
  approval: RunView["approval"];
  pending: (PendingDecision & { status: string }) | null;
  actionResult: string | null;
  result: string | null;
  outcome: RunStatus | null;
  steps: string[];
  next: string[];
}

type ProposedActionM = { type: string; description: string; args: Record<string, unknown>; original_args?: Record<string, unknown> };

export function detectAction(task: string): ProposedActionM | null {
  const lowered = task.toLowerCase();
  for (const kw of RISKY_ACTIONS) {
    if (new RegExp(`\\b${kw}\\b`).test(lowered)) {
      // graph.py: re.search(rf"\b{kw}\b\s*(.*)", task.strip(), re.I | re.S) -> strip().rstrip(".")[:200]
      const m = new RegExp(`\\b${kw}\\b\\s*([\\s\\S]*)`, "i").exec(task.trim());
      const target = (m ? m[1] : "").trim().replace(/\.+$/, "").slice(0, 200);
      return { type: kw, description: task.trim().slice(0, 200), args: { target } };
    }
  }
  return null;
}

const asciiOnly = (s: string) => s.replace(/[\u0080-\uffff]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);

/** Python `json.dumps(v, sort_keys=True, separators=...)` (ensure_ascii) for plain JSON values. */
export function pyJson(v: unknown, sep: [string, string] = [", ", ": "]): string {
  if (v === null || typeof v !== "object") return asciiOnly(JSON.stringify(v));
  if (Array.isArray(v)) return `[${v.map((x) => pyJson(x, sep)).join(sep[0])}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).sort().map((k) => `${asciiOnly(JSON.stringify(k))}${sep[1]}${pyJson(o[k], sep)}`).join(sep[0])}}`;
}

/** approvals.args_digest: sha256 over the canonical JSON of {type, args}. */
export function argsDigest(action: { type: string; args?: Record<string, unknown> } | null): string {
  const body = { type: action?.type ?? null, args: action?.args ?? {} };
  return "sha256:" + createHash("sha256").update(pyJson(body, [",", ":"])).digest("hex");
}

export function extractMemories(task: string): string[] {
  const re = /remember(?: that)?[:\s]+(.+?)(?:\.|$)/gi;
  return [...task.matchAll(re)].map((m) => m[1].trim());
}

/** RFC 4122 uuid5, as `uuid.uuid5(uuid.NAMESPACE_URL, name)` in save_memory. */
export function uuid5Url(name: string): string {
  const ns = Buffer.from("6ba7b8119dad11d180b400c04fd430c8", "hex");
  const h = createHash("sha1").update(Buffer.concat([ns, Buffer.from(name, "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

const words = (s: string) => Math.max(1, s.split(/\s+/).filter(Boolean).length);

export class MockRuntime implements RuntimeBackend {
  readonly mode = "mock" as const;
  private runs = new Map<string, { rec: RunRecord; st: State }>();
  private mem = new Map<string, Map<string, Memory>>();
  private busy = new Set<string>();
  private readonly instance = `mock-${randomUUID().slice(0, 6)}`;

  private log: DecisionLogEntry[] = [];

  constructor(
    private opts: {
      stepMs?: number;
      clock?: () => number;
      /** Pending approvals expire after this many seconds (0 = never), like AGENTRT_APPROVAL_TTL_S. */
      approvalTtlS?: number;
      /** {token: reviewer}, like AGENTRT_REVIEWER_TOKENS. */
      reviewerTokens?: Record<string, string>;
    } = {},
  ) {}

  private now() {
    return this.opts.clock ? this.opts.clock() : Date.now() / 1000;
  }

  async health(): Promise<RuntimeHealth> {
    return { ok: true, persistence: "mock" };
  }

  async listRuns(status?: RunStatus): Promise<RunRecord[]> {
    return [...this.runs.values()]
      .map((r) => ({ ...r.rec }))
      .filter((r) => !status || r.status === status)
      .sort((a, b) => a.created_at - b.created_at);
  }

  async getRun(runId: string): Promise<RunView> {
    return this.view(this.get(runId));
  }

  async startRun(req: StartRunRequest): Promise<RunView> {
    if (!req.user_id || !req.task) throw new UpstreamError(422, "user_id and task are required");
    const runId = req.run_id || randomUUID().replace(/-/g, "");
    if (this.runs.has(runId)) throw new UpstreamError(409, `run ${runId} already exists`);
    const t = this.now();
    const entry = {
      rec: {
        run_id: runId, user_id: req.user_id, task: req.task, status: "running" as RunStatus, owner: this.instance,
        created_at: t, heartbeat_at: t, finished_at: null, current_node: null, attempts: 1, cost_usd: 0,
        provider: null, error: null,
      },
      st: {
        memories: [], plan: null, provider: null, cost: 0, tokens: 0, action: null, approval: null, pending: null,
        actionResult: null, result: null, outcome: null, steps: [], next: ["recall_memory"],
      },
    };
    this.runs.set(runId, entry);
    return this.drive(runId);
  }

  /** Same rules as service.RunManager.decide + api.py's guard (see agent-runtime-gcp approvals.py). */
  async decide(runId: string, req: DecisionRequest, reviewerToken?: string): Promise<RunView> {
    let reviewer = req.reviewer?.trim() ?? "";
    const tokens = this.opts.reviewerTokens ?? {};
    if (reviewerToken !== undefined || Object.keys(tokens).length > 0) {
      const owner = reviewerToken ? tokens[reviewerToken] : undefined;
      if (!owner) throw new UpstreamError(401, "invalid or missing X-Approver-Token");
      if (reviewer && reviewer !== owner) throw new UpstreamError(403, `token belongs to '${owner}', not '${reviewer}'`);
      reviewer = owner;
    }
    if (!reviewer) throw new UpstreamError(422, "reviewer is required (or use a per-reviewer token)");
    const kind = req.decision ?? (typeof req.approved === "boolean" ? (req.approved ? "approve" : "reject") : undefined);
    if (!kind) throw new UpstreamError(422, "pass 'decision' (approve|reject|edit) or 'approved'");
    if (kind === "edit" && !req.edited_args) throw new UpstreamError(422, "decision 'edit' needs edited_args");
    const e = this.get(runId);
    if (e.rec.status !== "waiting_approval") {
      throw new UpstreamError(409, `run ${runId} is ${e.rec.status}, not waiting_approval`);
    }
    const p = e.st.pending!;
    if (req.pending_id !== undefined && req.pending_id !== p.pending_id) {
      throw new UpstreamError(409, "pending_id does not match the current pending approval");
    }
    if (req.args_digest !== undefined && req.args_digest !== p.args_digest) {
      throw new UpstreamError(409, "args_digest does not match: the action's arguments changed since they were reviewed");
    }
    const action = e.st.action!;
    const now = this.now();
    const entry: DecisionLogEntry = {
      run_id: runId, pending_id: p.pending_id, user_id: e.rec.user_id, action_type: action.type, reviewer,
      comment: req.comment ?? "", decided_at: now, decision: "approved", original_args: { ...action.args },
      original_args_digest: p.args_digest,
    };
    if (p.expires_at !== null && now > p.expires_at) {
      p.status = "expired";
      this.log.push({ ...entry, decision: "expired", reviewer: "system", comment: `decision by '${reviewer}' arrived after expiry` });
      e.st.approval = { approved: false, reviewer: "system", comment: "approval expired", decision: "expired", pending_id: p.pending_id };
      e.rec.status = "running";
      await this.drive(runId);
      throw new UpstreamError(410, `pending approval ${p.pending_id} expired; the run was rejected`);
    }
    const approval: NonNullable<RunView["approval"]> = {
      approved: kind !== "reject", reviewer, comment: req.comment ?? "", decision: kind, pending_id: p.pending_id,
      original_args_digest: p.args_digest,
    };
    if (kind === "edit") {
      const edited = req.edited_args;
      if (!edited || typeof edited !== "object" || Object.keys(edited).length === 0) {
        throw new UpstreamError(422, "edited_args must be a non-empty object");
      }
      const extra = Object.keys(edited).filter((k) => !(k in action.args)).sort();
      if (extra.length) throw new UpstreamError(422, `edited_args may only change existing arguments; unknown: ${JSON.stringify(extra)}`);
      const bad = Object.keys(edited).filter((k) => !["string", "number", "boolean"].includes(typeof edited[k])).sort();
      if (bad.length) throw new UpstreamError(422, `edited_args values must be strings, numbers or booleans: ${JSON.stringify(bad)}`);
      const args = { ...action.args, ...edited };
      e.st.action = { ...action, args, original_args: { ...action.args } };
      approval.approved_args_digest = entry.approved_args_digest = argsDigest(e.st.action);
      entry.edited_args = args;
    } else if (kind === "approve") {
      approval.approved_args_digest = entry.approved_args_digest = p.args_digest;
    }
    p.status = { approve: "approved", reject: "rejected", edit: "edited" }[kind];
    this.log.push({ ...entry, decision: p.status as DecisionLogEntry["decision"] });
    e.rec.status = "running";
    e.rec.heartbeat_at = now;
    e.st.approval = approval;
    return this.drive(runId);
  }

  async decisions(runId?: string, limit = 100): Promise<DecisionLogEntry[]> {
    if (runId) this.get(runId);
    return this.log
      .filter((d) => !runId || d.run_id === runId)
      .sort((a, b) => b.decided_at - a.decided_at)
      .slice(0, limit)
      .map((d) => ({ ...d }));
  }

  async resume(runId: string): Promise<RunView> {
    const e = this.get(runId);
    if (!["running", "failed"].includes(e.rec.status)) {
      throw new UpstreamError(409, `run ${runId} is ${e.rec.status}; only running/failed runs can be resumed`);
    }
    if (e.st.next.length === 0) throw new UpstreamError(409, `run ${runId} has nothing left to execute`);
    Object.assign(e.rec, { status: "running", error: null, attempts: e.rec.attempts + 1, heartbeat_at: this.now() });
    return this.drive(runId, true);
  }

  async memories(userId: string): Promise<Memory[]> {
    return [...(this.mem.get(userId)?.values() ?? [])].map((m) => ({ ...m }));
  }

  async metrics(): Promise<MetricsSummary> {
    const waiting = await this.listRuns("waiting_approval");
    return { stuck: [], waiting_approval: waiting.map((r) => r.run_id) };
  }

  // ------------------------------------------------------------- internals
  private get(runId: string) {
    const e = this.runs.get(runId);
    if (!e) throw new UpstreamError(404, `'${runId}'`);
    return e;
  }

  private view(e: { rec: RunRecord; st: State }): RunView {
    const { rec, st } = e;
    const pending =
      rec.status === "waiting_approval" && st.action
        ? { run_id: rec.run_id, action: { ...st.action }, plan: st.plan }
        : null;
    const pd = st.pending && st.pending.status === "pending" && pending ? st.pending : null;
    return {
      ...rec, next: [...st.next], pending_approval: pending,
      pending_decision: pending
        ? pd && { pending_id: pd.pending_id, args_digest: pd.args_digest, created_at: pd.created_at, expires_at: pd.expires_at, args: { ...pd.args } }
        : null,
      result: st.result, plan: st.plan,
      action: st.action ? { ...st.action } : null, approval: st.approval ? { ...st.approval } : null,
      steps: [...st.steps], memories_used: [...st.memories], tokens: st.tokens,
    };
  }

  private async drive(runId: string, retrying = false): Promise<RunView> {
    if (this.busy.has(runId)) throw new UpstreamError(409, `run ${runId} is already executing in this process`);
    const stepMs = this.opts.stepMs ?? 0;
    if (stepMs > 0) {
      this.busy.add(runId);
      void this.loop(runId, stepMs, retrying).finally(() => this.busy.delete(runId));
      return this.view(this.get(runId));
    }
    await this.loop(runId, 0, retrying);
    return this.view(this.get(runId));
  }

  private async loop(runId: string, stepMs: number, retrying: boolean) {
    const e = this.get(runId);
    while (e.st.next.length > 0) {
      const node = e.st.next[0];
      if (node === "human_approval" && !e.st.approval) {
        e.rec.status = "waiting_approval";
        if (!e.st.pending || e.st.pending.status !== "pending") {
          const t = this.now(), ttl = this.opts.approvalTtlS ?? 3600;
          e.st.pending = {
            pending_id: randomUUID().replace(/-/g, ""), args_digest: argsDigest(e.st.action), args: { ...e.st.action!.args },
            created_at: t, expires_at: ttl > 0 ? t + ttl : null, status: "pending",
          };
        }
        e.rec.current_node = node;
        e.rec.heartbeat_at = this.now();
        return;
      }
      e.rec.current_node = node;
      e.rec.heartbeat_at = this.now();
      if (stepMs > 0) await new Promise((r) => setTimeout(r, stepMs));
      try {
        e.st.next = this.step(e, node, retrying);
      } catch (err) {
        Object.assign(e.rec, { status: "failed", error: (err as Error).message, finished_at: this.now() });
        return;
      }
      e.st.steps.push(node);
      e.rec.cost_usd = e.st.cost;
      e.rec.provider = e.st.provider;
    }
    Object.assign(e.rec, { status: e.st.outcome ?? "succeeded", finished_at: this.now(), heartbeat_at: this.now() });
  }

  private step(e: { rec: RunRecord; st: State }, node: string, retrying: boolean): string[] {
    const { rec, st } = e;
    switch (node) {
      case "recall_memory":
        st.memories = [...(this.mem.get(rec.user_id)?.values() ?? [])].map((m) => m.text);
        return ["plan"];
      case "plan": {
        if (rec.task.includes("#fail") && !retrying) {
          throw new Error(
            "AllProvidersFailed: all providers failed: mock-primary: http_503; mock-backup: http_503",
          );
        }
        const mem = st.memories.map((m) => `- ${m}`).join("\n") || "- (none)";
        const prompt = `You are a careful agent.\nKnown facts about the user:\n${mem}\nTASK: ${rec.task}`;
        const first = rec.task.trim().split("\n")[0] ?? "";
        st.plan = `[${first.slice(0, 80)}] Plan: 1) gather context 2) draft result 3) verify.`;
        st.provider = "mock-primary";
        const [pin, pout] = PRICES["mock-small"];
        const pt = words(prompt), ct = words(st.plan);
        st.cost += Math.round((pt / 1000 * pin + ct / 1000 * pout) * 1e8) / 1e8;
        st.tokens += pt + ct;
        return ["propose_action"];
      }
      case "propose_action":
        st.action = detectAction(rec.task);
        return [st.action ? "human_approval" : "save_memory"];
      case "human_approval":
        return [st.approval?.approved ? "execute_action" : "save_memory"];
      case "execute_action":
        st.actionResult = `simulated ${st.action!.type} executed` +
          (Object.keys(st.action!.args).length ? ` with ${pyJson(st.action!.args)}` : "");
        return ["save_memory"];
      case "save_memory": {
        const bucket = this.mem.get(rec.user_id) ?? new Map<string, Memory>();
        for (const fact of extractMemories(rec.task)) {
          const key = uuid5Url(`${rec.user_id}:${fact.toLowerCase()}`);
          bucket.set(key, { key, text: fact, run_id: rec.run_id });
        }
        this.mem.set(rec.user_id, bucket);
        return ["finalize"];
      }
      case "finalize": {
        const a = st.approval;
        if (st.action && a && !a.approved) {
          st.outcome = "rejected";
          st.result = `Action '${st.action.type}' rejected by ${a.reviewer}. Plan only: ${st.plan}`;
        } else if (st.actionResult) {
          st.outcome = "succeeded";
          st.result = `${st.plan} Action: ${st.actionResult}.`;
        } else {
          st.outcome = "succeeded";
          st.result = st.plan;
        }
        return [];
      }
      default:
        throw new Error(`unknown node ${node}`);
    }
  }

  /** Demo data so the console isn't empty on first load. */
  async seed(): Promise<void> {
    const stepMs = this.opts.stepMs;
    this.opts.stepMs = 0;
    try {
      await this.seedRuns();
    } finally {
      this.opts.stepMs = stepMs;
    }
  }

  private async seedRuns(): Promise<void> {
    await this.startRun({ user_id: "alice", task: "Remember that I prefer weekly summaries. Summarise open incidents" });
    await this.startRun({ user_id: "alice", task: "Deploy the billing service to staging" });
    await this.startRun({ user_id: "bob", task: "Refund order 1042 for the duplicate charge" });
    await this.startRun({ user_id: "bob", task: "Remember: my team is in IST. Draft the sprint notes" });
    await this.startRun({ user_id: "carol", task: "Email the vendor the signed contract" });
    const r = await this.startRun({ user_id: "carol", task: "Delete stale preview environments" });
    await this.decide(r.run_id, { approved: false, reviewer: "ops-lead", comment: "keep until Friday" });
    await this.startRun({ user_id: "dave", task: "Compile the weekly report #fail" });
  }
}
