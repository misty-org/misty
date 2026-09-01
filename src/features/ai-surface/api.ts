import { apiRequest, httpRequest, readApiAuthToken, resolveRequiredApiBase } from "@/api/client";
import type { BillingUsage } from "@/api/spaces/dto/interfaces/agentUsageTypes";
import type {
  AiArtifact,
  AiInvocationCreated,
  AiInvocationEvent,
  AiInvocationRequest,
  AiRunCreated,
  AiCitation,
  AiContextReference,
} from "./types";

export interface AiUserSettings {
  enabled: boolean;
  active_companion_agent_id?: string;
  memory_enabled: boolean;
  retention_days: number;
  purge_state: "none" | "queued" | "working" | "verified" | "failed";
  disabled_at?: string;
  updated_at?: string;
}

export interface AiMemoryRecord {
  id: string;
  space_id?: string;
  kind: "fact" | "preference" | "instruction";
  content: string;
  reason?: string;
  last_used_at?: string;
  created_at: string;
  updated_at: string;
}

export interface AiConversationMessageRecord {
  id: string;
  role: "user" | "assistant";
  mode: string;
  content: string;
  createdAt: string;
}

export interface AiConversationRecord {
  id: string;
  title: string;
  agentId?: string;
  spaceId?: string;
  kind: "companion_task" | "misty";
  originSurface?: string;
  originHref?: string;
  privacyBoundary?: string;
  createdAt: string;
  updatedAt: string;
  messages: AiConversationMessageRecord[];
}

export interface AiSurfacePreferenceRecord {
  surface_id: string;
  pinned_agent_id?: string;
  proactive_enabled: boolean;
  proactive_cooldown_minutes: number;
  proactive_snoozed_until?: string;
  proactive_last_shown_at?: string;
  proactive_dismissed_at?: string;
  saved_actions: AiSavedAction[];
  updated_at?: string;
}

export interface AiSavedAction {
  id: string;
  label: string;
  prompt: string;
  requested_artifact_kind?: AiArtifact["kind"];
}

export interface AiRecapRecord {
  surface_id: "global" | "home" | "activity";
  enabled: boolean;
  cadence: "daily" | "weekly";
  local_time: string;
  weekday: number;
  timezone: string;
  prompt: string;
  state: "idle" | "running" | "failed";
  next_run_at?: string;
  last_invocation_id?: string;
  last_result?: string;
  last_citations: AiCitation[];
  last_error?: string;
  last_run_at?: string;
  last_seen_at?: string;
  updated_at: string;
}

export interface AiProviderStatus {
  configured: boolean;
  provider: string;
  model: string;
  model_name: string;
}

export type AiBillingUsage = BillingUsage;

