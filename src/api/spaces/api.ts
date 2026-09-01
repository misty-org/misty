import {
  ApiRequestError,
  HttpRequestError,
  apiRequest,
  assertStableApiSession,
  resolveRequiredApiBase,
} from "@/api/client";
import { createSpaceActionSuggestionsApi } from "@/api/spaces/action-suggestions";
import { createSpaceAgentMembershipsApi } from "@/api/spaces/agent-memberships";
import {
  isSpaceReferenceOnly,
  isSpaceWriteRequest,
  setSpaceReferenceOnly,
} from "@/api/spaces/connectivity";
import { createSpaceConversationsApi } from "@/api/spaces/conversations";
import type {
  AvailableProviderResource,
  CreateSpaceRequest,
  CreateSpaceResult,
  ProviderAuthorizationStart,
  ProviderConnectionAvailability,
  ProviderSharedResource,
  Space,
  SpaceIntegration,
  SpaceInvitationPreview,
  SpaceNode,
  SpaceRun,
  SpaceSetup,
  SpacesSnapshot,
  SpaceStudioResource,
  SpaceTemplate,
} from "@/api/spaces/dto/interfaces/types";
import { createSpaceMembersApi } from "@/api/spaces/members";
import { createSpacePlannerExpansionApi } from "@/api/spaces/planner";
import { createSpaceChatApi } from "./chat";
import { createSpaceLibraryCollectionsApi } from "./library-collections";
import { createSpaceLibraryEditsApi } from "./library-edits";
import { createSpaceLibraryItemsApi } from "./library-items";
import { fetchProtectedBlob } from "./library-upload";
import { createSpaceTasksApi } from "./tasks";
import type { SpaceRequestInit } from "./types";

export class SpaceRequestError extends ApiRequestError {
  constructor(message: string, status: number, code?: string, responseText = "") {
    super(message, status, code, responseText);
    this.name = "SpaceRequestError";
  }
}

export async function resolveSpacesApiBase(): Promise<string> {
  return resolveRequiredApiBase();
}

export async function spaceRequest<T = void>(path: string, init?: SpaceRequestInit): Promise<T> {
  if (
    isSpaceReferenceOnly() &&
    isSpaceWriteRequest(init?.method) &&
    !init?.allowWhileReferenceOnly
  ) {
    throw new SpaceRequestError(
      "Spaces are unavailable while Misty reconnects.",
      503,
      "offline_reference_only",
    );
  }
  const { allowWhileReferenceOnly: _allowWhileReferenceOnly, ...requestInit } = init ?? {};
  try {
    return await apiRequest<T>(path, requestInit);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw new SpaceRequestError(
        spaceErrorMessage(error.code, error.responseText || error.message),
        error.status,
        error.code,
        error.responseText,
      );
    }
    if (error instanceof HttpRequestError) setSpaceReferenceOnly(true);
    throw error;
  }
}

const pendingSpaceCreationKeys = new Map<string, string>();

function createSpaceRequest(request: CreateSpaceRequest): Promise<CreateSpaceResult> {
  const fingerprint = JSON.stringify(request);
  const idempotencyKey = pendingSpaceCreationKeys.get(fingerprint) ?? crypto.randomUUID();
  pendingSpaceCreationKeys.set(fingerprint, idempotencyKey);
  return spaceRequest<CreateSpaceResult>("/spaces", {
    method: "POST",
    headers: { "Idempotency-Key": idempotencyKey },
    body: JSON.stringify(request),
  }).then((result) => {
    pendingSpaceCreationKeys.delete(fingerprint);
    return result;
  });
}

export function assertStableSpaceAccount(generation: number): void {
  try {
    assertStableApiSession(generation);
  } catch (error) {
    if (error instanceof ApiRequestError) {
      throw new SpaceRequestError(error.message, error.status, error.code, error.responseText);
    }
    throw error;
  }
}

