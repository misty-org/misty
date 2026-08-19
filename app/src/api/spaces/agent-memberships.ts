import type { AgentToolboxResponse } from "@/api/spaces/dto/interfaces/agentArchitectureTypes";
import type { SpaceAgentMembership } from "@/api/spaces/dto/interfaces/types";

type SpaceRequest = <T = void>(path: string, init?: RequestInit) => Promise<T>;

export function createSpaceAgentMembershipsApi(request: SpaceRequest) {
  return {
    spaceAgents: (spaceId: string) =>
      request<{ agents: SpaceAgentMembership[] }>(`/spaces/${encodeURIComponent(spaceId)}/agents`),
    startAgentRun: <T>(
      spaceId: string,
      agentId: string,
      input: {
        instruction: string;
        mode?: "ask" | "auto" | "full";
        timezone?: string;
        conversation_target?: string;
        context_references?: Array<{
          device_id: string;
          kind: "browser_tab" | "project_root";
          opaque_ref: string;
          display_name?: string;
          capabilities: string[];
          metadata?: Record<string, unknown>;
        }>;
      },
    ) =>
      request<T>(
        `/spaces/${encodeURIComponent(spaceId)}/agents/${encodeURIComponent(agentId)}/runs`,
        { method: "POST", body: JSON.stringify(input) },
      ),
    spaceAgentToolbox: (spaceId: string, agentId: string) =>
      request<AgentToolboxResponse>(
        `/spaces/${encodeURIComponent(spaceId)}/agents/${encodeURIComponent(agentId)}/toolbox`,
      ),
  };
}