export const aiSurfaceApi = {
  status: () => apiRequest<AiProviderStatus>("/ai/status"),
  usage: () => apiRequest<AiBillingUsage>("/billing/usage", { cache: "no-store" }),
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
  memories: () => apiRequest<{ memories: AiMemoryRecord[] }>("/ai/memories"),
  forgetMemory: (memoryId: string) =>
    apiRequest<void>(`/ai/memories/${encodeURIComponent(memoryId)}`, { method: "DELETE" }),
  conversations: () => apiRequest<{ conversations: AiConversationRecord[] }>("/ai/conversations"),
  conversation: (conversationId: string) =>
    apiRequest<AiConversationRecord>(`/ai/conversations/${encodeURIComponent(conversationId)}`),
  updatePreference: (
    surfaceId: string,
    input: Pick<
      AiSurfacePreferenceRecord,
      "pinned_agent_id" | "proactive_enabled" | "saved_actions"
    >,
  ) =>
    apiRequest<{ preference: AiSurfacePreferenceRecord }>(
      `/ai/preferences/${encodeURIComponent(surfaceId)}`,
      { method: "PUT", body: JSON.stringify(input) },
    ),
  recordProactiveEvent: (
    surfaceId: string,
    event: "shown" | "snoozed" | "dismissed",
    snoozeMinutes?: number,
  ) =>
    apiRequest<{ preference: AiSurfacePreferenceRecord }>(
      `/ai/preferences/${encodeURIComponent(surfaceId)}/proactive-events`,
      {
        method: "POST",
        body: JSON.stringify({
          event,
          ...(snoozeMinutes === undefined ? {} : { snooze_minutes: snoozeMinutes }),
        }),
      },
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
  markRecapSeen: (surfaceId: AiRecapRecord["surface_id"]) =>
    apiRequest<void>(`/ai/recaps/${encodeURIComponent(surfaceId)}/seen`, { method: "POST" }),
  feedback: (invocationId: string, rating: -1 | 1, reason = "", comment = "") =>
    apiRequest<void>(`/ai/invocations/${encodeURIComponent(invocationId)}/feedback`, {
      method: "POST",
      body: JSON.stringify({ rating, reason, comment }),
    }),
  createInvocation: (input: AiInvocationRequest) =>
    apiRequest<AiInvocationCreated>("/ai/invocations", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify(toServerInvocation(input)),
    }),
  createRun: (input: {
    prompt: string;
    surfaceId: string;
    paneId: string;
    invocationId?: string;
    conversationId?: string;
    spaceId?: string;
    href?: string;
    title?: string;
    context: AiContextReference[];
    idempotencyKey: string;
  }) =>
    apiRequest<AiRunCreated>("/ai/runs", {
      method: "POST",
      headers: { "Idempotency-Key": input.idempotencyKey },
      body: JSON.stringify({
        prompt: input.prompt,
        space_id: input.spaceId,
        invocation_id: input.invocationId,
        conversation_id: input.conversationId,
        idempotency_key: input.idempotencyKey,
        origin: {
          surface_id: input.surfaceId,
          pane_id: input.paneId,
          invocation_id: input.invocationId,
          href: input.href,
          title: input.title,
        },
        context: input.context.map(toServerContextReference),
      }),
    }),
  cancelInvocation: (invocationId: string) =>
    apiRequest<{ state: string }>(`/ai/invocations/${encodeURIComponent(invocationId)}/cancel`, {
      method: "POST",
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

export function subscribeToAiInvocation(
  eventsUrl: string,
  handlers: {
    onEvent: (event: AiInvocationEvent) => void;
    onError: (error: Error) => void;
  },
): () => void {
  const controller = new AbortController();
  void streamAiInvocation(eventsUrl, controller.signal, handlers).catch((error: unknown) => {
    if (controller.signal.aborted) return;
    handlers.onError(
      error instanceof Error ? error : new Error("The Misty response stream disconnected."),
    );
  });
  return () => controller.abort();
}

async function streamAiInvocation(
  eventsUrl: string,
  signal: AbortSignal,
  handlers: {
    onEvent: (event: AiInvocationEvent) => void;
    onError: (error: Error) => void;
  },
) {
  const [base, token] = await Promise.all([resolveRequiredApiBase(), readApiAuthToken()]);
  const headers = new Headers({ Accept: "text/event-stream" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await httpRequest(`${base}${eventsUrl}`, {
    method: "GET",
    credentials: "include",
    headers,
    signal,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Misty could not open the response stream (${response.status}).`);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (!signal.aborted) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true }).replace(/\r\n/g, "\n");
    let boundary = buffer.indexOf("\n\n");
    while (boundary >= 0) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (data) {
        try {
          handlers.onEvent(JSON.parse(data) as AiInvocationEvent);
        } catch {
          handlers.onError(new Error("Misty returned an invalid stream event."));
        }
      }
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function toServerInvocation(input: AiInvocationRequest) {
  return {
    mode: input.mode,
    surface_id: input.surfaceId,
    trigger: input.trigger,
    prompt: input.prompt,
    context: input.context.map(toServerContextReference),
    selection: input.selection,
    capture: input.capture
      ? {
          id: input.capture.id,
          name: input.capture.name,
          mime_type: input.capture.mimeType,
          data_url: input.capture.dataUrl,
          width: input.capture.width,
          height: input.capture.height,
          content_hash: input.capture.contentHash,
        }
      : undefined,
    attachment_ids: input.attachmentIds,
    device_contexts: input.deviceContexts?.map((context) => ({
      device_id: context.deviceId,
      kind: context.kind,
      opaque_ref: context.opaqueRef,
      display_name: context.displayName,
      capabilities: context.capabilities,
      metadata: context.metadata,
    })),
    model_id: input.modelId,
    reasoning_effort: input.reasoningEffort,
    requested_artifact_kind: input.requestedArtifactKind,
    conversation_id: input.conversationId,
    idempotency_key: input.idempotencyKey,
    timezone: input.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? "UTC",
  };
}

function toServerContextReference(reference: AiContextReference) {
  return {
    kind: reference.kind,
    id: reference.id,
    title: reference.title,
    privacy: reference.privacy,
    space_id: reference.spaceId,
    href: reference.href,
    revision: reference.revision,
    opaque_scope_id: reference.opaqueScopeId,
    attached: reference.attached,
    metadata: reference.metadata,
  };
}
