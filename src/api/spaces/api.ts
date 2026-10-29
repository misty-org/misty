import {
  ApiRequestError,
  HttpRequestError,
  apiRequest,
  assertStableApiSession,
  resolveRequiredApiBase,
} from "@/api/client";
import { cachedRequest } from "@/api/cache/cached-request";
import {
  isSpaceReferenceOnly,
  isSpaceWriteRequest,
  setSpaceReferenceOnly,
} from "@/api/spaces/connectivity";
import { createSpaceConversationsApi } from "@/api/spaces/conversations";
import type {
  CreateSpaceRequest,
  CreateSpaceResult,
  Space,
  SpaceInvitationPreview,
  SpaceNode,
  SpacePerson,
  SpacesSnapshot,
} from "@/api/spaces/dto/entities";
import { createSpaceMembersApi } from "@/api/spaces/members";
import { createSpaceChatApi } from "./chat";
import { createSpaceLibraryEditsApi } from "./library-edits";
import { createSpaceLibraryItemsApi } from "./library-items";
import { fetchProtectedBlob } from "./protected-download";
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
  const {
    allowWhileReferenceOnly: _allowWhileReferenceOnly,
    onCached,
    ...requestInit
  } = init ?? {};
  try {
    return await (onCached
      ? cachedRequest<T>(path, { onCached: onCached as (value: T) => void, init: requestInit })
      : apiRequest<T>(path, requestInit));
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
      "Your personal storage is full. Free some of your contributions to add more. Existing files remain available.",
    space_storage_limit_reached:
      "Your cloud storage is full. Free some storage to add more. Existing files remain available.",
  };
  if (reason && quotaMessages[reason]) return quotaMessages[reason];
  const messages: Record<string, string> = {
    not_authenticated:
      "Your Misty session is unavailable. Sign out, then sign in again before creating a Space.",
    forbidden: "You no longer have access to this Space.",
    not_found: "That Space item no longer exists.",
    space_limit_reached: "This account has reached its Space limit.",
    space_ownership_limit_reached:
      "You have reached this server’s owned Space limit. Delete an owned Space permanently before creating another.",
    default_space_protected:
      "Your default Space can’t be deleted or transferred. It keeps your account usable.",
    owner_storage_quota_exceeded:
      "Your cloud storage is full. Free some storage to add more. Existing files remain available.",
    space_storage_quota_exceeded:
      "Your cloud storage is full. Free some storage to add more. Existing files remain available.",
    storage_limit_reached:
      "Your cloud storage is full. Free some storage to add more. Existing files remain available.",
    model_key_needed: "Add a model key in Settings → Models.",
    library_uploads_disabled: "Library uploads are temporarily unavailable.",
    library_media_processor_unavailable: "Edited media rendering is temporarily unavailable.",
    upload_verification_failed: "Misty could not verify the uploaded file.",
    dangerous_file_type: "This file type cannot be stored safely.",
    malware_detected: "This upload was rejected because it matched a malware signature.",
    space_node_limit_reached: "This Space has reached its 5,000-item limit.",
    version_conflict: "Someone else changed this item. Reload it before saving again.",
    offline_reference_only: "Spaces are unavailable while Misty reconnects.",
    agent_model_unavailable:
      "The model chosen in Settings › Models is unavailable. Choose another one there.",
    provider_not_configured:
      "This provider’s sign-in is not available on the current Misty server.",
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
  snapshot: (onCached?: (value: SpacesSnapshot) => void) =>
    spaceRequest<SpacesSnapshot>("/spaces", { onCached }),
  create: createSpaceRequest,
  /** People the person already shares a Space with. */
  people: () => spaceRequest<{ people: SpacePerson[] }>("/me/space-people"),
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
  ...createSpaceConversationsApi(spaceRequest),
  ...createSpaceChatApi(spaceRequest),
  nodes: (spaceId: string, onCached?: (value: { nodes: SpaceNode[] }) => void) =>
    spaceRequest<{ nodes: SpaceNode[] }>(`/spaces/${encodeURIComponent(spaceId)}/nodes`, {
      onCached,
    }),
  resolve: (spaceId: string, nodeId: string, disposition: "open" | "download") =>
    spaceRequest<{ ticket: string; url: string; expires_in: number }>(
      `/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeId)}/resolve`,
      { method: "POST", body: JSON.stringify({ disposition }) },
    ),
  realtimeTicket: (after: number) =>
    spaceRequest<{ ticket: string; expires_in: number }>("/realtime/tickets", {
      method: "POST",
      body: JSON.stringify({ after }),
      allowWhileReferenceOnly: true,
    }),
  ...createSpaceLibraryItemsApi(spaceRequest),
  ...createSpaceLibraryEditsApi(spaceRequest),
};
