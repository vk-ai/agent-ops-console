"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import type { Memory } from "@/lib/types";
import { useRuns } from "./RunStreamProvider";

/**
 * Long-term memories per user (LangGraph store namespace ("memories", user_id)).
 * The runtime exposes read-only GET /users/{id}/memories; there is no delete or
 * edit endpoint, so neither is offered here.
 */
export function MemoryViewer({ initialUser }: { initialUser?: string }) {
  const { runs, version } = useRuns();
  const users = useMemo(() => [...new Set(runs.map((r) => r.user_id))].sort(), [runs]);
  const [user, setUser] = useState<string | null>(initialUser ?? null);
  const [query, setQuery] = useState("");
  const [items, setItems] = useState<Memory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const selected = user ?? users[0] ?? "";

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    api.memories(selected).then(
      (m) => {
        if (!cancelled) {
          setItems(m);
          setError(null);
        }
      },
      (e) => !cancelled && setError(e instanceof ApiError ? `${e.status}: ${e.detail}` : String(e)),
    );
    return () => {
      cancelled = true;
    };
  }, [selected, version]);

  const shown = (items ?? []).filter((m) => m.text.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="stack">
      <div className="row">
        <label>
          User
          <input list="known-users" value={selected} onChange={(e) => setUser(e.target.value)} aria-label="user id" />
          <datalist id="known-users">{users.map((u) => <option key={u} value={u} />)}</datalist>
        </label>
        <label className="grow">
          Filter
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="search memory text" />
        </label>
      </div>
      {error && <p role="alert" className="error">{error}</p>}
      {items && (
        <table className="table" aria-label="memories">
          <thead><tr><th>Memory</th><th>Source run</th><th>Key</th></tr></thead>
          <tbody>
            {shown.map((m) => (
              <tr key={m.key}>
                <td>{m.text}</td>
                <td><Link href={`/runs/${m.run_id}`}><code>{m.run_id.slice(0, 10)}</code></Link></td>
                <td><code className="muted">{m.key.slice(0, 8)}</code></td>
              </tr>
            ))}
            {shown.length === 0 && <tr><td colSpan={3} className="empty">No memories for {selected || "this user"}.</td></tr>}
          </tbody>
        </table>
      )}
    </div>
  );
}
