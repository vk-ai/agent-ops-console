"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type { DecisionLogEntry, RunView } from "@/lib/types";
import { ApprovalCard, useReviewer, useReviewerToken } from "./ApprovalCard";
import { useRuns } from "./RunStreamProvider";

export function ApprovalInbox() {
  const { runs, version } = useRuns();
  const [reviewer, setReviewer] = useReviewer();
  const [token, setToken] = useReviewerToken();
  const [log, setLog] = useState<DecisionLogEntry[]>([]);
  const [logTick, setLogTick] = useState(0);
  const [views, setViews] = useState<Record<string, RunView>>({});
  const [recent, setRecent] = useState<RunView[]>([]);
  const waitingIds = useMemo(
    () => runs.filter((r) => r.status === "waiting_approval").map((r) => r.run_id),
    [runs],
  );
  const key = waitingIds.join(",");

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    Promise.all(ids.map((id) => api.getRun(id).catch(() => null))).then((list) => {
      if (cancelled) return;
      const next: Record<string, RunView> = {};
      for (const v of list) if (v && v.pending_approval) next[v.run_id] = v;
      setViews(next);
    });
    return () => {
      cancelled = true;
    };
  }, [key, version]);

  useEffect(() => {
    let cancelled = false;
    api.decisions().then((l) => !cancelled && setLog(l)).catch(() => !cancelled && setLog([]));
    return () => {
      cancelled = true;
    };
  }, [version, logTick]);

  const pending = Object.values(views).sort((a, b) => a.created_at - b.created_at);

  return (
    <div className="stack">
      <label className="reviewer">
        Reviewer name
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. vinay" />
      </label>
      <label className="reviewer">
        Reviewer token
        <input
          type="password"
          autoComplete="off"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="optional: your personal token (AGENTRT_REVIEWER_TOKENS)"
        />
      </label>
      {pending.length === 0 ? (
        <p className="empty">No runs are waiting for approval.</p>
      ) : (
        <div className="grid" aria-label="pending approvals">
          {pending.map((v) => (
            <ApprovalCard
              key={v.run_id}
              run={v}
              reviewer={reviewer}
              reviewerToken={token}
              onDecided={(done) => {
                setViews((s) => {
                  const n = { ...s };
                  delete n[done.run_id];
                  return n;
                });
                setRecent((r) => [done, ...r].slice(0, 10));
                setLogTick((t) => t + 1);
              }}
            />
          ))}
        </div>
      )}
      {recent.length > 0 && (
        <section aria-label="recent decisions">
          <h2>Decided in this session</h2>
          <ul className="list">
            {recent.map((r) => (
              <li key={r.run_id}>
                <Link href={`/runs/${r.run_id}`}>{r.run_id.slice(0, 12)}</Link>{" "}
                {r.approval?.decision === "edit" ? "edited" : r.approval?.approved ? "approved" : "rejected"} →{" "}
                <strong>{r.status}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
      {log.length > 0 && (
        <section aria-label="decision log">
          <h2>Decision log</h2>
          <table className="table">
            <thead>
              <tr>
                <th>When</th><th>Run</th><th>Action</th><th>Reviewer</th><th>Decision</th><th>Arguments</th><th>Comment</th>
              </tr>
            </thead>
            <tbody>
              {log.map((d) => (
                <tr key={`${d.run_id}:${d.pending_id}`}>
                  <td>{new Date(d.decided_at * 1000).toLocaleString()}</td>
                  <td><Link href={`/runs/${d.run_id}`}>{d.run_id.slice(0, 12)}</Link></td>
                  <td>{d.action_type}</td>
                  <td>{d.reviewer}</td>
                  <td>{d.decision}</td>
                  <td>
                    {d.edited_args ? (
                      <>
                        <s>{JSON.stringify(d.original_args)}</s> → {JSON.stringify(d.edited_args)}
                      </>
                    ) : (
                      JSON.stringify(d.original_args)
                    )}
                  </td>
                  <td>{d.comment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
