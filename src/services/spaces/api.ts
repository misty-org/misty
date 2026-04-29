import { appSnapshot, normalizeApiBaseUrl, withDefaultApiPath } from "@/services/backend";
import { createSpaceActionSuggestionsApi } from "@/services/spaces/action-suggestions";
import { createSpaceAgentMembershipsApi } from "@/services/spaces/agent-memberships";
import {
  isSpaceReferenceOnly,
  isSpaceWriteRequest,
  setSpaceReferenceOnly,
} from "@/services/spaces/connectivity";
import { createSpaceConversationsApi } from "@/services/spaces/conversations";
import type {
  AvailableProviderResource,
  CreateSpaceRequest,
  CreateSpaceResult,
  ProviderAuthorizationStart,
  ProviderConnectionAvailability,
  ProviderSharedResource,
  Space,
  SpaceInboxItem,
  SpaceIntegration,
  SpaceInvitationPreview,
  SpaceNode,
  SpaceRun,
  SpaceSetup,
  SpacesSnapshot,
  SpaceStudioResource,
  SpaceTemplate,
} from "@/services/spaces/dto/interfaces/types";
import { createSpaceMembersApi } from "@/services/spaces/members";
import { createSpacePlannerExpansionApi } from "@/services/spaces/planner";
import { addRequestCorrelation } from "@/shared/platform/requestCorrelation";
import { createSpaceChatApi } from "./chat";
import type { GlobalSpaceLibraryHit } from "./dto/interfaces/search";
import { createSpaceLibraryCollectionsApi } from "./library-collections";
import { createSpaceLibraryEditsApi } from "./library-edits";
import { createSpaceLibraryItemsApi } from "./library-items";
import { fetchProtectedBlob } from "./library-upload";
import {
  isSpaceAccountSessionTransitioning,
  readSpaceAccountGeneration,
  readSpaceAccountToken,
} from "./session";
import { createSpaceTasksApi } from "./tasks";
import type { SpaceRequestInit } from "./types";

export class SpaceRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "SpaceRequestError";
  }
}

export async function resolveSpacesApiBase(): Promise<string> {
  const publicApiBase = normalizeApiBaseUrl(import.meta.env.VITE_MISTY_PUBLIC_API_URL);
  if (publicApiBase) return withDefaultApiPath(publicApiBase);
  const explicit = normalizeApiBaseUrl(import.meta.env.VITE_MISTY_SERVER_URL);
  const envBase = normalizeApiBaseUrl(import.meta.env.VITE_API_BASE);
  let native: string | null = null;
  try {
    native = normalizeApiBaseUrl((await appSnapshot()).environment.serverUrl);
  } catch {
    /* desktop service may not be ready */
  }
  const base =
    explicit ?? envBase ?? native ?? (import.meta.env.DEV ? "http://localhost:8080/api" : null);
  if (!base) throw new Error("Misty server URL is not configured.");
  return withDefaultApiPath(base);
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
  const accountGeneration = readSpaceAccountGeneration();
  assertStableSpaceAccount(accountGeneration);
  const [base, token] = await Promise.all([resolveSpacesApiBase(), readSpaceAccountToken()]);
  assertStableSpaceAccount(accountGeneration);
  const { allowWhileReferenceOnly: _allowWhileReferenceOnly, ...requestInit } = init ?? {};
  const headers = addRequestCorrelation(new Headers(requestInit.headers));
  if (requestInit.body && !headers.has("Content-Type"))
    headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { credentials: "include", ...requestInit, headers });
  } catch (error) {
    assertStableSpaceAccount(accountGeneration);
    setSpaceReferenceOnly(true);
    throw error;
  }
  assertStableSpaceAccount(accountGeneration);
  if (!response.ok) {
    const text = await response.text();
    assertStableSpaceAccount(accountGeneration);
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { code?: string }).code;
    } catch {
      /* plain-text response */
    }
    throw new SpaceRequestError(spaceErrorMessage(code, text), response.status, code);
  }
  if (response.status === 204) return undefined as T;
  const result = (await response.json()) as T;
  assertStableSpaceAccount(accountGeneration);
  return result;
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
  if (isSpaceAccountSessionTransitioning() || generation !== readSpaceAccountGeneration()) {
    throw new SpaceRequestError("Wait for the account switch to finish.", 409, "account_changed");
  }
}

export function spaceErrorMessage(code: string | undefined, fallback: string): string {
  const messages: Record<string, string> = {
    not_authenticated:
      "Your Misty session is unavailable. Sign out, then sign in again before creating a Space.",
    forbidden: "You no longer have access to this Space.",
    not_found: "That Space item no longer exists.",
    space_limit_reached: "This account has reached its Space limit.",
    space_ownership_limit_reached:
      "You already own three Spaces. Delete one permanently before creating another.",
    owner_storage_quota_exceeded:
      "This upload would exceed the Space owner’s shared storage pool. Existing files remain available.",
    space_storage_quota_exceeded:
      "This upload would exceed the Space owner’s shared storage pool. Existing files remain available.",
    library_uploads_disabled: "Library uploads are temporarily unavailable.",
    library_media_processor_unavailable: "Edited media rendering is temporarily unavailable.",
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
    reauthentication_failed: "That password is incorrect.",
    invite_expired: "That invitation has expired.",
    invalid_request: "Misty could not validate that request.",
    internal_error: "Misty could not load this Space right now. Try again in a moment.",
  };
  return code && messages[code] ? messages[code] : fallback.trim() || "The Space request failed.";
}

export const spacesApi = {
  globalSpaceLibrarySearch: (query: string, limit = 50) =>
    spaceRequest<{ hits: GlobalSpaceLibraryHit[]; semantic: boolean; request_id: string }>(
      `/search/spaces?q=${encodeURIComponent(query)}&limit=${limit}`,
    ),
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
  inbox: (tab: "unreads" | "mentions") =>
    spaceRequest<{ items: SpaceInboxItem[] }>(`/activity/inbox?tab=${tab}`),
  seen: () => spaceRequest("/activity/inbox/seen", { method: "POST" }),
  clearInbox: (tab: "unreads" | "mentions") =>
    spaceRequest("/activity/inbox/clear", { method: "POST", body: JSON.stringify({ tab }) }),
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
