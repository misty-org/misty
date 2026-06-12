import type { AgentToolboxResponse } from "@/api/spaces/dto/interfaces/agentArchitectureTypes";
import type { SpaceAgentMembership } from "@/api/spaces/dto/interfaces/types";

type SpaceRequest = <T = void>(path: string, init?: RequestInit) => Promise<T>;

export function createSpaceAgentMembershipsApi(request: SpaceRequest) {
  return {
    spaceAgents: (spaceId: string) =>
      request<{ agents: SpaceAgentMembership[] }>(`/spaces/${encodeURIComponent(spaceId)}/agents`),
    spaceAgentToolbox: (spaceId: string, agentId: string) =>
      request<AgentToolboxResponse>(
        `/spaces/${encodeURIComponent(spaceId)}/agents/${encodeURIComponent(agentId)}/toolbox`,
      ),
  };
}
