"use client";
import { useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import type { DecisionKind, DecisionRequest, RunView } from "@/lib/types";

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

export function useReviewerToken(): [string, (v: string) => void] {
  // Per-reviewer token: kept in sessionStorage only (cleared when the tab closes) and sent with
  // decisions; the console server forwards it to the runtime and never stores it.
  const [token, setToken] = useState("");
  useEffect(() => {
    const saved = window.sessionStorage.getItem("reviewer-token");
    // eslint-disable-next-line react-hooks/set-state-in-effect -- load once after hydration
    if (saved) setToken(saved);
  }, []);
  return [
    token,
    (v: string) => {
      setToken(v);
      if (typeof window !== "undefined") window.sessionStorage.setItem("reviewer-token", v);
    },
  ];
}

const shortDigest = (d: string) => d.replace(/^sha256:/, "").slice(0, 12);

function fmtExpiry(expiresAt: number | null): string {
  if (expiresAt === null) return "never expires";
  const mins = Math.round((expiresAt - Date.now() / 1000) / 60);
  return mins <= 0 ? "expired" : `expires in ${mins} min`;
}

/**
 * Approve, reject or edit-then-approve one pending `human_approval` interrupt.
 *
 * Against agent-runtime-gcp with edit-args approvals, the decision is bound to the
 * `pending_id` and `args_digest` shown on the card, so the runtime refuses it (409)
 * if the arguments changed after the reviewer looked. Older runtimes have no
 * `pending_decision`; then only approve/reject are offered, as before.
 */
export function ApprovalCard({
  run,
  reviewer,
  reviewerToken = "",
  onDecided,
}: {
  run: RunView;
  reviewer: string;
  reviewerToken?: string;
  onDecided?: (run: RunView) => void;
}) {
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pd = run.pending_decision ?? null;
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(pd?.args ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const pending = run.pending_approval;
  if (!pending) return null;

  const original = pd?.args ?? {};
  const edited = Object.fromEntries(
    Object.entries(draft)
      .filter(([k, v]) => String(original[k]) !== v)
      .map(([k, v]) => [k, typeof original[k] === "number" && v.trim() !== "" && !Number.isNaN(Number(v)) ? Number(v) : v]),
  );
  const isEdited = Object.keys(edited).length > 0;

  const decide = async (kind: DecisionKind) => {
    if (!reviewer.trim() && !reviewerToken.trim()) {
      setError("Enter your reviewer name first.");
      return;
    }
    setBusy(true);
    setError(null);
    const body: DecisionRequest = { comment };
    if (reviewer.trim()) body.reviewer = reviewer.trim();
    if (pd) {
      Object.assign(body, { decision: kind, pending_id: pd.pending_id, args_digest: pd.args_digest });
      if (kind === "edit") body.edited_args = edited;
    } else {
      body.approved = kind !== "reject";
    }
    try {
      onDecided?.(await api.decide(run.run_id, body, reviewerToken.trim() || undefined));
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
      {pd && (
        <fieldset className="args" aria-label="action arguments">
          <legend>
            Arguments <code className="muted" title={pd.args_digest}>digest {shortDigest(pd.args_digest)}</code>{" "}
            <span className="muted">{fmtExpiry(pd.expires_at)}</span>
          </legend>
          {Object.keys(original).map((k) => (
            <label key={k}>
              {k}
              <input
                aria-label={`argument ${k}`}
                value={draft[k] ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, [k]: e.target.value }))}
              />
              {String(original[k]) !== (draft[k] ?? "") && <span className="muted"> was: {String(original[k])}</span>}
            </label>
          ))}
        </fieldset>
      )}
      <label>
        Comment
        <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="optional" />
      </label>
      <div className="buttons">
        {isEdited ? (
          <button className="approve" disabled={busy} onClick={() => decide("edit")}>Approve with edits</button>
        ) : (
          <button className="approve" disabled={busy} onClick={() => decide("approve")}>Approve</button>
        )}
        <button className="reject" disabled={busy} onClick={() => decide("reject")}>Reject</button>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
    </article>
  );
}
