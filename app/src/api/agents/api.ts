import { apiBlobRequest, apiRequest } from "@/api/client";

export const agentsApi = {
  list: <T>() => apiRequest<{ agents: T[] }>("/agents"),
  create: <T>(input: unknown) =>
    apiRequest<T>("/agents", { method: "POST", body: JSON.stringify(input) }),
  update: <T>(id: string, input: unknown) =>
    apiRequest<T>(`/agents/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify(input),
    }),
  remove: (id: string) => apiRequest(`/agents/${encodeURIComponent(id)}`, { method: "DELETE" }),
  grants: <T>(id: string) =>
    apiRequest<{ grants: T[] }>(`/agents/${encodeURIComponent(id)}/space-grants`),
  toolboxCatalog: <T>() => apiRequest<T>("/agents/toolbox"),
  toolbox: <T>(id: string) => apiRequest<T>(`/agents/${encodeURIComponent(id)}/toolbox`),
  uploadAvatar: <T>(id: string, file: File) =>
    apiRequest<T>(`/agents/${encodeURIComponent(id)}/avatar`, {
      method: "PUT",
      headers: { "Content-Type": file.type },
      body: file,
    }),
  avatar: (id: string, version: number) =>
    apiBlobRequest(
      `/agents/${encodeURIComponent(id)}/avatar?version=${encodeURIComponent(version)}`,
    ),
  replaceGrants: <T>(
    id: string,
    spaces: Array<{ space_id: string; all_members: boolean; member_user_ids: string[] }>,
  ) =>
    apiRequest<{ grants: T[] }>(`/agents/${encodeURIComponent(id)}/space-grants`, {
      method: "PUT",
      body: JSON.stringify({ spaces }),
    }),
  models: <T>() => apiRequest<{ catalog_version: string; models: T[] }>("/ai/models"),
  activity: <T>(id: string, limit = 30) =>
    apiRequest<T>(`/agents/${encodeURIComponent(id)}/activity?limit=${encodeURIComponent(limit)}`),
  run: <T>(runId: string) => apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}`),
  cancelRun: <T>(runId: string) =>
    apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  retryRun: <T>(runId: string) =>
    apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}/retry`, { method: "POST" }),
};
