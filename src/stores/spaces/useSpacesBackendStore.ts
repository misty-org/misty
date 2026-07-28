import type { RealtimeEnvelope } from "@/models/types/stores/spaces/useSpacesBackendStore";
export type { RealtimeEnvelope } from "@/models/types/stores/spaces/useSpacesBackendStore";
export type { SpacePresenceViewer } from "@/models/types/stores/spaces/useSpacesBackendStore";
import type { LibraryUploadOptions } from "@/models/interfaces/stores/spaces/useSpacesBackendStore";
export type { LibraryUploadOptions } from "@/models/interfaces/stores/spaces/useSpacesBackendStore";
import {
  isAccountSessionTransitioning,
  readAccountSessionGeneration,
  readAccountAuthToken,
} from "@/stores/account/useAuthTokenStore";
import { appSnapshot } from "@/stores/backend";
import { assertUploadLimit } from "@/features/library/uploadLimits";
import { readDownloadBlob } from "@/features/library/signedDownload";
import { safeTauriAssetUrl } from "@/platform/tauri";
import type { SpaceConversation, SpaceRun } from "@/models/interfaces/features/spaces/types";
import type {
  AgentMentionFailure,
  MessageSpan,
  BulkLibraryItemAction,
  LibraryEditDefinition,
  SpaceTaskPriority,
  SpaceTaskStatus,
} from "@/models/types/features/spaces/types";
import type {
  BulkLibraryItemOptions,
  LibraryUploadResult,
  LibraryAlbum,
  LibraryAlbumFolder,
  LibraryGroup,
  LibraryGroupRule,
  LibraryItemQuery,
  LibraryItemsResult,
  LibrarySearchFacets,
  LibraryDiscovery,
  LibrarySharedReference,
  LibraryIntelligencePolicy,
  LibraryPerson,
  LibraryEditResult,
  LibraryEditVersion,
  LibraryRenditionRequest,
  LibraryPinnedCollection,
  LibraryImportHistoryItem,
  LibraryAssetStack,
  Space,
  SpaceEvent,
  SpaceInboxItem,
  SpaceMember,
  SpaceMessage,
  SpaceLibraryItem,
  SpaceStorageUsage,
  SpaceNode,
  SpacesSnapshot,
  SpaceStudioResource,
  SpaceTask,
  SpaceTaskPage,
  SpaceTaskMoveResult,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  SpaceIntegration,
  ProviderAuthorizationStart,
  ProviderConnectionAvailability,
  AvailableProviderResource,
  ProviderSharedResource,
  CreateSpaceRequest,
  CreateSpaceResult,
  GoogleCalendarChoice,
  SpaceInvitation,
  SpaceInvitationPreview,
  SpaceSetup,
  SpaceTemplate,
} from "@/models/interfaces/features/spaces/types";
import type { GlobalSpaceLibraryHit } from "@/models/interfaces/features/agents/personal";
import type { TaskSchedule } from "@/models/interfaces/features/spaces/integrations/calendarTasks";
import type { ConflictResolution } from "@/models/types/features/spaces/integrations/calendarTasks";
import { normalizeApiBaseUrl, withDefaultApiPath } from "@/stores/backend";

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