export function spaceErrorMessage(code: string | undefined, fallback: string): string {
  const reason = quotaReason(fallback) ?? code;
  const quotaMessages: Record<string, string> = {
    personal_storage_limit_reached:
      "Your personal storage is full. Free some of your contributions or upgrade your plan. Existing files remain available.",
    space_storage_limit_reached:
      "This Space’s storage is full. Its owner must upgrade their plan, or someone must free Space capacity. Existing files remain available.",
    personal_ai_limit_reached:
      "Your personal weekly hosted AI allowance is used. Wait for it to reset or upgrade your plan.",
    space_ai_limit_reached:
      "This Space’s weekly hosted AI allowance is used. Its owner must upgrade their plan, or wait for the allowance to reset.",
  };
  if (reason && quotaMessages[reason]) return quotaMessages[reason];
  const messages: Record<string, string> = {
    not_authenticated:
      "Your Misty session is unavailable. Sign out, then sign in again before creating a Space.",
    forbidden: "You no longer have access to this Space.",
    not_found: "That Space item no longer exists.",
    space_limit_reached: "This account has reached its Space limit.",
    space_ownership_limit_reached:
      "You have reached your plan’s owned Space limit. Delete an owned Space permanently or upgrade your plan before creating another.",
    owner_storage_quota_exceeded:
      "This Space’s storage is full. Its owner must upgrade their plan, or someone must free Space capacity. Existing files remain available.",
    space_storage_quota_exceeded:
      "This Space’s storage is full. Its owner must upgrade their plan, or someone must free Space capacity. Existing files remain available.",
    storage_limit_reached:
      "Storage is full. Free capacity or review your personal and Space limits before trying again.",
    hosted_ai_limit_reached:
      "Weekly hosted AI is unavailable. Review your personal and Space allowances before trying again.",
    library_uploads_disabled: "Library uploads are temporarily unavailable.",
    library_media_processor_unavailable: "Edited media rendering is temporarily unavailable.",
    self_host_entitlement_required:
      "Your self-host entitlement needs verification. Open Connection settings or switch to Misty Hosted.",
    upload_verification_failed: "Misty could not verify the uploaded file.",
    dangerous_file_type: "This file type cannot be stored safely.",
    malware_detected: "This upload was rejected because it matched a malware signature.",
    space_node_limit_reached: "This Space has reached its 5,000-item limit.",
    version_conflict: "Someone else changed this item. Reload it before saving again.",
    library_reauthentication_required: "Unlock this protected Library collection again.",
    offline_reference_only: "Spaces are unavailable while Misty reconnects.",
    integration_required:
      "Connect the workflow’s required provider in this Space before running it.",
    agent_model_unavailable: "This Agent’s selected model is unavailable. Choose another model.",
    provider_not_configured:
      "This provider’s sign-in is not available on the current Misty server.",
    provider_exchange_failed: "The provider could not complete sign-in. Try connecting again.",
    provider_token_missing:
      "The provider completed sign-in without returning an access token. Try connecting again.",
    github_app_not_configured: "GitHub is not configured on this Misty server.",
    github_repository_permission_denied:
      "The GitHub App does not have permission to read that repository.",
    github_write_permission_denied: "The GitHub App does not have permission to make that change.",
    github_mutation_confirmation_required: "Confirm this GitHub change before continuing.",
    github_handoff_expired: "That one-time GitHub authorization expired. Try the action again.",
    github_api_error: "GitHub could not complete that request. Try again in a moment.",
    figma_api_error: "Figma could not complete that request. Try again in a moment.",
    figma_rate_limited: "Figma is receiving too many requests. Wait a moment, then try again.",
    figma_response_too_large:
      "That Figma file is too large to read safely. Link a smaller file or project source.",
    figma_comment_confirmation_required: "Review and confirm this Figma comment before posting.",
    figma_idempotency_key_required: "Review this Figma comment again before posting.",
    figma_comment_already_claimed:
      "That Figma comment was already submitted. Refresh the file context before trying again.",
    figma_discovery_unavailable:
      "Project browsing is unavailable for this Figma app. Paste a direct file link instead.",
    figma_webhook_setup_failed:
      "Figma live sync could not be started. Check the connected user’s Can edit access.",
    figma_sync_failed: "Figma context could not be refreshed. Try syncing again.",
    reauthentication_failed: "That password is incorrect.",
    invite_expired: "That invitation has expired.",
    invalid_request: "Misty could not validate that request.",
    internal_error: "Misty could not load this Space right now. Try again in a moment.",
  };
  return code && messages[code] ? messages[code] : fallback.trim() || "The Space request failed.";
}

function quotaReason(responseText: string): string | undefined {
  try {
    const value = JSON.parse(responseText) as { reason?: unknown };
    return typeof value.reason === "string" ? value.reason : undefined;
  } catch {
    return undefined;
  }
}

