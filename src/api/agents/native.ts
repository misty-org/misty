import { apiRequest } from "@/api/client";
import type { AgentProfile, AgentProfileInput, AgentAppAssignments } from "@misty/contracts";

export const personalAgentsApi = {
  list: () => apiRequest<{ agents: AgentProfile[] }>("/misty/agents"),
  save: (
    input: AgentProfileInput & {
      version?: number;
      assignment?: { space_id: string; app_ids: string[] };
    },
    id?: string,
  ) =>
    apiRequest<AgentProfile>(`/misty/agents${id ? `/${encodeURIComponent(id)}` : ""}`, {
      method: id ? "PUT" : "POST",
      body: JSON.stringify(input),
    }),
  remove: (id: string) =>
    apiRequest(`/misty/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  apps: (id: string, spaceId: string) => apiRequest<AgentAppAssignments>(appPath(id, spaceId)),
  assign: (id: string, spaceId: string, appIds: string[]) =>
    apiRequest<AgentAppAssignments>(appPath(id, spaceId), {
      method: "PUT",
      body: JSON.stringify({ app_ids: appIds }),
    }),
  memories: (id: string, spaceId: string) =>
    apiRequest<{ memories: AgentMemory[] }>(
      `/ai/memories?${new URLSearchParams({ agent_id: id, space_id: spaceId })}`,
    ),
  updateMemory: (id: string, memoryId: string, spaceId: string, content: string) =>
    apiRequest(
      `/ai/memories/${encodeURIComponent(memoryId)}?${new URLSearchParams({ agent_id: id })}`,
      { method: "PUT", body: JSON.stringify({ space_id: spaceId, content }) },
    ),
  forget: (id: string, memoryId: string) =>
    apiRequest(
      `/ai/memories/${encodeURIComponent(memoryId)}?${new URLSearchParams({ agent_id: id })}`,
      { method: "DELETE" },
    ),
};
function appPath(id: string, _spaceId: string) {
  return `/misty/agents/${encodeURIComponent(id)}/apps`;
}
export interface AgentMemory {
  id: string;
  content: string;
  kind: string;
  space_id?: string;
}
