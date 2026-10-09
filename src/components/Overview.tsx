"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { RUN_STATUSES, type MetricsSummary, type RuntimeHealth } from "@/lib/types";
import { useRuns } from "./RunStreamProvider";
import { RunsTable } from "./RunsTable";
import { StartRunForm } from "./StartRunForm";

export function Overview() {
  const { runs, version, error } = useRuns();
  const [health, setHealth] = useState<RuntimeHealth | string | null>(null);
  const [metrics, setMetrics] = useState<MetricsSummary | null>(null);
  useEffect(() => {
    api.health().then(setHealth, (e) => setHealth(e.message));
  }, []);
  useEffect(() => {
    api.metrics().then(setMetrics, () => setMetrics(null));
  }, [version]);
  const totalCost = runs.reduce((s, r) => s + r.cost_usd, 0);
  return (
    <div className="stack">
      <div className="tiles">
        <div className="tile">
          <span className="label">Runtime</span>
          <span className="value" data-testid="health">
            {health === null ? "…" : typeof health === "string" ? `down: ${health}` : `ok (${health.persistence})`}
          </span>
        </div>
        {RUN_STATUSES.map((s) => (
          <div className="tile" key={s}>
            <span className="label">{s}</span>
            <span className="value" data-testid={`count-${s}`}>{runs.filter((r) => r.status === s).length}</span>
          </div>
        ))}
        <div className="tile">
          <span className="label">Stuck (watchdog)</span>
          <span className="value">{metrics ? metrics.stuck.length : "…"}</span>
        </div>
        <div className="tile">
          <span className="label">Total cost</span>
          <span className="value">${totalCost.toFixed(5)}</span>
        </div>
      </div>
      {error && <p role="alert" className="error">Live updates: {error}</p>}
      <StartRunForm />
      <h2>Recent runs <Link href="/runs" className="small">all runs →</Link></h2>
      <RunsTable runs={runs} limit={8} />
    </div>
  );
}
