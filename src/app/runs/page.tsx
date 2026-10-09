"use client";
import { useRuns } from "@/components/RunStreamProvider";
import { RunsTable } from "@/components/RunsTable";

export default function RunsPage() {
  const { runs, transport } = useRuns();
  return (
    <>
      <h1>Runs</h1>
      <p className="muted">
        {runs.length} runs · live via {transport === "sse" ? "Server-Sent Events (the console polls the runtime server-side)" : transport}
      </p>
      <RunsTable runs={runs} />
    </>
  );
}
