import { withDeviceRunGrants } from "./deviceRunGrants";
import { apiRequest } from "@/api/client";
import type { AiProgressItem, AiArtifact, AiInvocationCreated, AiInvocationRequest } from "./types";
import type { MistyActivityEntry } from "@/features/misty/activity";

import { toServerInvocation } from "./serverInvocation";
export * from "./aiSettingsTypes";
export { subscribeToAiInvocation } from "./invocationSubscription";
import type {
  AiMemoryRecord,
  AiRecapRecord,
  AiSurfacePreferenceRecord,
  AiUserSettings,
  ScreenLocation,
} from "./aiSettingsTypes";
export const aiSurfaceApi = {
  settings: () =>
    apiRequest<{ settings: AiUserSettings; preferences: AiSurfacePreferenceRecord[] }>(
      "/ai/settings",
    ),
  updateSettings: (enabled: boolean, retentionDays: number, memoryEnabled?: boolean) =>
    apiRequest<{ settings: AiUserSettings }>("/ai/settings", {
      method: "PUT",
      body: JSON.stringify({
        enabled,
        retention_days: retentionDays,
        ...(memoryEnabled === undefined ? {} : { memory_enabled: memoryEnabled }),
      }),
    }),
  updateScreenLocation: (location: ScreenLocation) =>
    apiRequest<{ settings: AiUserSettings }>("/ai/settings/screen-location", {
      method: "PUT",
      body: JSON.stringify({ location }),
    }),
  updateAgentSites: (change: { block_sensitive?: boolean; blocked_sites?: string[] }) =>
    apiRequest<{ settings: AiUserSettings }>("/ai/settings/agent-sites", {
      method: "PUT",
      body: JSON.stringify(change),
    }),
  /** Whether agents stop to ask before paying or buying (`payments_ask`). */
  updatePaymentsAsk: (paymentsAsk: boolean) =>
    apiRequest<{ settings: AiUserSettings }>("/ai/settings/app-actions", {
      method: "PUT",
      body: JSON.stringify({ payments: paymentsAsk }),
    }),
  updateKeepAwake: (keepAwake: boolean) =>
    apiRequest<{ settings: AiUserSettings }>("/ai/settings/keep-awake", {
      method: "PUT",
      body: JSON.stringify({ keep_awake_for_agents: keepAwake }),
    }),
  memories: () => apiRequest<{ memories: AiMemoryRecord[] }>("/ai/memories"),
  forgetMemory: (memoryId: string) =>
    apiRequest<void>(`/ai/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" }),
  activity: (spaceId: string, agentId?: string) =>
    apiRequest<{ entries: MistyActivityEntry[] }>(
      `/ai/activity?${new URLSearchParams({ space_id: spaceId, ...(agentId ? { agent_id: agentId } : {}) })}`,
    ),
  updatePreference: (
    surfaceId: string,
    input: Pick<AiSurfacePreferenceRecord, "proactive_enabled" | "saved_actions">,
  ) =>
    apiRequest<{ preference: AiSurfacePreferenceRecord }>(
      `/ai/preferences/${encodeURIComponent(surfaceId)}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
  recaps: () => apiRequest<{ recaps: AiRecapRecord[] }>("/ai/recaps"),
  updateRecap: (
    surfaceId: AiRecapRecord["surface_id"],
    input: Pick<
      AiRecapRecord,
      "enabled" | "cadence" | "local_time" | "weekday" | "timezone" | "prompt"
    >,
  ) =>
    apiRequest<{ recap: AiRecapRecord }>(`/ai/recaps/${encodeURIComponent(surfaceId)}`, {
      method: "PUT",
      body: JSON.stringify(input),
    }),
  feedback: (invocationId: string, rating: -1 | 1, reason = "", comment = "") =>
    apiRequest<void>(`/ai/invocations/${encodeURIComponent(invocationId)}/feedback`, {
      method: "POST",
      body: JSON.stringify({ rating, reason, comment }),
    }),
  createInvocation: async (input: AiInvocationRequest) => {
    const deviceContexts = await withDeviceRunGrants(input.deviceContexts, input.agentId);
    return apiRequest<AiInvocationCreated>("/ai/invocations", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify(toServerInvocation({ ...input, deviceContexts })),
    });
  },
  /** How a reply got its answer: notes and tool runs, rebuilt from its stored events. */
  invocationProgress: (invocationId: string) =>
    apiRequest<{ items: AiProgressItem[] }>(
      `/ai/invocations/${encodeURIComponent(invocationId)}/progress`,
    ),
  /** The run's stored state: queued, running, awaiting_*, completed, failed or canceled. */
  invocationState: (invocationId: string) =>
    apiRequest<{ state: string }>(`/ai/invocations/${encodeURIComponent(invocationId)}/state`),
  cancelInvocation: (invocationId: string) =>
    apiRequest<{ state: string }>(`/ai/invocations/${encodeURIComponent(invocationId)}/cancel`, {
      method: "POST",
    }),
  /** Take over: the run waits at its next step until resumed (an agent's window). */
  pauseInvocation: (invocationId: string) =>
    apiRequest<{ state: string }>(`/ai/invocations/${encodeURIComponent(invocationId)}/pause`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    }),
  resumeInvocation: (invocationId: string) =>
    apiRequest<{ state: string }>(`/ai/invocations/${encodeURIComponent(invocationId)}/resume`, {
      method: "POST",
      body: JSON.stringify({ idempotencyKey: crypto.randomUUID() }),
    }),
  decideArtifact: (
    artifactId: string,
    decision: "accept" | "reject" | "refine",
    idempotencyKey: string,
    operations?: unknown,
    refinement?: string,
  ) =>
    apiRequest<{ artifact: AiArtifact; applyMode?: "server" | "client"; result?: unknown }>(
      `/ai/artifacts/${encodeURIComponent(artifactId)}/decision`,
      {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({ decision, operations, refinement }),
      },
    ),
  completeArtifact: (artifactId: string, state: "applied" | "failed", error?: string) =>
    apiRequest<{ artifact: AiArtifact }>(
      `/ai/artifacts/${encodeURIComponent(artifactId)}/completion`,
      {
        method: "POST",
        body: JSON.stringify({ state, error: error ?? "" }),
      },
    ),
};
