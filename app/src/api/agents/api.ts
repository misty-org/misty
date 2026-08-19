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
  models: <T>() => apiRequest<{ catalog_version: string; models: T[] }>("/ai/models"),
  activity: <T>(id: string, limit = 30) =>
    apiRequest<T>(`/agents/${encodeURIComponent(id)}/activity?limit=${encodeURIComponent(limit)}`),
  run: <T>(runId: string) => apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}`),
  cancelRun: <T>(runId: string) =>
    apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}/cancel`, { method: "POST" }),
  retryRun: <T>(runId: string) =>
    apiRequest<T>(`/agent-runs/${encodeURIComponent(runId)}/retry`, { method: "POST" }),
  decideApproval: <T>(runId: string, approvalId: string, decision: "approve" | "deny") =>
    apiRequest<T>(
      `/agent-runs/${encodeURIComponent(runId)}/approvals/${encodeURIComponent(approvalId)}`,
      { method: "POST", body: JSON.stringify({ decision }) },
    ),
  transcribeVoice: (audio: Blob, durationMs: number) => {
    const form = new FormData();
    form.append("audio", audio, "agent-turn.webm");
    form.append("duration_ms", String(durationMs));
    return apiRequest<{ transcript: string; detected_language: string; duration_ms: number }>(
      "/agent-voice/transcriptions",
      { method: "POST", body: form },
    );
  },
  speech: (agentId: string, responseText: string) =>
    apiBlobRequest("/agent-voice/speech", {
      method: "POST",
      body: JSON.stringify({ agent_id: agentId, response_text: responseText }),
    }),
};
