/**
 * Live run updates.
 *
 * agent-runtime-gcp has no streaming endpoint (no SSE/WebSocket), so the
 * console's /api/stream/runs route polls `GET /runs` on the server and pushes
 * only the changes to the browser over Server-Sent Events. If EventSource is
 * unavailable or errors, the browser falls back to polling /api/runtime/runs.
 */
import type { RunRecord, RunStreamEvent } from "./types";

/** Fields whose change counts as an update (heartbeat_at alone changes often). */
const WATCHED: (keyof RunRecord)[] = [
  "status", "current_node", "attempts", "cost_usd", "provider", "error", "finished_at", "heartbeat_at",
];

export function diffRuns(prev: Map<string, RunRecord>, next: RunRecord[]): RunStreamEvent[] {
  const out: RunStreamEvent[] = [];
  for (const run of next) {
    const old = prev.get(run.run_id);
    if (!old) out.push({ type: "run", change: "created", run });
    else if (WATCHED.some((k) => old[k] !== run[k])) out.push({ type: "run", change: "updated", run });
  }
  return out;
}

export function encodeSse(ev: RunStreamEvent): string {
  return `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`;
}

/** Apply a stream event to a client-side list (sorted by created_at like GET /runs). */
export function applyRunEvent(runs: RunRecord[], ev: RunStreamEvent): RunRecord[] {
  if (ev.type === "snapshot") return [...ev.runs];
  if (ev.type !== "run") return runs;
  const i = runs.findIndex((r) => r.run_id === ev.run.run_id);
  const next = i >= 0 ? runs.map((r, j) => (j === i ? ev.run : r)) : [...runs, ev.run];
  return next.sort((a, b) => a.created_at - b.created_at);
}

/** Server side: a ReadableStream of SSE frames from repeated `list()` polls. */
export function runEventStream(
  list: () => Promise<RunRecord[]>,
  pollMs: number,
  signal?: AbortSignal,
): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let closed = false;
  const known = new Map<string, RunRecord>();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (ev: RunStreamEvent) => !closed && controller.enqueue(enc.encode(encodeSse(ev)));
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      signal?.addEventListener("abort", close);
      controller.enqueue(enc.encode(`retry: ${Math.max(1000, pollMs)}\n\n`));
      const tick = async (first: boolean) => {
        if (closed) return;
        try {
          const runs = await list();
          if (first) send({ type: "snapshot", runs });
          else for (const ev of diffRuns(known, runs)) send(ev);
          known.clear();
          for (const r of runs) known.set(r.run_id, r);
          if (!closed) controller.enqueue(enc.encode(`: ping\n\n`));
        } catch (e) {
          send({ type: "error", message: (e as Error).message });
        }
        if (!closed) timer = setTimeout(() => void tick(false), pollMs);
      };
      await tick(true);
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
    },
  });
}
