import { hasTauriInternals } from "@/shared/platform/tauri";
import { isLocalGrant, localAppsApi, localGrantHolder } from "../connected-apps/local_api";
import { personalAgentsApi } from "../personal/personal_agents_api";
import {
  localSiteGrants,
  namedGrants,
  revokeAgentSiteGrants,
  revokeSiteGrant,
} from "./local_site_grants";

export interface AgentGrant {
  id: string;
  agent_id: string;
  agent_name: string;
  action: string;
  scope_kind: string;
  scope_id: string;
  label: string;
  created_at: string;
  last_used_at?: string;
  use_count: number;
}

async function localGrants(): Promise<AgentGrant[]> {
  if (!hasTauriInternals()) return [];
  return (await localAppsApi.grants()).grants;
}

export const grantsApi = {
  list: async () => {
    const [sites, local, agents] = await Promise.allSettled([
      localSiteGrants(),
      localGrants(),
      personalAgentsApi.list(),
    ]);
    const here = local.status === "fulfilled" ? local.value : [];
    if (sites.status === "rejected" && !here.length) throw sites.reason;
    const names = new Map(
      agents.status === "fulfilled"
        ? agents.value.agents.map((agent) => [agent.id, agent.name])
        : [],
    );
    return {
      grants: [...namedGrants(sites.status === "fulfilled" ? sites.value : [], names), ...here],
    };
  },
  revoke: (id: string) => (isLocalGrant(id) ? localAppsApi.revokeGrant(id) : revokeSiteGrant(id)),
  revokeAll: (agentId: string) =>
    agentId === localGrantHolder ? localAppsApi.revokeAllGrants() : revokeAgentSiteGrants(agentId),
};

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

export function lastUsedText(grant: Pick<AgentGrant, "last_used_at">, now = Date.now()) {
  if (!grant.last_used_at) return "Not used yet";
  const days = Math.floor((now - Date.parse(grant.last_used_at)) / 86_400_000);
  if (days <= 0) return "Last used today";
  if (days === 1) return "Last used yesterday";
  return `Last used ${days} days ago`;
}
