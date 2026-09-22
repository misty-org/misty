import { apiRequest } from "@/api/client";

/** A remembered approval: this agent may take this action on this one resource in Auto. */
export interface AgentGrant {
  id: string;
  agent_id: string;
  agent_name: string;
  action: string;
  scope_kind: string;
  scope_id: string;
  /** Plain words from the server, e.g. "Push to misty-org/misty". */
  label: string;
  created_at: string;
  last_used_at?: string;
  use_count: number;
}

export const grantsApi = {
  list: () => apiRequest<{ grants: AgentGrant[] }>("/me/agent-grants", { cache: "no-store" }),
  revoke: (id: string) =>
    apiRequest<void>(`/me/agent-grants/${encodeURIComponent(id)}`, { method: "DELETE" }),
  revokeAll: (agentId: string) =>
    apiRequest<{ revoked: number }>(
      `/me/agent-grants?${new URLSearchParams({ agent_id: agentId })}`,
      { method: "DELETE" },
    ),
};

/** Grants grouped by agent, agents in name order, newest grant first within each. */
export function groupGrants(grants: AgentGrant[]) {
  const groups = new Map<string, { agentId: string; agentName: string; grants: AgentGrant[] }>();
  for (const grant of grants) {
    const group = groups.get(grant.agent_id) ?? {
      agentId: grant.agent_id,
      agentName: grant.agent_name || "Agent",
      grants: [],
    };
    group.grants.push(grant);
    groups.set(grant.agent_id, group);
  }
  return [...groups.values()].sort((a, b) => a.agentName.localeCompare(b.agentName));
}

/** "Last used 3 days ago", "Last used today" or "Not used yet". */
export function lastUsedText(grant: Pick<AgentGrant, "last_used_at">, now = Date.now()) {
  if (!grant.last_used_at) return "Not used yet";
  const days = Math.floor((now - Date.parse(grant.last_used_at)) / 86_400_000);
  if (days <= 0) return "Last used today";
  if (days === 1) return "Last used yesterday";
  return `Last used ${days} days ago`;
}