export async function spaceRequest<T = void>(path: string, init?: RequestInit): Promise<T> {
  const accountGeneration = readAccountSessionGeneration();
  assertStableSpaceAccount(accountGeneration);
  const [base, token] = await Promise.all([resolveSpacesApiBase(), readAccountAuthToken()]);
  assertStableSpaceAccount(accountGeneration);
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { credentials: "include", ...init, headers });
  } catch (error) {
    assertStableSpaceAccount(accountGeneration);
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

function assertStableSpaceAccount(generation: number): void {
  if (isAccountSessionTransitioning() || generation !== readAccountSessionGeneration()) {
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
  members: (spaceId: string) =>
    spaceRequest<{ members: SpaceMember[] }>(`/spaces/${encodeURIComponent(spaceId)}/members`),
  memberAvatar: (spaceId: string, userId: string) =>
    fetchProtectedBlob(
      `/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}/avatar`,
    ),
  invite: (spaceId: string, email: string) =>
    spaceRequest<SpaceInvitation>(`/spaces/${encodeURIComponent(spaceId)}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  pendingInvitations: (spaceId: string) =>
    spaceRequest<{ invitations: SpaceInvitation[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/invitations`,
    ),
  resendInvitation: (spaceId: string, inviteId: string) =>
    spaceRequest<SpaceInvitation>(
      `/spaces/${encodeURIComponent(spaceId)}/invitations/${encodeURIComponent(inviteId)}/resend`,
      { method: "POST" },
    ),
  revokeInvitation: (spaceId: string, inviteId: string) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/invitations/${encodeURIComponent(inviteId)}`,
      { method: "DELETE" },
    ),
  respondInvite: (inviteId: string, accept: boolean) =>
    spaceRequest(
      `/spaces/invitations/${encodeURIComponent(inviteId)}/${accept ? "accept" : "decline"}`,
      { method: "POST" },
    ),
  removeMember: (spaceId: string, userId: string) =>
    spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    }),
  leave: (spaceId: string) =>
    spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/leave`, { method: "POST" }),
  transfer: (spaceId: string, userId: string) =>
    spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/transfer`, {
      method: "POST",
      body: JSON.stringify({ user_id: userId }),
    }),
  messages: (spaceId: string, before = 0) =>
    spaceRequest<{ messages: SpaceMessage[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/messages?before=${before}&limit=50`,
    ),
  conversations: (spaceId: string) =>
    spaceRequest<{ conversations: SpaceConversation[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/conversations`,
    ),
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
  createConversation: (spaceId: string, title: string, memberIds: string[]) =>
    spaceRequest<SpaceConversation>(`/spaces/${encodeURIComponent(spaceId)}/conversations`, {
      method: "POST",
      body: JSON.stringify({ title, member_ids: memberIds }),
    }),
  updateConversation: (
    spaceId: string,
    conversationId: string,
    title: string,
    memberIds: string[],
  ) =>
    spaceRequest<SpaceConversation>(
      `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}`,
      { method: "PATCH", body: JSON.stringify({ title, member_ids: memberIds }) },
    ),
  deleteDisconnectedConversation: (spaceId: string, conversationId: string) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}`,
      { method: "DELETE" },
    ),
  conversationMessages: (spaceId: string, conversationId: string, before = 0) =>
    spaceRequest<{ messages: SpaceMessage[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages?before=${before}&limit=50`,
    ),
  sendConversationMessage: (
    spaceId: string,
    conversationId: string,
    content: MessageSpan[],
    fileNodeIds: string[] = [],
    attachmentIds: string[] = [],
    libraryItemIds: string[] = [],
    replyToMessageId = "",
  ) =>
    spaceRequest<{
      message: SpaceMessage;
      agent_replies: SpaceMessage[];
      agent_failures?: AgentMentionFailure[];
    }>(
      `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
      {
        method: "POST",
        body: JSON.stringify({
          content,
          file_node_ids: fileNodeIds,
          attachment_ids: attachmentIds,
          library_item_ids: libraryItemIds,
          reply_to_message_id: replyToMessageId,
        }),
      },
    ),
  updateConversationMessage: (
    spaceId: string,
    conversationId: string,
    messageId: string,
    content: MessageSpan[],
    fileNodeIds: string[] = [],
  ) =>
    spaceRequest<SpaceMessage>(
      `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PUT", body: JSON.stringify({ content, file_node_ids: fileNodeIds }) },
    ),
  deleteConversationMessage: (spaceId: string, conversationId: string, messageId: string) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
    ),
  addConversationMessageReaction: (
    spaceId: string,
    conversationId: string,
    messageId: string,
    emoji: string,
  ) =>
    spaceRequest<SpaceMessage>(
      `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
      { method: "PUT" },
    ),
  removeConversationMessageReaction: (
    spaceId: string,
    conversationId: string,
    messageId: string,
    emoji: string,
  ) =>
    spaceRequest<SpaceMessage>(
      `/spaces/${encodeURIComponent(spaceId)}/conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
      { method: "DELETE" },
    ),
  chatAgents: (spaceId: string) =>
    spaceRequest<{ agents: SpaceStudioResource[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/chat/agents`,
    ),
  tasks: (
    spaceId: string,
    filters: {
      status?: SpaceTaskStatus;
      assigneeUserId?: string;
      priority?: SpaceTaskPriority;
      search?: string;
      dueFrom?: string;
      dueTo?: string;
      sort?: "rank" | "due" | "updated";
      cursor?: string;
      limit?: number;
      includeArchived?: boolean;
    } = {},
  ) => {
    const query = new URLSearchParams();
    if (filters.status) query.set("status", filters.status);
    if (filters.assigneeUserId) query.set("assignee_user_id", filters.assigneeUserId);
    if (filters.priority) query.set("priority", filters.priority);
    if (filters.search) query.set("q", filters.search);
    if (filters.dueFrom) query.set("due_from", filters.dueFrom);
    if (filters.dueTo) query.set("due_to", filters.dueTo);
    if (filters.sort) query.set("sort", filters.sort);
    if (filters.cursor) query.set("cursor", filters.cursor);
    if (filters.limit) query.set("limit", String(filters.limit));
    if (filters.includeArchived) query.set("include_archived", "true");
    return spaceRequest<SpaceTaskPage>(
      `/spaces/${encodeURIComponent(spaceId)}/tasks${query.size ? `?${query}` : ""}`,
    );
  },
  createTask: (
    spaceId: string,
    task: Pick<SpaceTask, "title" | "notes" | "status" | "priority" | "due_timezone"> &
      Partial<Pick<SpaceTask, "assignee_user_id" | "due_at" | "source_refs">>,
  ) =>
    spaceRequest<SpaceTask>(`/spaces/${encodeURIComponent(spaceId)}/tasks`, {
      method: "POST",
      body: JSON.stringify(task),
    }),
  updateTask: (
    spaceId: string,
    task: SpaceTask,
    patch: Partial<
      Pick<
        SpaceTask,
        | "title"
        | "notes"
        | "status"
        | "priority"
        | "assignee_user_id"
        | "due_at"
        | "due_timezone"
        | "source_refs"
      >
    >,
  ) =>
    spaceRequest<SpaceTask>(
      `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(task.id)}`,
      { method: "PATCH", body: JSON.stringify({ ...task, ...patch }) },
    ),
  moveTask: (spaceId: string, task: SpaceTask, status: SpaceTaskStatus, beforeTaskId?: string) =>
    spaceRequest<SpaceTaskMoveResult>(
      `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(task.id)}/move`,
      {
        method: "POST",
        body: JSON.stringify({
          version: task.version,
          status,
          before_task_id: beforeTaskId || undefined,
        }),
      },
    ),
  archiveTask: (spaceId: string, task: SpaceTask) =>
    spaceRequest<SpaceTask>(
      `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(task.id)}?version=${task.version}`,
      { method: "DELETE" },
    ),
  /**
   * Creates a task bound to a Google calendar. `publish: false` keeps it a local
   * draft; `true` creates the Google event immediately. Either way the write is
   * something the user asked for, never an implicit consequence of typing.
   */
  createCalendarTask: (
    spaceId: string,
    input: {
      title: string;
      notes: string;
      status: SpaceTaskStatus;
      priority: SpaceTaskPriority;
      calendar_source_id: string;
      schedule: TaskSchedule;
      publish: boolean;
      assignee_user_id?: string;
    },
  ) =>
    spaceRequest<SpaceTask>(`/spaces/${encodeURIComponent(spaceId)}/tasks/calendar`, {
      method: "POST",
      body: JSON.stringify(input),
    }),

  /** Pushes a task's local schedule edits to Google. */
  publishTaskToCalendar: (spaceId: string, task: SpaceTask) =>
    spaceRequest<SpaceTask>(
      `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(task.id)}/calendar/publish`,
      { method: "POST", body: JSON.stringify({ version: task.version }) },
    ),

  /**
   * Resolves a conflict explicitly. Misty holds both versions until the user
   * chooses, so neither side is lost to a background sync.
   */
  resolveTaskCalendarConflict: (spaceId: string, task: SpaceTask, resolution: ConflictResolution) =>
    spaceRequest<SpaceTask>(
      `/spaces/${encodeURIComponent(spaceId)}/tasks/${encodeURIComponent(task.id)}/calendar/resolve`,
      { method: "POST", body: JSON.stringify({ version: task.version, resolution }) },
    ),

  /**
   * Pulls Google changes into Misty's tasks. The server uses Calendar's sync
   * token when it has one and falls back to a time-window poll when it does not.
   */
  syncCalendarTasks: (spaceId: string, sourceId?: string) =>
    spaceRequest<{ tasks: SpaceTask[]; synced_at: string; sources: SpaceCalendarSource[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/calendar/sync`,
      { method: "POST", body: JSON.stringify({ source_id: sourceId }) },
    ),

  calendarEvents: (spaceId: string, from: string, to: string) =>
    spaceRequest<{ events: SpaceCalendarEvent[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/calendar/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    ),
  calendarSources: (spaceId: string) =>
    spaceRequest<{ sources: SpaceCalendarSource[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/calendar/sources`,
    ),
  googleCalendars: (spaceId: string, integrationId: string) =>
    spaceRequest<{ calendars: GoogleCalendarChoice[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/calendar/google/calendars?integration_id=${encodeURIComponent(integrationId)}`,
    ),
  publishGoogleCalendar: (spaceId: string, integrationId: string, calendar: GoogleCalendarChoice) =>
    spaceRequest<SpaceCalendarSource>(`/spaces/${encodeURIComponent(spaceId)}/calendar/sources`, {
      method: "POST",
      body: JSON.stringify({
        integration_id: integrationId,
        external_calendar_id: calendar.id,
        display_name: calendar.summary,
        timezone: calendar.timeZone || "UTC",
      }),
    }),
  disableCalendarSource: (spaceId: string, sourceId: string) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/calendar/sources/${encodeURIComponent(sourceId)}`,
      { method: "DELETE" },
    ),
  sendMessage: (
    spaceId: string,
    content: MessageSpan[],
    fileNodeIds: string[] = [],
    attachmentIds: string[] = [],
    libraryItemIds: string[] = [],
    replyToMessageId = "",
  ) =>
    spaceRequest<{
      message: SpaceMessage;
      agent_replies: SpaceMessage[];
      agent_failures?: AgentMentionFailure[];
    }>(`/spaces/${encodeURIComponent(spaceId)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        content,
        file_node_ids: fileNodeIds,
        attachment_ids: attachmentIds,
        library_item_ids: libraryItemIds,
        reply_to_message_id: replyToMessageId,
      }),
    }),
  updateMessage: (
    spaceId: string,
    messageId: string,
    content: MessageSpan[],
    fileNodeIds: string[] = [],
  ) =>
    spaceRequest<SpaceMessage>(
      `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "PUT", body: JSON.stringify({ content, file_node_ids: fileNodeIds }) },
    ),
  deleteMessage: (spaceId: string, messageId: string) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}`,
      { method: "DELETE" },
    ),
  addMessageReaction: (spaceId: string, messageId: string, emoji: string) =>
    spaceRequest<SpaceMessage>(
      `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
      { method: "PUT" },
    ),
  removeMessageReaction: (spaceId: string, messageId: string, emoji: string) =>
    spaceRequest<SpaceMessage>(
      `/spaces/${encodeURIComponent(spaceId)}/messages/${encodeURIComponent(messageId)}/reactions/${encodeURIComponent(emoji)}`,
      { method: "DELETE" },
    ),
  markRead: (spaceId: string, seq: number) =>
    spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/read`, {
      method: "POST",
      body: JSON.stringify({ seq }),
    }),
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
    }),
  libraryItems: (spaceId: string, query: LibraryItemQuery = {}, reauthenticationToken = "") => {
    const values = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== "" && value !== false) values.set(key, String(value));
    }
    const suffix = values.size > 0 ? `?${values.toString()}` : "";
    return spaceRequest<LibraryItemsResult>(
      `/spaces/${encodeURIComponent(spaceId)}/library${suffix}`,
      { headers: libraryReauthenticationHeaders(reauthenticationToken) },
    );
  },
  reauthenticateLibrary: (
    spaceId: string,
    scope: "hidden" | "recently_deleted",
    password: string,
  ) =>
    spaceRequest<{ token: string; scope: string; expires_at: string }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/reauthenticate`,
      { method: "POST", body: JSON.stringify({ scope, password }) },
    ),
  libraryFacets: (spaceId: string, query = "") =>
    spaceRequest<LibrarySearchFacets>(
      `/spaces/${encodeURIComponent(spaceId)}/library/facets${query ? `?q=${encodeURIComponent(query)}` : ""}`,
    ),
  semanticLibrarySearch: (spaceId: string, query: string) =>
    spaceRequest<LibraryItemsResult & { semantic: boolean }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/search/semantic?q=${encodeURIComponent(query)}`,
    ),
  libraryDiscovery: (spaceId: string) =>
    spaceRequest<LibraryDiscovery>(`/spaces/${encodeURIComponent(spaceId)}/library/discovery`),
  libraryPins: (spaceId: string) =>
    spaceRequest<{ pins: LibraryPinnedCollection[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/pins`,
    ),
  setLibraryPins: (
    spaceId: string,
    targets: Array<{ kind: LibraryPinnedCollection["target_kind"]; id: string }>,
  ) =>
    spaceRequest<{ pins: LibraryPinnedCollection[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/pins`,
      { method: "PUT", body: JSON.stringify({ targets }) },
    ),
  libraryImportHistory: (spaceId: string) =>
    spaceRequest<{ imports: LibraryImportHistoryItem[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/imports/history`,
    ),
  discoveryItems: (
    spaceId: string,
    kind: "day" | "month" | "year" | "memory" | "trip" | "duplicate" | "map",
    groupId: string,
  ) =>
    spaceRequest<LibraryItemsResult>(
      `/spaces/${encodeURIComponent(spaceId)}/library/discovery/${kind}/${encodeURIComponent(groupId)}/items`,
    ),
  updateMemoryPreference: (
    spaceId: string,
    memory: LibraryDiscovery["memories"][number],
    patch: {
      title?: string;
      cover_item_id?: string;
      music_item_id?: string;
      playback_seconds?: number;
    },
  ) =>
    spaceRequest<LibraryDiscovery["memories"][number]>(
      `/spaces/${encodeURIComponent(spaceId)}/library/discovery/memory/${encodeURIComponent(memory.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          version: memory.preference_version ?? 0,
          title: patch.title ?? memory.title,
          cover_item_id: patch.cover_item_id ?? memory.cover_item_id ?? "",
          music_item_id: patch.music_item_id ?? memory.music_item_id ?? "",
          playback_seconds: patch.playback_seconds ?? memory.playback_seconds ?? 4.5,
        }),
      },
    ),
  mergeDuplicates: (spaceId: string, keeper: SpaceLibraryItem, duplicates: SpaceLibraryItem[]) =>
    spaceRequest<SpaceLibraryItem>(
      `/spaces/${encodeURIComponent(spaceId)}/library/duplicates/merge`,
      {
        method: "POST",
        body: JSON.stringify({
          keeper: { id: keeper.id, version: keeper.version },
          duplicates: duplicates.map((item) => ({ id: item.id, version: item.version })),
        }),
      },
    ),
  bulkLibraryItems: (
    spaceId: string,
    items: SpaceLibraryItem[],
    action: BulkLibraryItemAction,
    options: BulkLibraryItemOptions = {},
    reauthenticationToken = "",
  ) =>
    spaceRequest<LibraryItemsResult>(`/spaces/${encodeURIComponent(spaceId)}/library/items/bulk`, {
      method: "POST",
      headers: libraryReauthenticationHeaders(reauthenticationToken),
      body: JSON.stringify({
        action,
        album_id: options.albumId ?? "",
        tags: options.tags,
        date_override: options.dateOverride,
        location_override: options.locationOverride,
        items: items.map((item) => ({ id: item.id, version: item.version })),
      }),
    }),
  duplicateLibraryItems: (spaceId: string, itemIds: string[], reauthenticationToken = "") =>
    spaceRequest<LibraryItemsResult>(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/duplicate`,
      {
        method: "POST",
        headers: libraryReauthenticationHeaders(reauthenticationToken),
        body: JSON.stringify({ item_ids: itemIds }),
      },
    ),
  libraryUsage: (spaceId: string) =>
    spaceRequest<SpaceStorageUsage>(`/spaces/${encodeURIComponent(spaceId)}/library/usage`),
  libraryAssetStacks: (spaceId: string) =>
    spaceRequest<{ stacks: LibraryAssetStack[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks`,
    ),
  createLibraryAssetStack: (
    spaceId: string,
    input: Pick<
      LibraryAssetStack,
      "kind" | "title" | "cover_item_id" | "motion_item_id" | "members"
    >,
    reauthenticationToken = "",
  ) =>
    spaceRequest<LibraryAssetStack>(`/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks`, {
      method: "POST",
      headers: libraryReauthenticationHeaders(reauthenticationToken),
      body: JSON.stringify(input),
    }),
  updateLibraryAssetStack: (
    spaceId: string,
    stack: LibraryAssetStack,
    patch: Partial<Pick<LibraryAssetStack, "title" | "cover_item_id" | "effect">>,
    reauthenticationToken = "",
  ) =>
    spaceRequest<LibraryAssetStack>(
      `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks/${encodeURIComponent(stack.id)}`,
      {
        method: "PATCH",
        headers: libraryReauthenticationHeaders(reauthenticationToken),
        body: JSON.stringify({
          version: stack.version,
          title: patch.title ?? stack.title,
          cover_item_id: patch.cover_item_id ?? stack.cover_item_id,
          effect: patch.effect ?? stack.effect ?? "still",
        }),
      },
    ),
  deleteLibraryAssetStack: (
    spaceId: string,
    stack: LibraryAssetStack,
    reauthenticationToken = "",
  ) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/library/asset-stacks/${encodeURIComponent(stack.id)}?version=${stack.version}`,
      { method: "DELETE", headers: libraryReauthenticationHeaders(reauthenticationToken) },
    ),
  updateLibraryItem: (
    spaceId: string,
    item: SpaceLibraryItem,
    patch: Partial<
      Pick<SpaceLibraryItem, "display_name" | "caption" | "tags" | "favorite" | "hidden">
    >,
    reauthenticationToken = "",
  ) =>
    spaceRequest<SpaceLibraryItem>(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}`,
      {
        method: "PATCH",
        headers: libraryReauthenticationHeaders(reauthenticationToken),
        body: JSON.stringify({
          version: item.version,
          display_name: patch.display_name ?? item.display_name,
          caption: patch.caption ?? item.caption,
          tags: patch.tags ?? item.tags,
          favorite: patch.favorite ?? item.favorite,
          hidden: patch.hidden ?? item.hidden,
        }),
      },
    ),
  trashLibraryItem: (spaceId: string, itemId: string, reauthenticationToken = "") =>
    spaceRequest<SpaceLibraryItem>(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/trash`,
      { method: "POST", headers: libraryReauthenticationHeaders(reauthenticationToken) },
    ),
  restoreLibraryItem: (spaceId: string, itemId: string, reauthenticationToken = "") =>
    spaceRequest<SpaceLibraryItem>(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/restore`,
      { method: "POST", headers: libraryReauthenticationHeaders(reauthenticationToken) },
    ),
  uploadLibraryPath: (
    spaceId: string,
    path: string,
    purpose: "library" | "attachment",
    options?: LibraryUploadOptions,
  ) => uploadLibraryPath(spaceId, path, purpose, options),
  uploadLibraryBlob: (
    spaceId: string,
    blob: Blob,
    filename: string,
    purpose: "library" | "attachment" = "library",
    options?: LibraryUploadOptions,
  ) => uploadLibraryBlob(spaceId, blob, filename, purpose, options),
  replaceLibraryItemContent: (
    spaceId: string,
    item: SpaceLibraryItem,
    blob: Blob,
    filename: string,
    options?: LibraryUploadOptions,
  ) => replaceLibraryItemContent(spaceId, item, blob, filename, options),
  promoteAttachment: (spaceId: string, attachmentId: string) =>
    spaceRequest<SpaceLibraryItem>(
      `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/promote`,
      { method: "POST" },
    ),
  sharedReferences: (spaceId: string) =>
    spaceRequest<{ references: LibrarySharedReference[]; outgoing: LibrarySharedReference[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/shared`,
    ),
  sharedReferenceContent: (spaceId: string, referenceId: string) =>
    fetchProtectedBlob(
      `/spaces/${encodeURIComponent(spaceId)}/library/shared/${encodeURIComponent(referenceId)}/download`,
    ),
  revokeLibraryGrant: (spaceId: string, grant: LibrarySharedReference) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/library/grants/${encodeURIComponent(grant.grant_id)}?version=${grant.version}`,
      { method: "DELETE" },
    ),
  libraryContent: (spaceId: string, itemId: string, reauthenticationToken = "") =>
    fetchProtectedBlob(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/download`,
      { headers: libraryReauthenticationHeaders(reauthenticationToken) },
    ),
  libraryOriginalContent: (spaceId: string, itemId: string, reauthenticationToken = "") =>
    fetchProtectedBlob(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/download?version=original`,
      { headers: libraryReauthenticationHeaders(reauthenticationToken) },
    ),
  libraryPreview: (
    spaceId: string,
    itemId: string,
    reauthenticationToken = "",
    cacheVersion?: string | number,
  ) =>
    fetchProtectedBlob(libraryPreviewPath(spaceId, itemId, false, cacheVersion), {
      headers: libraryReauthenticationHeaders(reauthenticationToken),
    }),
  libraryOriginalPreview: (
    spaceId: string,
    itemId: string,
    reauthenticationToken = "",
    cacheVersion?: string | number,
  ) =>
    fetchProtectedBlob(libraryPreviewPath(spaceId, itemId, true, cacheVersion), {
      headers: libraryReauthenticationHeaders(reauthenticationToken),
    }),
  downloadAttachment: (spaceId: string, attachmentId: string, filename: string) =>
    downloadProtectedFile(
      `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/download`,
      filename,
    ),
  albums: (spaceId: string) =>
    spaceRequest<{ albums: LibraryAlbum[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/albums`,
    ),
  albumFolders: (spaceId: string) =>
    spaceRequest<{ folders: LibraryAlbumFolder[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/album-folders`,
    ),
  createAlbumFolder: (spaceId: string, name: string, parentFolderId = "") =>
    spaceRequest<LibraryAlbumFolder>(
      `/spaces/${encodeURIComponent(spaceId)}/library/album-folders`,
      { method: "POST", body: JSON.stringify({ name, parent_folder_id: parentFolderId }) },
    ),
  updateAlbumFolder: (
    spaceId: string,
    folder: LibraryAlbumFolder,
    patch: Partial<Pick<LibraryAlbumFolder, "name" | "parent_folder_id" | "position">>,
  ) =>
    spaceRequest<LibraryAlbumFolder>(
      `/spaces/${encodeURIComponent(spaceId)}/library/album-folders/${encodeURIComponent(folder.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          version: folder.version,
          name: patch.name ?? folder.name,
          parent_folder_id: patch.parent_folder_id ?? folder.parent_folder_id ?? "",
          position: patch.position ?? folder.position,
        }),
      },
    ),
  deleteAlbumFolder: (spaceId: string, folder: LibraryAlbumFolder) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/library/album-folders/${encodeURIComponent(folder.id)}?version=${folder.version}`,
      { method: "DELETE" },
    ),
  createAlbum: (spaceId: string, name: string, description = "") =>
    spaceRequest<LibraryAlbum>(`/spaces/${encodeURIComponent(spaceId)}/library/albums`, {
      method: "POST",
      body: JSON.stringify({ name, description }),
    }),
  organizeAlbum: (
    spaceId: string,
    album: LibraryAlbum,
    patch: Partial<Pick<LibraryAlbum, "folder_id" | "view_mode" | "sort_mode" | "position">>,
  ) =>
    spaceRequest<LibraryAlbum>(
      `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(album.id)}/organization`,
      {
        method: "PUT",
        body: JSON.stringify({
          version: album.version,
          folder_id: patch.folder_id ?? album.folder_id ?? "",
          view_mode: patch.view_mode ?? album.view_mode,
          sort_mode: patch.sort_mode ?? album.sort_mode,
          position: patch.position ?? album.position,
        }),
      },
    ),
  updateAlbum: (
    spaceId: string,
    album: LibraryAlbum,
    patch: Partial<Pick<LibraryAlbum, "name" | "description" | "cover_item_id">>,
  ) =>
    spaceRequest<LibraryAlbum>(
      `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(album.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          version: album.version,
          name: patch.name ?? album.name,
          description: patch.description ?? album.description,
          cover_item_id: patch.cover_item_id ?? album.cover_item_id ?? "",
        }),
      },
    ),
  deleteAlbum: (spaceId: string, album: LibraryAlbum) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(album.id)}?version=${album.version}`,
      { method: "DELETE" },
    ),
  albumItems: (spaceId: string, albumId: string) =>
    spaceRequest<{ items: SpaceLibraryItem[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(albumId)}/items`,
    ),
  addAlbumItems: (spaceId: string, albumId: string, itemIds: string[]) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(albumId)}/items`,
      { method: "POST", body: JSON.stringify({ item_ids: itemIds }) },
    ),
  reorderAlbumItems: (spaceId: string, album: LibraryAlbum, itemIds: string[]) =>
    spaceRequest<LibraryAlbum>(
      `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(album.id)}/order`,
      { method: "POST", body: JSON.stringify({ version: album.version, item_ids: itemIds }) },
    ),
  groups: (spaceId: string) =>
    spaceRequest<{ groups: LibraryGroup[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/groups`,
    ),
  createGroup: (spaceId: string, name: string, rules: LibraryGroupRule[]) =>
    spaceRequest<LibraryGroup>(`/spaces/${encodeURIComponent(spaceId)}/library/groups`, {
      method: "POST",
      body: JSON.stringify({ name, rules: { all: rules } }),
    }),
  groupItems: (spaceId: string, groupId: string) =>
    spaceRequest<{ items: SpaceLibraryItem[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/groups/${encodeURIComponent(groupId)}/items`,
    ),
  peoplePolicy: (spaceId: string) =>
    spaceRequest<LibraryIntelligencePolicy>(
      `/spaces/${encodeURIComponent(spaceId)}/library/people/policy`,
    ),
  updatePeoplePolicy: (
    spaceId: string,
    policy: LibraryIntelligencePolicy,
    patch: Partial<
      Pick<
        LibraryIntelligencePolicy,
        "faces_enabled" | "pets_enabled" | "ai_enabled" | "semantic_search_enabled"
      >
    >,
  ) =>
    spaceRequest<LibraryIntelligencePolicy>(
      `/spaces/${encodeURIComponent(spaceId)}/library/people/policy`,
      {
        method: "PATCH",
        body: JSON.stringify({
          version: policy.version,
          faces_enabled: patch.faces_enabled ?? policy.faces_enabled,
          pets_enabled: patch.pets_enabled ?? policy.pets_enabled,
          ai_enabled: patch.ai_enabled ?? policy.ai_enabled,
          semantic_search_enabled: patch.semantic_search_enabled ?? policy.semantic_search_enabled,
        }),
      },
    ),
  people: (spaceId: string) =>
    spaceRequest<{ people: LibraryPerson[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/people`,
    ),
  createPerson: (spaceId: string, kind: "person" | "pet", name: string, itemIds: string[] = []) =>
    spaceRequest<LibraryPerson>(`/spaces/${encodeURIComponent(spaceId)}/library/people`, {
      method: "POST",
      body: JSON.stringify({ kind, name, item_ids: itemIds }),
    }),
  updatePerson: (
    spaceId: string,
    person: LibraryPerson,
    patch: Partial<Pick<LibraryPerson, "name" | "cover_item_id">>,
  ) =>
    spaceRequest<LibraryPerson>(
      `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(person.id)}`,
      {
        method: "PATCH",
        body: JSON.stringify({
          version: person.version,
          name: patch.name ?? person.name,
          cover_item_id: patch.cover_item_id ?? person.cover_item_id ?? "",
        }),
      },
    ),
  deletePerson: (spaceId: string, person: LibraryPerson) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(person.id)}?version=${person.version}`,
      { method: "DELETE" },
    ),
  personItems: (spaceId: string, personId: string) =>
    spaceRequest<{ items: SpaceLibraryItem[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(personId)}/items`,
    ),
  addPersonItems: (spaceId: string, personId: string, itemIds: string[]) =>
    spaceRequest<LibraryPerson>(
      `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(personId)}/items`,
      { method: "POST", body: JSON.stringify({ item_ids: itemIds }) },
    ),
  removePersonItems: (spaceId: string, personId: string, itemIds: string[]) =>
    spaceRequest<LibraryPerson>(
      `/spaces/${encodeURIComponent(spaceId)}/library/people/${encodeURIComponent(personId)}/items`,
      { method: "DELETE", body: JSON.stringify({ item_ids: itemIds }) },
    ),
  mergePeople: (spaceId: string, source: LibraryPerson, target: LibraryPerson) =>
    spaceRequest<LibraryPerson>(`/spaces/${encodeURIComponent(spaceId)}/library/people/merge`, {
      method: "POST",
      body: JSON.stringify({
        source_id: source.id,
        target_id: target.id,
        source_version: source.version,
        target_version: target.version,
      }),
    }),
  editVersions: (spaceId: string, itemId: string, reauthenticationToken = "") =>
    spaceRequest<{ versions: LibraryEditVersion[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions`,
      { headers: libraryReauthenticationHeaders(reauthenticationToken) },
    ),
  createEditVersion: (
    spaceId: string,
    item: SpaceLibraryItem,
    definition: LibraryEditDefinition,
    reauthenticationToken = "",
  ) =>
    spaceRequest<LibraryEditResult>(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}/versions`,
      {
        method: "POST",
        headers: libraryReauthenticationHeaders(reauthenticationToken),
        body: JSON.stringify({ item_version: item.version, edit_definition: definition }),
      },
    ),
  renderEditVersion: (
    spaceId: string,
    itemId: string,
    editId: string,
    maximumOutputBytes = 0,
    reauthenticationToken = "",
  ) =>
    spaceRequest<LibraryRenditionRequest>(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(editId)}/render`,
      {
        method: "POST",
        headers: libraryReauthenticationHeaders(reauthenticationToken),
        body: JSON.stringify({ maximum_output_bytes: maximumOutputBytes }),
      },
    ),
  selectEditVersion: (
    spaceId: string,
    item: SpaceLibraryItem,
    editId = "",
    reauthenticationToken = "",
  ) =>
    spaceRequest<LibraryEditResult>(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(item.id)}/versions/current`,
      {
        method: "PUT",
        headers: libraryReauthenticationHeaders(reauthenticationToken),
        body: JSON.stringify({ item_version: item.version, edit_id: editId }),
      },
    ),
  deleteEditVersion: (
    spaceId: string,
    itemId: string,
    editId: string,
    reauthenticationToken = "",
  ) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/versions/${encodeURIComponent(editId)}`,
      { method: "DELETE", headers: libraryReauthenticationHeaders(reauthenticationToken) },
    ),
};

async function uploadLibraryPath(
  spaceId: string,
  path: string,
  purpose: "library" | "attachment",
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  const accountGeneration = readAccountSessionGeneration();
  assertStableSpaceAccount(accountGeneration);
  options?.onStage?.("reading");
  const response = await fetch(safeTauriAssetUrl(path), { signal: options?.signal });
  assertStableSpaceAccount(accountGeneration);
  if (!response.ok) throw new Error(`Misty could not read ${fileNameFromPath(path)}.`);
  const declaredSize = Number(response.headers.get("content-length") ?? 0);
  if (declaredSize > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const blob = await response.blob();
  assertStableSpaceAccount(accountGeneration);
  if (blob.size > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const file = new File([blob], fileNameFromPath(path), {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
  return uploadLibraryFile(spaceId, file, purpose, accountGeneration, options);
}

/** Uploads a client-produced Blob as a NEW library item (used for "Save as a copy"). */
async function uploadLibraryBlob(
  spaceId: string,
  blob: Blob,
  filename: string,
  purpose: "library" | "attachment" = "library",
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  const accountGeneration = readAccountSessionGeneration();
  assertStableSpaceAccount(accountGeneration);
  if (blob.size > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
  return uploadLibraryFile(spaceId, file, purpose, accountGeneration, options);
}

/**
 * Replaces an existing library item's content in place with a client-rendered
 * Blob, keeping the same item id (used for "Save"). Item identity is owned by
 * the server; if it doesn't honor `replace_item_id` and mints a new id instead,
 * we trash the stray upload and throw so the caller can fall back to a copy.
 */
async function replaceLibraryItemContent(
  spaceId: string,
  item: SpaceLibraryItem,
  blob: Blob,
  filename: string,
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  const accountGeneration = readAccountSessionGeneration();
  assertStableSpaceAccount(accountGeneration);
  if (blob.size > maxWebviewUploadBytes) throw webviewUploadSizeError();
  const file = new File([blob], filename, {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
  const result = await uploadLibraryFile(spaceId, file, "library", accountGeneration, options, {
    itemId: item.id,
    itemVersion: item.version,
  });
  if (result.item && result.item.id !== item.id) {
    try {
      await spaceRequest(
        `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(result.item.id)}/trash`,
        { method: "POST" },
      );
    } catch {
      // Best-effort cleanup of the stray item; ignore failures.
    }
    throw new Error(
      'Saving over the original isn’t supported by this server yet — use "Save as a copy" instead.',
    );
  }
  return result;
}

export function fileNameFromPath(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || "file"
  );
}

async function uploadLibraryFile(
  spaceId: string,
  file: File,
  purpose: "library" | "attachment",
  accountGeneration: number,
  options?: LibraryUploadOptions,
  replace?: { itemId: string; itemVersion: number },
): Promise<LibraryUploadResult> {
  assertStableSpaceAccount(accountGeneration);
  assertUploadLimit(purpose, file.size);
  options?.onStage?.("hashing");
  const bytes = await file.arrayBuffer();
  assertStableSpaceAccount(accountGeneration);
  const sha256 = toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)));
  assertStableSpaceAccount(accountGeneration);
  const initiated = await spaceRequest<{
    upload: { id: string };
    transfer: { url: string; method?: string; headers: Record<string, string> };
    finalize?: { headers?: Record<string, string> };
  }>(`/spaces/${encodeURIComponent(spaceId)}/library/uploads`, {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      mime_type: file.type || "application/octet-stream",
      byte_size: file.size,
      sha256,
      purpose,
      // In-place replace: the server should reuse `replace_item_id` instead of
      // minting a new item. Older servers ignore these and mint a new id, which
      // replaceLibraryItemContent() detects and cleans up.
      ...(replace
        ? { replace_item_id: replace.itemId, replace_item_version: replace.itemVersion }
        : {}),
    }),
  });
  options?.onStage?.("uploading");
  await transferLibraryObject(initiated.transfer, file, accountGeneration, options);
  options?.onStage?.("finalizing");
  const finalizeHeaders = initiated.finalize?.headers ?? {
    "X-Misty-Library-Upload-Token":
      initiated.transfer.headers["X-Misty-Library-Upload-Token"] ??
      initiated.transfer.headers["x-misty-library-upload-token"],
  };
  return spaceRequest<LibraryUploadResult>(
    `/spaces/${encodeURIComponent(spaceId)}/library/uploads/${encodeURIComponent(initiated.upload.id)}/finalize`,
    {
      method: "POST",
      headers: finalizeHeaders,
    },
  );
}

async function transferLibraryObject(
  transfer: { url: string; method?: string; headers: Record<string, string> },
  file: File,
  accountGeneration: number,
  options?: LibraryUploadOptions,
): Promise<void> {
  assertStableSpaceAccount(accountGeneration);
  const direct = /^https?:\/\//i.test(transfer.url);
  const [base, token] = direct
    ? ["", ""]
    : await Promise.all([resolveSpacesApiBase(), readAccountAuthToken()]);
  assertStableSpaceAccount(accountGeneration);
  const url = direct ? transfer.url : `${base}${transfer.url}`;
  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    request.open(transfer.method || "PUT", url, true);
    request.withCredentials = !direct;
    for (const [name, value] of Object.entries(transfer.headers ?? {})) {
      if (!value || /^(host|content-length|connection|origin)$/i.test(name)) continue;
      request.setRequestHeader(name, value);
    }
    if (!direct && token) request.setRequestHeader("Authorization", `Bearer ${token}`);
    request.upload.onprogress = (event) => {
      if (isAccountSessionTransitioning() || accountGeneration !== readAccountSessionGeneration()) {
        request.abort();
        return;
      }
      if (event.lengthComputable && event.total > 0)
        options?.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => {
      options?.signal?.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) {
        options?.onProgress?.(1);
        resolve();
      } else {
        reject(
          new SpaceRequestError(directTransferErrorMessage(direct, request.status), request.status),
        );
      }
    };
    request.onerror = () => {
      options?.signal?.removeEventListener("abort", abort);
      reject(new Error(directTransferErrorMessage(direct, 0)));
    };
    request.onabort = () => reject(new DOMException("The upload was canceled.", "AbortError"));
    if (options?.signal?.aborted) return abort();
    options?.signal?.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
  assertStableSpaceAccount(accountGeneration);
}

function directTransferErrorMessage(direct: boolean, status: number): string {
  if (!direct) return "The cloud upload failed.";
  if (status === 403 || status === 0) {
    return "The direct R2 upload was blocked by the bucket CORS/preflight policy.";
  }
  return "The direct R2 upload failed.";
}

function libraryReauthenticationHeaders(token: string): Record<string, string> {
  return token ? { "X-Misty-Library-Reauthentication": token } : {};
}

function libraryPreviewPath(
  spaceId: string,
  itemId: string,
  original: boolean,
  cacheVersion?: string | number,
): string {
  const query = new URLSearchParams();
  if (original) query.set("version", "original");
  if (cacheVersion !== undefined && String(cacheVersion))
    query.set("cache_version", String(cacheVersion));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/preview${suffix}`;
}

async function downloadProtectedFile(
  path: string,
  filename: string,
  init?: RequestInit,
): Promise<void> {
  const blob = await fetchProtectedBlob(path, init);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

async function fetchProtectedBlob(path: string, init?: RequestInit): Promise<Blob> {
  const accountGeneration = readAccountSessionGeneration();
  assertStableSpaceAccount(accountGeneration);
  const [base, token] = await Promise.all([resolveSpacesApiBase(), readAccountAuthToken()]);
  assertStableSpaceAccount(accountGeneration);
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, { credentials: "include", ...init, headers });
  } catch (error) {
    assertStableSpaceAccount(accountGeneration);
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
      /* plain text */
    }
    throw new SpaceRequestError(spaceErrorMessage(code, text), response.status, code);
  }
  const blob = await readDownloadBlob(response);
  assertStableSpaceAccount(accountGeneration);
  return blob;
}

export const maxWebviewUploadBytes = 128 * 1024 * 1024;

function webviewUploadSizeError(): Error {
  return new Error(
    "This beta can safely copy files up to 128 MB. Larger files need Misty’s streaming uploader.",
  );
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}
