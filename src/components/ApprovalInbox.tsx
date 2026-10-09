"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type { RunView } from "@/lib/types";
import { ApprovalCard, useReviewer } from "./ApprovalCard";
import { useRuns } from "./RunStreamProvider";

export function ApprovalInbox() {
  const { runs, version } = useRuns();
  const [reviewer, setReviewer] = useReviewer();
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

  const pending = Object.values(views).sort((a, b) => a.created_at - b.created_at);

  return (
    <div className="stack">
      <label className="reviewer">
        Reviewer name
        <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="e.g. vinay" />
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
              onDecided={(done) => {
                setViews((s) => {
                  const n = { ...s };
                  delete n[done.run_id];
                  return n;
                });
                setRecent((r) => [done, ...r].slice(0, 10));
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
                <Link href={`/runs/${r.run_id}`}>{r.run_id.slice(0, 12)}</Link> {r.approval?.approved ? "approved" : "rejected"} →{" "}
                <strong>{r.status}</strong>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
