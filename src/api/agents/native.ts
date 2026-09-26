import { apiRequest } from "@/api/client";
import type { AgentProfile, AgentProfileInput } from "@misty/contracts";

export const personalAgentsApi = {
  list: () => apiRequest<{ agents: AgentProfile[] }>("/misty/agents"),
  save: (
    input: AgentProfileInput & {
      version?: number;
    },
    id?: string,
  ) =>
    apiRequest<AgentProfile>(`/misty/agents${id ? `/${encodeURIComponent(id)}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiRequest(`/misty/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  memories: (id: string, _legacySpaceId?: string) =>
    apiRequest<{ memories: AgentMemory[] }>(
      `/ai/memories?${new URLSearchParams({ agent_id: id })}`,
    ),
  updateMemory: (id: string, memoryId: string, _legacySpaceId: string, content: string) =>
    apiRequest(
      `/ai/memories/${encodeURIComponent(memoryId)}?${new URLSearchParams({ agent_id: id })}`,
      { method: "PUT", body: JSON.stringify({ content }) },
    ),
  forget: (id: string, memoryId: string) =>
    apiRequest(
      `/ai/memories/${encodeURIComponent(memoryId)}?${new URLSearchParams({ agent_id: id })}`,
      { method: "DELETE" },
    ),
};
export interface AgentMemory {
  id: string;
  content: string;
  kind: string;
  space_id?: string;
}