export const spacesApi = {
  snapshot: () => spaceRequest<SpacesSnapshot>("/spaces"),
  ...createSpacePlannerExpansionApi(spaceRequest),
  templates: () =>
    spaceRequest<{
      templates: SpaceTemplate[];
      providers?: ProviderConnectionAvailability[];
    }>("/space-templates"),
  create: createSpaceRequest,
  setup: (spaceId: string) =>
    spaceRequest<SpaceSetup>(`/spaces/${encodeURIComponent(spaceId)}/setup`),
  updateSetup: (spaceId: string, provider: string, status: string) =>
    spaceRequest<SpaceSetup>(`/spaces/${encodeURIComponent(spaceId)}/setup`, {
      method: "PATCH",
      body: JSON.stringify({ provider, status }),
    }),
  invitationPreview: (token: string) =>
    spaceRequest<SpaceInvitationPreview>(`/space-invitations/${encodeURIComponent(token)}`),
  redeemInvitation: (token: string) =>
    spaceRequest<Space>(`/space-invitations/${encodeURIComponent(token)}`, {
      method: "POST",
      body: JSON.stringify({ accept: true }),
    }),
  rename: (spaceId: string, name: string) =>
    spaceRequest<Space>(`/spaces/${encodeURIComponent(spaceId)}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  delete: (spaceId: string, confirmation: string) =>
    spaceRequest(`/spaces/${encodeURIComponent(spaceId)}`, {
      method: "DELETE",
      body: JSON.stringify({ confirmation }),
    }),
  ...createSpaceMembersApi(spaceRequest, fetchProtectedBlob),
  ...createSpaceAgentMembershipsApi(spaceRequest),
  ...createSpaceConversationsApi(spaceRequest),
  ...createSpaceActionSuggestionsApi(spaceRequest),
  ...createSpaceChatApi(spaceRequest),
  ...createSpaceTasksApi(spaceRequest),
  integrations: (spaceId: string) =>
    spaceRequest<{
      integrations: SpaceIntegration[];
      providers?: ProviderConnectionAvailability[];
    }>(`/spaces/${encodeURIComponent(spaceId)}/integrations`),
  beginProviderConnection: (spaceId: string, provider: string, returnTo: string) =>
    spaceRequest<ProviderAuthorizationStart>(
      `/spaces/${encodeURIComponent(spaceId)}/integrations/${encodeURIComponent(provider)}/authorize`,
      { method: "POST", body: JSON.stringify({ return_to: returnTo }) },
    ),
  bindAccountConnection: (
    spaceId: string,
    provider: string,
    connectionId: string,
    capability: "calendar_read" | "calendar_write",
  ) =>
    spaceRequest<{ integration: SpaceIntegration; connection_id: string; capability: string }>(
      `/spaces/${encodeURIComponent(spaceId)}/integrations/${encodeURIComponent(provider)}/bind`,
      {
        method: "POST",
        body: JSON.stringify({ connection_id: connectionId, capability }),
      },
    ),
  deleteProviderIntegration: (integrationId: string) =>
    spaceRequest<void>(`/integrations/${encodeURIComponent(integrationId)}`, {
      method: "DELETE",
    }),
  availableProviderResources: (spaceId: string, integrationId: string) =>
    spaceRequest<{ resources: AvailableProviderResource[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/integrations/${encodeURIComponent(integrationId)}/resources`,
    ),
  sharedProviderResources: (spaceId: string) =>
    spaceRequest<{ resources: ProviderSharedResource[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/provider-resources`,
    ),
  selectProviderResources: (
    spaceId: string,
    integrationId: string,
    resources: Array<Pick<AvailableProviderResource, "resource_type" | "external_resource_id">>,
  ) =>
    spaceRequest<{ resources: ProviderSharedResource[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/integrations/${encodeURIComponent(integrationId)}/resources`,
      { method: "PUT", body: JSON.stringify({ resources }) },
    ),
  nodes: (spaceId: string) =>
    spaceRequest<{ nodes: SpaceNode[] }>(`/spaces/${encodeURIComponent(spaceId)}/nodes`),
  resolve: (spaceId: string, nodeId: string, disposition: "open" | "download") =>
    spaceRequest<{ ticket: string; url: string; expires_in: number }>(
      `/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeId)}/resolve`,
      { method: "POST", body: JSON.stringify({ disposition }) },
    ),
  studio: (spaceId: string, kind: "agents" | "workflows") =>
    spaceRequest<{ resources: SpaceStudioResource[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/studio/${kind}`,
    ),
  saveStudio: (spaceId: string, kind: "agents" | "workflows", item: Partial<SpaceStudioResource>) =>
    spaceRequest<SpaceStudioResource>(`/spaces/${encodeURIComponent(spaceId)}/studio/${kind}`, {
      method: "POST",
      body: JSON.stringify(item),
    }),
  deleteStudio: (spaceId: string, kind: "agents" | "workflows", id: string) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/studio/${kind}/${encodeURIComponent(id)}`,
      { method: "DELETE" },
    ),
  runStudio: (
    spaceId: string,
    kind: "agents" | "workflows",
    id: string,
    prompt = "",
    capabilityId = "",
  ) =>
    spaceRequest<SpaceRun>(
      `/spaces/${encodeURIComponent(spaceId)}/studio/${kind}/${encodeURIComponent(id)}/runs`,
      {
        method: "POST",
        body: JSON.stringify({
          prompt,
          capability_id: capabilityId || undefined,
          input: { prompt },
        }),
      },
    ),
  realtimeTicket: (after: number) =>
    spaceRequest<{ ticket: string; expires_in: number }>("/realtime/tickets", {
      method: "POST",
      body: JSON.stringify({ after }),
      allowWhileReferenceOnly: true,
    }),
  ...createSpaceLibraryItemsApi(spaceRequest),
  ...createSpaceLibraryCollectionsApi(spaceRequest),
  ...createSpaceLibraryEditsApi(spaceRequest),
};
