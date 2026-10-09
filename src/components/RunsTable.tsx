"use client";
import Link from "next/link";
import { useState } from "react";
import { formatDuration, formatTs } from "@/lib/timeline";
import { RUN_STATUSES, type RunRecord, type RunStatus } from "@/lib/types";
import { StatusBadge } from "./StatusBadge";

export function RunsTable({ runs, limit }: { runs: RunRecord[]; limit?: number }) {
  const [filter, setFilter] = useState<RunStatus | "all">("all");
  const shown = runs
    .filter((r) => filter === "all" || r.status === filter)
    .slice()
    .reverse()
    .slice(0, limit ?? Infinity);
  return (
    <div>
      <label className="inline">
        Status
        <select value={filter} onChange={(e) => setFilter(e.target.value as RunStatus | "all")} aria-label="status filter">
          <option value="all">all</option>
          {RUN_STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </label>
      <table className="table" aria-label="runs">
        <thead>
          <tr>
            <th>Run</th><th>User</th><th>Task</th><th>Status</th><th>Node</th><th>Cost (USD)</th><th>Duration</th><th>Created</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.run_id} data-run-id={r.run_id}>
              <td><Link href={`/runs/${r.run_id}`}><code>{r.run_id.slice(0, 10)}</code></Link></td>
              <td>{r.user_id}</td>
              <td className="task-cell" title={r.task}>{r.task}</td>
              <td><StatusBadge status={r.status} /></td>
              <td><code>{r.current_node ?? "—"}</code></td>
              <td>{r.cost_usd.toFixed(6)}</td>
              <td>{formatDuration(r)}</td>
              <td>{formatTs(r.created_at)}</td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr><td colSpan={8} className="empty">No runs.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
