import type { SpaceAgentMembership } from "@/models/interfaces/features/spaces/types";
import type { AgentToolboxResponse } from "@/models/interfaces/features/spaces/agentArchitectureTypes";

type SpaceRequest = <T = void>(path: string, init?: RequestInit) => Promise<T>;

export function createSpaceAgentMembershipsApi(request: SpaceRequest) {
  return {
    spaceAgents: (spaceId: string) =>
      request<{ agents: SpaceAgentMembership[] }>(`/spaces/${encodeURIComponent(spaceId)}/agents`),
    addSpaceAgent: (spaceId: string, agentId: string, spaceRole = "") =>
      request<SpaceAgentMembership>(`/spaces/${encodeURIComponent(spaceId)}/agents`, {
        method: "POST",
        body: JSON.stringify({ agent_id: agentId, space_role: spaceRole }),
      }),
    updateSpaceAgent: (
      spaceId: string,
      membership: SpaceAgentMembership,
      patch: Pick<
        SpaceAgentMembership,
        | "enabled"
        | "role_id"
        | "space_role"
        | "space_instructions"
        | "permissions"
        | "capability_grants"
      >,
    ) =>
      request<SpaceAgentMembership>(
        `/spaces/${encodeURIComponent(spaceId)}/agents/${encodeURIComponent(membership.agent_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ ...patch, membership_version: membership.membership_version }),
        },
      ),
    removeSpaceAgent: (spaceId: string, agentId: string) =>
      request(`/spaces/${encodeURIComponent(spaceId)}/agents/${encodeURIComponent(agentId)}`, {
        method: "DELETE",
      }),
    approveSpaceAgentVersion: (spaceId: string, agentId: string) =>
      request<SpaceAgentMembership>(
        `/spaces/${encodeURIComponent(spaceId)}/agents/${encodeURIComponent(agentId)}/approve-version`,
        { method: "POST" },
      ),
    spaceAgentToolbox: (spaceId: string, agentId: string) =>
      request<AgentToolboxResponse>(
        `/spaces/${encodeURIComponent(spaceId)}/agents/${encodeURIComponent(agentId)}/toolbox`,
      ),
  };
}
