import type { RunStatus } from "@/lib/types";

const LABEL: Record<RunStatus, string> = {
  running: "running",
  waiting_approval: "needs approval",
  succeeded: "succeeded",
  failed: "failed",
  rejected: "rejected",
};

export function StatusBadge({ status }: { status: RunStatus }) {
  return <span className={`badge badge-${status}`}>{LABEL[status] ?? status}</span>;
}
