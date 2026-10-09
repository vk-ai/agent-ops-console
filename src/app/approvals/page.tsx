import { ApprovalInbox } from "@/components/ApprovalInbox";

export default function ApprovalsPage() {
  return (
    <>
      <h1>Approval inbox</h1>
      <p className="muted">
        Runs paused at the <code>human_approval</code> interrupt because they proposed a risky action (deploy, delete,
        refund, pay, email, send). Approving resumes the run and executes the (simulated) action; rejecting finishes it as
        rejected.
      </p>
      <ApprovalInbox />
    </>
  );
}
