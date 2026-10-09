"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";

export function StartRunForm() {
  const router = useRouter();
  const [userId, setUserId] = useState("alice");
  const [task, setTask] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="card form"
      aria-label="start run"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        try {
          const run = await api.startRun({ user_id: userId, task });
          setTask("");
          router.push(`/runs/${run.run_id}`);
        } catch (err) {
          setError(err instanceof ApiError ? `${err.status}: ${err.detail}` : (err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <label>
        User ID
        <input value={userId} onChange={(e) => setUserId(e.target.value)} required />
      </label>
      <label className="grow">
        Task
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          placeholder='e.g. "Deploy the API to staging" (needs approval) or "Remember: I am on call this week"'
          required
        />
      </label>
      <button type="submit" disabled={busy}>Start run</button>
      {error && <p role="alert" className="error">{error}</p>}
    </form>
  );
}
