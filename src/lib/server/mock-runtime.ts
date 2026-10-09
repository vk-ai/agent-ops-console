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
import type { RuntimeBackend } from "./runtime";

const RISKY_ACTIONS = ["deploy", "delete", "refund", "pay", "email", "send"];
const PRICES: Record<string, [number, number]> = { "mock-small": [0.0005, 0.0015] };

interface State {
  memories: string[];
  plan: string | null;
  provider: string | null;
  cost: number;
  tokens: number;
  action: { type: string; description: string } | null;
  approval: { approved: boolean; reviewer: string; comment: string } | null;
  actionResult: string | null;
  result: string | null;
  outcome: RunStatus | null;
  steps: string[];
  next: string[];
}

export function detectAction(task: string) {
  const lowered = task.toLowerCase();
  for (const kw of RISKY_ACTIONS) {
    if (new RegExp(`\\b${kw}\\b`).test(lowered)) return { type: kw, description: task.trim().slice(0, 200) };
  }
  return null;
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

  constructor(
    private opts: { stepMs?: number; clock?: () => number } = {},
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
        memories: [], plan: null, provider: null, cost: 0, tokens: 0, action: null, approval: null,
        actionResult: null, result: null, outcome: null, steps: [], next: ["recall_memory"],
      },
    };
    this.runs.set(runId, entry);
    return this.drive(runId);
  }

  async decide(runId: string, req: DecisionRequest): Promise<RunView> {
    const e = this.get(runId);
    if (e.rec.status !== "waiting_approval") {
      throw new UpstreamError(409, `run ${runId} is ${e.rec.status}, not waiting_approval`);
    }
    if (typeof req.approved !== "boolean" || !req.reviewer) throw new UpstreamError(422, "approved and reviewer are required");
    e.rec.status = "running";
    e.rec.heartbeat_at = this.now();
    e.st.approval = { approved: req.approved, reviewer: req.reviewer, comment: req.comment ?? "" };
    return this.drive(runId);
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
    return {
      ...rec, next: [...st.next], pending_approval: pending, result: st.result, plan: st.plan,
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
        st.actionResult = `simulated ${st.action!.type} executed`;
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
