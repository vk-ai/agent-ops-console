/**
 * Build a run timeline from `GET /runs/{id}`.
 *
 * The runtime does not store per-node timestamps; it records the ordered list
 * of finished nodes (`steps`, an operator.add reducer in graph.py), the node
 * the run is on (`current_node`, from the heartbeat), the nodes LangGraph will
 * run next (`next`), and created/heartbeat/finished times. The timeline is
 * derived from those fields only; it does not invent timings.
 */
import { GRAPH_NODES, type RunView } from "./types";

export type NodeState = "done" | "running" | "waiting" | "failed" | "skipped" | "pending";

export interface TimelineNode {
  node: string;
  state: NodeState;
  /** 1-based position in `steps` when the node finished. */
  order: number | null;
  note?: string;
}

const TERMINAL = new Set(["succeeded", "failed", "rejected"]);

export function buildTimeline(run: RunView): TimelineNode[] {
  const terminal = TERMINAL.has(run.status);
  const known = new Set<string>(GRAPH_NODES);
  const nodes: string[] = [...GRAPH_NODES, ...run.steps.filter((s) => !known.has(s))];
  return nodes.map((node) => {
    const idx = run.steps.indexOf(node);
    if (idx >= 0) {
      let note: string | undefined;
      if (node === "human_approval" && run.approval) {
        note = `${run.approval.approved ? "approved" : "rejected"} by ${run.approval.reviewer}${
          run.approval.comment ? `: ${run.approval.comment}` : ""
        }`;
      }
      if (node === "propose_action") note = run.action ? `proposed ${run.action.type}` : "no risky action";
      if (node === "plan" && run.provider) note = `provider ${run.provider}`;
      return { node, state: "done", order: idx + 1, note };
    }
    if (run.next.includes(node)) {
      if (run.status === "waiting_approval") {
        return { node, state: "waiting", order: null, note: "waiting for a human decision" };
      }
      if (run.status === "failed") return { node, state: "failed", order: null, note: run.error ?? undefined };
      return { node, state: run.current_node === node ? "running" : "pending", order: null };
    }
    if (run.status === "failed" && run.current_node === node) {
      return { node, state: "failed", order: null, note: run.error ?? undefined };
    }
    if (run.status === "running" && run.current_node === node) return { node, state: "running", order: null };
    if (terminal) return { node, state: "skipped", order: null };
    return { node, state: "pending", order: null };
  });
}

export interface TimelineEvent {
  at: number;
  label: string;
}

/** Wall-clock events the runtime actually records. */
export function runEvents(run: RunView): TimelineEvent[] {
  const ev: TimelineEvent[] = [{ at: run.created_at, label: "run created" }];
  if (run.attempts > 1) ev.push({ at: run.heartbeat_at, label: `resumed (attempt ${run.attempts})` });
  if (run.finished_at) ev.push({ at: run.finished_at, label: `finished: ${run.status}` });
  else ev.push({ at: run.heartbeat_at, label: `last heartbeat at ${run.current_node ?? "?"}` });
  return ev.sort((a, b) => a.at - b.at);
}

export function formatTs(sec: number | null | undefined): string {
  if (!sec) return "—";
  return new Date(sec * 1000).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

export function formatDuration(run: Pick<RunView, "created_at" | "finished_at" | "heartbeat_at">): string {
  const end = run.finished_at ?? run.heartbeat_at;
  const ms = Math.max(0, (end - run.created_at) * 1000);
  return ms < 1000 ? `${ms.toFixed(0)} ms` : `${(ms / 1000).toFixed(1)} s`;
}
