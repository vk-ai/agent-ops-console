import { HubPanel } from "@/components/HubPanel";

export default function PermissionsPage() {
  return (
    <>
      <h1>Tool permissions</h1>
      <p className="muted">
        mcp-integration-hub RBAC: a checkbox is a direct grant; &quot;via X&quot; means the role inherits the tool from X.
        Argument rules apply to every role, and tools without a spec are denied.
      </p>
      <HubPanel />
    </>
  );
}
