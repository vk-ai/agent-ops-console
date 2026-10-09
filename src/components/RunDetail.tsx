"use client";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { formatDuration } from "@/lib/timeline";
import type { RunView } from "@/lib/types";
import { ApprovalCard, useReviewer } from "./ApprovalCard";
import { RunTimeline } from "./RunTimeline";
import { useRuns } from "./RunStreamProvider";
import { StatusBadge } from "./StatusBadge";

export function RunDetail({ runId }: { runId: string }) {
  const { runs } = useRuns();
  const [run, setRun] = useState<RunView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useReviewer();
  const summary = runs.find((r) => r.run_id === runId);
  const fingerprint = summary ? `${summary.status}|${summary.current_node}|${summary.heartbeat_at}|${summary.attempts}` : "";

  const load = useCallback(async () => {
    try {
      setRun(await api.getRun(runId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.detail}` : (e as Error).message);
    }
  }, [runId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- refetch when the live stream reports a change
    void load();
  }, [load, fingerprint]);

  if (error && !run) return <p role="alert" className="error">{error}</p>;
  if (!run) return <p>Loading…</p>;

  return (
    <div className="stack">
      <div className="run-head">
        <h1><code>{run.run_id}</code></h1>
        <StatusBadge status={run.status} />
      </div>
      <dl className="facts">
        <dt>User</dt><dd><Link href={`/memories?user=${encodeURIComponent(run.user_id)}`}>{run.user_id}</Link></dd>
        <dt>Task</dt><dd>{run.task}</dd>
        <dt>Provider</dt><dd>{run.provider ?? "—"}</dd>
        <dt>Cost / tokens</dt><dd>${run.cost_usd.toFixed(6)} · {run.tokens} tokens</dd>
        <dt>Attempts</dt><dd>{run.attempts}</dd>
        <dt>Duration</dt><dd>{formatDuration(run)}</dd>
        <dt>Owner</dt><dd><code>{run.owner}</code></dd>
        {run.error && (<><dt>Error</dt><dd className="error">{run.error}</dd></>)}
      </dl>
      <RunTimeline run={run} />
      {run.pending_approval && (
        <section className="stack">
          <h2>Pending approval</h2>
          <label className="reviewer">
            Reviewer name
            <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
          </label>
          <ApprovalCard run={run} reviewer={reviewer} onDecided={setRun} />
        </section>
      )}
      {run.status === "failed" && run.next.length > 0 && (
        <button
          onClick={async () => {
            try {
              setRun(await api.resume(run.run_id));
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Resume from last checkpoint
        </button>
      )}
      {run.memories_used.length > 0 && (
        <section>
          <h2>Memories recalled</h2>
          <ul className="list">{run.memories_used.map((m, i) => <li key={i}>{m}</li>)}</ul>
        </section>
      )}
      {run.result && (
        <section>
          <h2>Result</h2>
          <p className="result">{run.result}</p>
        </section>
      )}
      {error && <p role="alert" className="error">{error}</p>}
    </div>
  );
}
