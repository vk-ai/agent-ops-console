"use client";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import type { RunView } from "@/lib/types";

export function useReviewer(): [string, (v: string) => void] {
  const [name, setName] = useState("");
  useEffect(() => {
    const saved = window.localStorage.getItem("reviewer");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once after hydration
    if (saved) setName(saved);
  }, []);
  return [
    name,
    (v: string) => {
      setName(v);
      if (typeof window !== "undefined") window.localStorage.setItem("reviewer", v);
    },
  ];
}

/** Approve or reject one pending `human_approval` interrupt. */
export function ApprovalCard({
  run,
  reviewer,
  onDecided,
}: {
  run: RunView;
  reviewer: string;
  onDecided?: (run: RunView) => void;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pending = run.pending_approval;
  if (!pending) return null;

  const decide = async (approved: boolean) => {
    if (!reviewer.trim()) {
      setError("Enter your reviewer name first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      onDecided?.(await api.decide(run.run_id, { approved, reviewer: reviewer.trim(), comment }));
    } catch (e) {
      setError(e instanceof ApiError ? `${e.status}: ${e.detail}` : (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <article className="card approval" aria-label={`approval for run ${run.run_id}`}>
      <header>
        <span className="action-type">{pending.action.type}</span>
        <code className="muted">{run.run_id.slice(0, 12)}</code>
        <span className="muted">user {run.user_id}</span>
      </header>
      <p className="task">{pending.action.description}</p>
      {pending.plan && <p className="plan"><strong>Plan:</strong> {pending.plan}</p>}
      <label>
        Comment
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="optional" />
      </label>
      <div className="buttons">
        <button className="approve" disabled={busy} onClick={() => decide(true)}>Approve</button>
        <button className="reject" disabled={busy} onClick={() => decide(false)}>Reject</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </article>
  );
}
