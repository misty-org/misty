import { readAccountAuthToken } from "../pages/Account/shared/authTokenStore";
import { appSnapshot } from "../api/misty";
import { safeTauriAssetUrl } from "@/shared/tauri";
import type {
  AgentMentionFailure,
  MessageSpan,
  BulkLibraryItemAction,
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
  LibraryEditDefinition,
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
  SpaceConversation,
  SpaceLibraryItem,
  SpaceStorageUsage,
  SpaceNode,
  SpacesSnapshot,
  SpaceStudioResource,
  SpaceRun,
  SpaceTask,
  SpaceTaskPage,
  SpaceTaskPriority,
  SpaceTaskMoveResult,
  SpaceTaskStatus,
  SpaceCalendarEvent,
  SpaceCalendarSource,
  GoogleCalendarChoice,
} from "./types";
import { normalizeApiBaseUrl, withDefaultApiPath } from "../api/apiBase";

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
  const [base, token] = await Promise.all([resolveSpacesApiBase(), readAccountAuthToken()]);
  const headers = new Headers(init?.headers);
  if (init?.body && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { credentials: "include", ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { code?: string }).code;
    } catch {
      /* plain-text response */
    }
    throw new SpaceRequestError(spaceErrorMessage(code, text), response.status, code);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
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
    space_storage_quota_exceeded:
      "This upload would exceed this Space’s shared 1 GB storage limit.",
    library_uploads_disabled: "Library uploads are temporarily unavailable.",
    library_media_processor_unavailable: "Edited media rendering is temporarily unavailable.",
    upload_verification_failed: "Misty could not verify the uploaded file.",
    dangerous_file_type: "This file type cannot be stored safely.",
    malware_detected: "This upload was rejected because it matched a malware signature.",
    space_people_limit_reached: "This Space already has five members or pending invitations.",
    space_node_limit_reached: "This Space has reached its 5,000-item limit.",
    version_conflict: "Someone else changed this item. Reload it before saving again.",
    library_reauthentication_required: "Unlock this protected Library collection again.",
    integration_required:
      "Connect the workflow’s required provider in this Space before running it.",
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
  snapshot: () => spaceRequest<SpacesSnapshot>("/spaces"),
  create: (name: string) =>
    spaceRequest<Space>("/spaces", { method: "POST", body: JSON.stringify({ name }) }),
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
  invite: (spaceId: string, email: string) =>
    spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/invitations`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
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
  createConversation: (spaceId: string, title: string, memberIds: string[]) =>
    spaceRequest<SpaceConversation>(`/spaces/${encodeURIComponent(spaceId)}/conversations`, {
      method: "POST",
      body: JSON.stringify({ title, member_ids: memberIds }),
    }),
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
  markRead: (spaceId: string, seq: number) =>
    spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/read`, {
      method: "POST",
      body: JSON.stringify({ seq }),
    }),
  nodes: (spaceId: string) =>
    spaceRequest<{ nodes: SpaceNode[] }>(`/spaces/${encodeURIComponent(spaceId)}/nodes`),
  createNode: (spaceId: string, body: Record<string, unknown>) =>
    spaceRequest<SpaceNode>(`/spaces/${encodeURIComponent(spaceId)}/nodes`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  updateNode: (spaceId: string, nodeId: string, body: Record<string, unknown>) =>
    spaceRequest<SpaceNode>(
      `/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeId)}`,
      { method: "PUT", body: JSON.stringify(body) },
    ),
  deleteNode: (spaceId: string, nodeId: string) =>
    spaceRequest(`/spaces/${encodeURIComponent(spaceId)}/nodes/${encodeURIComponent(nodeId)}`, {
      method: "DELETE",
    }),
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
  uploadLibraryFile: (
    spaceId: string,
    file: File,
    purpose: "library" | "attachment",
    options?: LibraryUploadOptions,
  ) => uploadLibraryFile(spaceId, file, purpose, options),
  uploadLibraryPath: (
    spaceId: string,
    path: string,
    purpose: "library" | "attachment",
    options?: LibraryUploadOptions,
  ) => uploadLibraryPath(spaceId, path, purpose, options),
  promoteAttachment: (spaceId: string, attachmentId: string) =>
    spaceRequest<SpaceLibraryItem>(
      `/spaces/${encodeURIComponent(spaceId)}/attachments/${encodeURIComponent(attachmentId)}/promote`,
      { method: "POST" },
    ),
  importLibraryItems: (
    sourceSpaceId: string,
    destinationSpaceId: string,
    itemIds: string[],
    reauthenticationToken = "",
  ) =>
    spaceRequest<LibraryItemsResult>(
      `/spaces/${encodeURIComponent(sourceSpaceId)}/library/imports`,
      {
        method: "POST",
        headers: libraryReauthenticationHeaders(reauthenticationToken),
        body: JSON.stringify({ destination_space_id: destinationSpaceId, item_ids: itemIds }),
      },
    ),
  sharedReferences: (spaceId: string) =>
    spaceRequest<{ references: LibrarySharedReference[]; outgoing: LibrarySharedReference[] }>(
      `/spaces/${encodeURIComponent(spaceId)}/library/shared`,
    ),
  shareLibraryItems: (
    sourceSpaceId: string,
    destinationSpaceId: string,
    itemIds: string[],
    reauthenticationToken = "",
  ) =>
    spaceRequest<{ references: LibrarySharedReference[] }>(
      `/spaces/${encodeURIComponent(sourceSpaceId)}/library/shared`,
      {
        method: "POST",
        headers: libraryReauthenticationHeaders(reauthenticationToken),
        body: JSON.stringify({ destination_space_id: destinationSpaceId, item_ids: itemIds }),
      },
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
  removeAlbumItem: (spaceId: string, albumId: string, itemId: string) =>
    spaceRequest(
      `/spaces/${encodeURIComponent(spaceId)}/library/albums/${encodeURIComponent(albumId)}/items/${encodeURIComponent(itemId)}`,
      { method: "DELETE" },
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
  memberPermissions: (spaceId: string, userId: string) =>
    spaceRequest<{ permissions: Record<string, boolean> }>(
      `/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}/permissions`,
    ),
  setMemberPermission: (
    spaceId: string,
    userId: string,
    permission: string,
    effect: "allow" | "deny" | "inherit",
  ) =>
    spaceRequest<{ permissions: Record<string, boolean> }>(
      `/spaces/${encodeURIComponent(spaceId)}/members/${encodeURIComponent(userId)}/permissions`,
      { method: "PUT", body: JSON.stringify({ permission, effect }) },
    ),
};

export interface LibraryUploadOptions {
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
  onStage?: (stage: "reading" | "hashing" | "uploading" | "finalizing") => void;
}

async function uploadLibraryPath(
  spaceId: string,
  path: string,
  purpose: "library" | "attachment",
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  options?.onStage?.("reading");
  const response = await fetch(safeTauriAssetUrl(path));
  if (!response.ok) throw new Error(`Misty could not read ${fileNameFromPath(path)}.`);
  const blob = await response.blob();
  const file = new File([blob], fileNameFromPath(path), {
    type: blob.type || "application/octet-stream",
    lastModified: Date.now(),
  });
  return uploadLibraryFile(spaceId, file, purpose, options);
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
  options?: LibraryUploadOptions,
): Promise<LibraryUploadResult> {
  options?.onStage?.("hashing");
  const sha256 = toHex(
    new Uint8Array(await crypto.subtle.digest("SHA-256", await file.arrayBuffer())),
  );
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
    }),
  });
  options?.onStage?.("uploading");
  await transferLibraryObject(initiated.transfer, file, options);
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
  options?: LibraryUploadOptions,
): Promise<void> {
  const direct = /^https?:\/\//i.test(transfer.url);
  const [base, token] = direct
    ? ["", ""]
    : await Promise.all([resolveSpacesApiBase(), readAccountAuthToken()]);
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
      if (event.lengthComputable && event.total > 0)
        options?.onProgress?.(Math.min(1, event.loaded / event.total));
    };
    request.onload = () => {
      options?.signal?.removeEventListener("abort", abort);
      if (request.status >= 200 && request.status < 300) {
        options?.onProgress?.(1);
        resolve();
      } else {
        reject(new SpaceRequestError("The cloud upload failed.", request.status));
      }
    };
    request.onerror = () => {
      options?.signal?.removeEventListener("abort", abort);
      reject(new Error("The cloud upload could not be reached. Check the R2 bucket CORS policy."));
    };
    request.onabort = () => reject(new DOMException("The upload was canceled.", "AbortError"));
    if (options?.signal?.aborted) return abort();
    options?.signal?.addEventListener("abort", abort, { once: true });
    request.send(file);
  });
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
  const [base, token] = await Promise.all([resolveSpacesApiBase(), readAccountAuthToken()]);
  const headers = new Headers(init?.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const response = await fetch(`${base}${path}`, { credentials: "include", ...init, headers });
  if (!response.ok) {
    const text = await response.text();
    let code: string | undefined;
    try {
      code = (JSON.parse(text) as { code?: string }).code;
    } catch {
      /* plain text */
    }
    throw new SpaceRequestError(spaceErrorMessage(code, text), response.status, code);
  }
  return response.blob();
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export type RealtimeEnvelope =
  | { type: "replay"; events: SpaceEvent[]; resync_required: boolean }
  | { type: "event"; event: SpaceEvent }
  | {
      type: "control";
      action: "member.removed" | "member.left" | "space.deleted";
      space_id: string;
    };
