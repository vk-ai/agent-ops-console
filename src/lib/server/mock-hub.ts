/**
 * In-memory stand-in for mcp-integration-hub's read endpoints in mock mode.
 * The skills mirror mcp_hub/mcp_server.py TOOL_DOCS; the connection and audit
 * numbers are made up.
 */
import type { AgentCard, AuditVerify, Connection } from "../types";
import type { HubBackend } from "./hub";

export const TOOL_DOCS: Record<string, string> = {
  github_list_issues: "List GitHub issues in a repository (owner/name).",
  github_create_issue: "Create a GitHub issue in a repository (owner/name).",
  slack_list_channels: "List Slack channels in the connected workspace.",
  slack_post_message: "Post a message to a Slack channel (policy restricts which channels).",
  hubspot_search_contacts: "Search HubSpot CRM contacts by free-text query.",
  hubspot_create_contact: "Create a HubSpot CRM contact.",
};

export class MockHub implements HubBackend {
  readonly mode = "mock" as const;

  async card(): Promise<AgentCard> {
    return {
      protocolVersion: "0.3.0",
      name: "mcp-integration-hub",
      description: "Policy-checked, audited GitHub, Slack and HubSpot actions for other agents.",
      url: "http://mock-hub/a2a",
      version: "0.1.0",
      capabilities: { streaming: false, pushNotifications: false, stateTransitionHistory: false },
      skills: Object.entries(TOOL_DOCS).map(([id, description]) => ({
        id, name: id.replace(/_/g, " "), description, tags: [id.split("_")[0]],
      })),
    };
  }

  async connections(): Promise<Connection[]> {
    return [
      { provider: "github", subject: "sandbox-user-1", scope: "openid repo", expires_at: null },
      { provider: "slack", subject: "sandbox-user-1", scope: "openid chat:write channels:read", expires_at: null },
    ];
  }

  async auditVerify(): Promise<AuditVerify> {
    return { intact: true, first_bad_seq: null, entries: 12 };
  }
}
