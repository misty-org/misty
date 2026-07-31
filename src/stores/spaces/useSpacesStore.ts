import type { ActivityTab } from "@/models/types/stores/spaces/useSpacesStore";
export type { ActivityTab } from "@/models/types/stores/spaces/useSpacesStore";
import type { SpacesStore } from "@/models/interfaces/stores/spaces/useSpacesStore";
export type { SpacesStore } from "@/models/interfaces/stores/spaces/useSpacesStore";
import { create } from "zustand";
import { openExternalLink } from "@/platform/openExternalLink";
import { errorText } from "@/lib/format";
import { notifyAccountScopeReset } from "@/stores/account/accountEvents";
import {
  resolveSpacesApiBase,
  SpaceRequestError,
  spacesApi,
} from "@/stores/spaces/useSpacesBackendStore";
import type { RealtimeEnvelope } from "@/models/types/stores/spaces/useSpacesBackendStore";
import type { SpaceRun } from "@/models/interfaces/features/spaces/types";
import type {
  Space,
  SpaceEvent,
  SpaceInboxItem,
  SpaceInvitation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceStudioResource,
  SpacesSnapshot,
} from "@/models/interfaces/features/spaces/types";
import { buildMessageSpans, mergeSpaceMessages } from "./useSpaceMessageSpansStore";
export { buildMessageSpans } from "./useSpaceMessageSpansStore";

const realtimeCursorKey = "misty:spaces:realtime-cursor";
const realtimeConnectTimeoutMs = 12_000;
const realtimeTicketRateLimitCooldownMs = 30_000;
const snapshotAutoMinIntervalMs = 1_500;
const snapshotRateLimitCooldownMs = 10_000;
const accountSessionInvalidEvent = "misty:account-session-invalid";
let realtimeSocket: WebSocket | null = null;
let realtimeConnecting = false;
let reconnectTimer: number | null = null;
let realtimeOpenTimer: number | null = null;
let realtimeConnectPromise: Promise<void> | null = null;
let realtimeTicketCooldownUntil = 0;
let snapshotLoadPromise: Promise<void> | null = null;
let snapshotLastRequestedAt = 0;
let snapshotCooldownUntil = 0;
let reconnectAttempt = 0;
let realtimeWanted = false;
let realtimeAccountId = "";
let realtimeGeneration = 0;
// The Space we last told the server we're viewing. Re-sent on every reconnect
// since the server only knows about it for the lifetime of a WebSocket.
let currentViewingSpaceId = "";
// Whether Misty is currently in focus (vs. tabbed/alt-tabbed away — "idle").
// Tracked globally so presence stays correct across every Space section.
let currentViewingActive = computeViewingActivity();

// Bumped whenever the authenticated account context changes (see
// resetSpacesAccountState). Async loaders capture this value before making a
// request and discard their result if it no longer matches by the time the
// response lands, so a slow request from a previous account can never
// overwrite state or surface an error for the account that's active now.
let spacesAccountGeneration = 0;

export const useSpacesStore = create<SpacesStore>((set, get) => ({
  spaces: [],
  invitations: [],
  limits: null,
  ownerStorage: null,
  membersBySpace: {},
  messagesBySpace: {},
  nodesBySpace: {},
  agentsBySpace: {},
  workflowsBySpace: {},
  inbox: { unreads: [], mentions: [] },
  presenceBySpace: {},
  snapshotReady: false,
  loading: false,
  sending: false,
  realtimeConnected: false,
  error: null,

  load: async (options) => {
    const force = options?.force === true;
    const now = Date.now();
    if (snapshotLoadPromise) return snapshotLoadPromise;
    if (!force && now < snapshotCooldownUntil) return;
    if (
      !force &&
      snapshotLastRequestedAt &&
      now - snapshotLastRequestedAt < snapshotAutoMinIntervalMs
    )
      return;

    const request = (async () => {
      const generation = spacesAccountGeneration;
      snapshotLastRequestedAt = Date.now();
      set({ snapshotReady: false, loading: true, error: null });
      try {
        const snapshot = await spacesApi.snapshot();
        if (generation !== spacesAccountGeneration) return;
        snapshotCooldownUntil = 0;
        set({
          spaces: snapshot.spaces,
          invitations: snapshot.invitations,
          limits: snapshot.entitlements,
          ownerStorage: snapshot.owner_storage,
          snapshotReady: true,
          loading: false,
        });
      } catch (error) {
        if (generation !== spacesAccountGeneration) return;
        if (error instanceof SpaceRequestError && error.status === 401) {
          notifyAccountSessionInvalid();
        }
        if (error instanceof SpaceRequestError && error.status === 429) {
          snapshotCooldownUntil = Date.now() + snapshotRateLimitCooldownMs;
        }
        set({ snapshotReady: false, loading: false, error: errorText(error) });
      }
    })();
    snapshotLoadPromise = request;
    try {
      await request;
    } finally {
      if (snapshotLoadPromise === request) snapshotLoadPromise = null;
    }
  },

  loadSpace: async (spaceId) => {
    const generation = spacesAccountGeneration;
    set({ loading: true, error: null });
    await get().load();
    if (generation !== spacesAccountGeneration) return;
    if (!get().snapshotReady) {
      set({ loading: false });
      return;
    }
    const space = get().spaces.find((item) => item.id === spaceId);
    if (!space) {
      set((state) => {
        const membersBySpace = { ...state.membersBySpace };
        const messagesBySpace = { ...state.messagesBySpace };
        const nodesBySpace = { ...state.nodesBySpace };
        delete membersBySpace[spaceId];
        delete messagesBySpace[spaceId];
        delete nodesBySpace[spaceId];
        return { membersBySpace, messagesBySpace, nodesBySpace, loading: false };
      });
      return;
    }
    const canReadMessages = space.permissions?.["messages.read"] !== false;
    if (!canReadMessages) {
      set((state) => {
        const messagesBySpace = { ...state.messagesBySpace };
        const nodesBySpace = { ...state.nodesBySpace };
        delete messagesBySpace[spaceId];
        delete nodesBySpace[spaceId];
        return { messagesBySpace, nodesBySpace };
      });
    }
    const tasks = [get().loadMembers(spaceId)];
    if (canReadMessages) tasks.push(get().loadMessages(spaceId), get().loadNodes(spaceId));
    const results = await Promise.allSettled(tasks);
    if (generation !== spacesAccountGeneration) return;
    const rejected = results.find((result) => result.status === "rejected");
    set({
      loading: false,
      error: rejected?.status === "rejected" ? errorText(rejected.reason) : null,
    });
  },

  loadMessages: async (spaceId) => {
    const generation = spacesAccountGeneration;
    const { messages } = await spacesApi.messages(spaceId);
    if (generation !== spacesAccountGeneration) return;
    set((state) => ({
      messagesBySpace: { ...state.messagesBySpace, [spaceId]: [...messages].reverse() },
    }));
  },

  loadNodes: async (spaceId) => {
    const generation = spacesAccountGeneration;
    const { nodes } = await spacesApi.nodes(spaceId);
    if (generation !== spacesAccountGeneration) return;
    set((state) => ({ nodesBySpace: { ...state.nodesBySpace, [spaceId]: nodes } }));
  },

  loadMembers: async (spaceId) => {
    const generation = spacesAccountGeneration;
    const { members } = await spacesApi.members(spaceId);
    if (generation !== spacesAccountGeneration) return;
    set((state) => ({ membersBySpace: { ...state.membersBySpace, [spaceId]: members } }));
  },

  loadStudio: async (spaceId, kind) => {
    const generation = spacesAccountGeneration;
    try {
      const { resources } = await spacesApi.studio(spaceId, kind);
      if (generation !== spacesAccountGeneration) return;
      set((state) =>
        kind === "agents"
          ? { agentsBySpace: { ...state.agentsBySpace, [spaceId]: resources }, error: null }
          : { workflowsBySpace: { ...state.workflowsBySpace, [spaceId]: resources }, error: null },
      );
    } catch (error) {
      if (generation !== spacesAccountGeneration) return;
      set({ error: errorText(error) });
    }
  },

  loadChatAgents: async (spaceId) => {
    const generation = spacesAccountGeneration;
    try {
      const { agents } = await spacesApi.chatAgents(spaceId);
      if (generation !== spacesAccountGeneration) return;
      set((state) => ({
        agentsBySpace: { ...state.agentsBySpace, [spaceId]: agents },
        error: null,
      }));
    } catch (error) {
      if (generation !== spacesAccountGeneration) return;
      if (error instanceof SpaceRequestError && (error.status === 403 || error.status === 404)) {
        set((state) => ({
          agentsBySpace: { ...state.agentsBySpace, [spaceId]: [] },
        }));
        return;
      }
      set({ error: errorText(error) });
    }
  },

  loadInbox: async () => {
    const generation = spacesAccountGeneration;
    try {
      const [unreads, mentions] = await Promise.all([
        spacesApi.inbox("unreads"),
        spacesApi.inbox("mentions"),
      ]);
      if (generation !== spacesAccountGeneration) return;
      set({ inbox: { unreads: unreads.items, mentions: mentions.items } });
    } catch (error) {
      if (generation !== spacesAccountGeneration) return;
      set({ error: errorText(error) });
    }
  },

  createSpace: async (request) => {
    set({ error: null });
    try {
      const result = await spacesApi.create(request);
      await get().load({ force: true });
      return result;
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  renameSpace: async (spaceId, name) => {
    set({ error: null });
    try {
      const space = await spacesApi.rename(spaceId, name);
      set((state) => ({
        spaces: state.spaces.map((item) => (item.id === spaceId ? space : item)),
      }));
      return space;
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  invite: async (spaceId, email) => {
    set({ error: null });
    try {
      await spacesApi.invite(spaceId, email);
      await Promise.all([get().loadMembers(spaceId), get().load({ force: true })]);
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  respondInvite: async (inviteId, accept) => {
    set({ error: null });
    try {
      await spacesApi.respondInvite(inviteId, accept);
      await get().load({ force: true });
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  removeMember: async (spaceId, userId) => {
    set({ error: null });
    try {
      await spacesApi.removeMember(spaceId, userId);
      await Promise.all([get().loadMembers(spaceId), get().load({ force: true })]);
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  leaveSpace: async (spaceId) => {
    set({ error: null });
    try {
      await spacesApi.leave(spaceId);
      await get().load({ force: true });
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  transferOwner: async (spaceId, userId) => {
    set({ error: null });
    try {
      await spacesApi.transfer(spaceId, userId);
      await Promise.all([get().loadMembers(spaceId), get().load({ force: true })]);
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  deleteSpace: async (spaceId, confirmation) => {
    set({ error: null });
    try {
      await spacesApi.delete(spaceId, confirmation);
      set((state) => {
        const messagesBySpace = { ...state.messagesBySpace };
        delete messagesBySpace[spaceId];
        const nodesBySpace = { ...state.nodesBySpace };
        delete nodesBySpace[spaceId];
        const membersBySpace = { ...state.membersBySpace };
        delete membersBySpace[spaceId];
        return { messagesBySpace, nodesBySpace, membersBySpace };
      });
      await get().load({ force: true });
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  sendMessage: async (
    spaceId,
    text,
    fileNodeIds = [],
    attachmentIds = [],
    libraryItemIds = [],
    replyToMessageId = "",
    selectedAgentIdsByLabel = {},
  ) => {
    const trimmed = text.trim();
    if (
      !trimmed &&
      attachmentIds.length === 0 &&
      libraryItemIds.length === 0 &&
      fileNodeIds.length === 0
    )
      return;
    set({ sending: true, error: null });
    try {
      const spans = trimmed
        ? buildMessageSpans(
            trimmed,
            get().membersBySpace[spaceId] ?? [],
            get().agentsBySpace[spaceId] ?? [],
            selectedAgentIdsByLabel,
          )
        : [];
      const response = await spacesApi.sendMessage(
        spaceId,
        spans,
        fileNodeIds,
        attachmentIds,
        libraryItemIds,
        replyToMessageId,
      );
      set((state) => ({
        sending: false,
        error: null,
        messagesBySpace: {
          ...state.messagesBySpace,
          [spaceId]: mergeSpaceMessages(state.messagesBySpace[spaceId] ?? [], [
            response.message,
            ...response.agent_replies,
          ]),
        },
      }));
    } catch (error) {
      set({ sending: false, error: errorText(error) });
      throw error;
    }
  },

  updateMessage: async (spaceId, messageId, text, fileNodeIds = []) => {
    set({ error: null });
    try {
      const spans = buildMessageSpans(
        text.trim(),
        get().membersBySpace[spaceId] ?? [],
        get().agentsBySpace[spaceId] ?? [],
      );
      const saved = await spacesApi.updateMessage(spaceId, messageId, spans, fileNodeIds);
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [spaceId]: mergeSpaceMessages(state.messagesBySpace[spaceId] ?? [], [saved]),
        },
      }));
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  deleteMessage: async (spaceId, messageId) => {
    set({ error: null });
    try {
      await spacesApi.deleteMessage(spaceId, messageId);
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [spaceId]: (state.messagesBySpace[spaceId] ?? []).filter((item) => item.id !== messageId),
        },
      }));
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  toggleMessageReaction: async (spaceId, messageId, emoji, reacted) => {
    set({ error: null });
    try {
      const saved = reacted
        ? await spacesApi.removeMessageReaction(spaceId, messageId, emoji)
        : await spacesApi.addMessageReaction(spaceId, messageId, emoji);
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [spaceId]: mergeSpaceMessages(state.messagesBySpace[spaceId] ?? [], [saved]),
        },
      }));
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  markRead: async (spaceId, seq) => {
    await spacesApi.markRead(spaceId, seq);
    await get().loadInbox();
  },

  openNode: async (spaceId, nodeId, disposition = "open") => {
    const [ticket, base] = await Promise.all([
      spacesApi.resolve(spaceId, nodeId, disposition),
      resolveSpacesApiBase(),
    ]);
    await openExternalLink(`${base}${ticket.url}`);
  },

  saveStudio: async (spaceId, kind, item) => {
    set({ error: null });
    try {
      const saved = await spacesApi.saveStudio(spaceId, kind, item);
      await get().loadStudio(spaceId, kind);
      return saved;
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  deleteStudio: async (spaceId, kind, id) => {
    set({ error: null });
    try {
      await spacesApi.deleteStudio(spaceId, kind, id);
      await get().loadStudio(spaceId, kind);
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  runStudio: async (spaceId, kind, id, prompt = "", capabilityId = "") => {
    try {
      return await spacesApi.runStudio(spaceId, kind, id, prompt, capabilityId);
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  markInboxSeen: async () => {
    await spacesApi.seen();
    set((state) => ({
      inbox: {
        unreads: state.inbox.unreads.map((item) => ({
          ...item,
          seen_at: item.seen_at ?? new Date().toISOString(),
        })),
        mentions: state.inbox.mentions.map((item) => ({
          ...item,
          seen_at: item.seen_at ?? new Date().toISOString(),
        })),
      },
    }));
  },

  clearInbox: async (tab) => {
    await spacesApi.clearInbox(tab);
    set((state) => ({ inbox: { ...state.inbox, [tab]: [] } }));
  },

  connectRealtime: async (accountId) => {
    accountId = accountId.trim();
    if (!accountId) return;
    if (realtimeAccountId && realtimeAccountId !== accountId) stopRealtimeConnection();
    realtimeAccountId = accountId;
    realtimeWanted = true;
    if (realtimeConnectPromise) return realtimeConnectPromise;
    if (Date.now() < realtimeTicketCooldownUntil) return;
    if (
      realtimeConnecting ||
      realtimeSocket?.readyState === WebSocket.OPEN ||
      realtimeSocket?.readyState === WebSocket.CONNECTING
    )
      return;
    realtimeConnecting = true;
    const generation = realtimeGeneration;
    const request = (async () => {
      try {
        const after = readRealtimeCursor(accountId);
        const [{ ticket }, base] = await Promise.all([
          spacesApi.realtimeTicket(after),
          resolveSpacesApiBase(),
        ]);
        if (!realtimeWanted || generation !== realtimeGeneration || realtimeAccountId !== accountId)
          return;
        realtimeTicketCooldownUntil = 0;
        const url = new URL(base);
        url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
        url.pathname = `${url.pathname.replace(/\/$/, "")}/realtime`;
        url.search = new URLSearchParams({ ticket }).toString();
        // Older WebKit builds accept URL in the type signature but can reject the
        // URL object at runtime. Pass the serialized URL to keep desktop WebViews
        // on the well-supported WebSocket constructor path.
        const socket = new WebSocket(url.toString());
        realtimeSocket = socket;
        realtimeOpenTimer = window.setTimeout(() => {
          realtimeOpenTimer = null;
          if (realtimeSocket === socket && socket.readyState === WebSocket.CONNECTING)
            socket.close();
        }, realtimeConnectTimeoutMs);
        socket.onopen = () => {
          if (
            realtimeSocket !== socket ||
            generation !== realtimeGeneration ||
            realtimeAccountId !== accountId
          ) {
            socket.close();
            return;
          }
          clearRealtimeOpenTimer();
          reconnectAttempt = 0;
          set({ realtimeConnected: true, error: null });
          if (currentViewingSpaceId)
            sendViewingMessage(currentViewingSpaceId, currentViewingActive);
        };
        socket.onmessage = (message) => {
          if (
            realtimeSocket !== socket ||
            generation !== realtimeGeneration ||
            realtimeAccountId !== accountId
          )
            return;
          try {
            const envelope = JSON.parse(String(message.data)) as RealtimeEnvelope;
            if (envelope.type === "replay") {
              for (const event of envelope.events)
                applyRealtimeEventSafely(event, accountId, get, set);
              if (envelope.resync_required)
                void Promise.all([get().load({ force: true }), get().loadInbox()]);
            } else if (envelope.type === "event") {
              applyRealtimeEventSafely(envelope.event, accountId, get, set);
            } else if (envelope.type === "presence") {
              set((state) => ({
                presenceBySpace: {
                  ...state.presenceBySpace,
                  [envelope.space_id]: envelope.viewers,
                },
              }));
            } else {
              void Promise.all([get().load({ force: true }), get().loadInbox()]);
              if (window.location.pathname.startsWith(`/spaces/${envelope.space_id}/`))
                window.location.assign("/spaces");
            }
          } catch {
            /* malformed server frames are ignored and recovered on reconnect */
          }
        };
        socket.onclose = () => {
          if (
            realtimeSocket !== socket ||
            generation !== realtimeGeneration ||
            realtimeAccountId !== accountId
          )
            return;
          clearRealtimeOpenTimer();
          realtimeSocket = null;
          set({ realtimeConnected: false });
          scheduleReconnect(get, accountId, generation);
        };
        socket.onerror = () => {
          try {
            socket.close();
          } catch {
            /* the close event or timeout will retry */
          }
        };
      } catch (error) {
        if (generation !== realtimeGeneration || realtimeAccountId !== accountId) return;
        if (error instanceof SpaceRequestError && error.status === 429) {
          realtimeTicketCooldownUntil = Date.now() + realtimeTicketRateLimitCooldownMs;
        }
        set({ realtimeConnected: false, error: errorText(error) });
        scheduleReconnect(get, accountId, generation);
      } finally {
        if (generation === realtimeGeneration && realtimeAccountId === accountId)
          realtimeConnecting = false;
      }
    })();
    realtimeConnectPromise = request;
    try {
      await request;
    } finally {
      if (realtimeConnectPromise === request) realtimeConnectPromise = null;
    }
  },

  disconnectRealtime: () => {
    stopRealtimeConnection();
    set({ realtimeConnected: false });
  },

  setViewingSpace: (spaceId) => {
    if (currentViewingSpaceId === spaceId) return;
    currentViewingSpaceId = spaceId;
    sendViewingMessage(spaceId, currentViewingActive);
  },

  clearError: () => set({ error: null }),
}));

function notifyAccountSessionInvalid(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(accountSessionInvalidEvent));
}

export function resetSpacesAccountState(): void {
  notifyAccountScopeReset();
  stopRealtimeConnection();
  reconnectAttempt = 0;
  realtimeConnectPromise = null;
  realtimeTicketCooldownUntil = 0;
  snapshotLoadPromise = null;
  snapshotLastRequestedAt = 0;
  snapshotCooldownUntil = 0;
  // Bump the generation first so any request already in flight for the
  // account we're leaving can no longer write into the state we're about to
  // clear for the new one, no matter when it resolves.
  spacesAccountGeneration += 1;
  useSpacesStore.setState({
    spaces: [],
    invitations: [],
    limits: null,
    ownerStorage: null,
    membersBySpace: {},
    messagesBySpace: {},
    nodesBySpace: {},
    agentsBySpace: {},
    workflowsBySpace: {},
    inbox: { unreads: [], mentions: [] },
    presenceBySpace: {},
    snapshotReady: false,
    // Stay in a loading state rather than flashing an empty "no Spaces yet"
    // view — the caller is expected to re-trigger a load for the new
    // account, and until that resolves there's nothing confirmed to show.
    loading: true,
    sending: false,
    realtimeConnected: false,
    error: null,
  });
}

async function applyRealtimeEvent(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: (partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>)) => void,
) {
  if (accountId !== realtimeAccountId) return;
  const generation = spacesAccountGeneration;
  writeRealtimeCursor(accountId, event.id);
  const permissions = get().spaces.find((space) => space.id === event.space_id)?.permissions;
  if (event.type.startsWith("message.") && permissions?.["messages.read"] !== false) {
    const conversationId =
      typeof event.payload.conversation_id === "string" ? event.payload.conversation_id : "";
    window.dispatchEvent(
      new CustomEvent("misty:space-message-event", {
        detail: { spaceId: event.space_id, conversationId, event },
      }),
    );
    if (conversationId) await get().loadInbox();
    else await Promise.all([get().loadMessages(event.space_id), get().loadInbox()]);
  } else if (event.type.startsWith("conversation."))
    window.dispatchEvent(new CustomEvent("misty:space-conversation-event", { detail: event }));
  else if (event.type.startsWith("node.") && permissions?.["messages.read"] !== false)
    await get().loadNodes(event.space_id);
  else if (
    event.type.startsWith("member.") ||
    event.type.startsWith("owner.") ||
    event.type.startsWith("space.")
  ) {
    await get().load({ force: true });
    if (accountId !== realtimeAccountId || generation !== spacesAccountGeneration) return;
    if (!get().spaces.some((space) => space.id === event.space_id)) return;
    try {
      await get().loadMembers(event.space_id);
    } catch (error) {
      if (!isInaccessibleSpaceError(error)) throw error;
    }
  } else if (event.type.startsWith("library.") && permissions?.["library.view"] !== false)
    window.dispatchEvent(new CustomEvent("misty:space-library-event", { detail: event }));
  else if (event.type.startsWith("note."))
    window.dispatchEvent(new CustomEvent("misty:space-note-event", { detail: event }));
  else if (event.type.startsWith("drawing."))
    window.dispatchEvent(new CustomEvent("misty:space-drawing-event", { detail: event }));
  else if (
    (event.type.startsWith("task.") || event.type.startsWith("calendar.")) &&
    permissions?.["tasks.view"] !== false
  )
    window.dispatchEvent(new CustomEvent("misty:space-coordination-event", { detail: event }));
  if (accountId !== realtimeAccountId || generation !== spacesAccountGeneration) return;
  set({ realtimeConnected: true });
}

function applyRealtimeEventSafely(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: (partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>)) => void,
): void {
  void applyRealtimeEvent(event, accountId, get, set).catch((error) => {
    if (isInaccessibleSpaceError(error)) return;
    if (accountId !== realtimeAccountId) return;
    set({ error: errorText(error) });
  });
}

function isInaccessibleSpaceError(error: unknown): boolean {
  return error instanceof SpaceRequestError && (error.status === 403 || error.status === 404);
}

function scheduleReconnect(get: () => SpacesStore, accountId: string, generation: number) {
  if (
    !realtimeWanted ||
    realtimeAccountId !== accountId ||
    realtimeGeneration !== generation ||
    reconnectTimer != null
  )
    return;
  const delay = Math.min(60_000, 2_000 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 750);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!realtimeWanted || realtimeAccountId !== accountId || realtimeGeneration !== generation)
      return;
    void get().connectRealtime(accountId);
  }, delay);
}

function stopRealtimeConnection() {
  realtimeWanted = false;
  realtimeConnecting = false;
  realtimeConnectPromise = null;
  realtimeTicketCooldownUntil = 0;
  realtimeAccountId = "";
  realtimeGeneration += 1;
  currentViewingSpaceId = "";
  if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearRealtimeOpenTimer();
  const socket = realtimeSocket;
  realtimeSocket = null;
  socket?.close();
}

function sendViewingMessage(spaceId: string, active: boolean): void {
  if (realtimeSocket?.readyState !== WebSocket.OPEN) return;
  try {
    realtimeSocket.send(JSON.stringify({ type: "viewing", space_id: spaceId, active }));
  } catch {
    /* the connection will retry and re-send on the next open */
  }
}

// "Active" means the Space is in view and the window has focus. Anything else
// counts as idle even though the WebSocket is still connected.
function computeViewingActivity(): boolean {
  if (typeof document === "undefined") return true;
  return document.visibilityState === "visible" && document.hasFocus();
}

function handleViewingActivityChange(): void {
  const active = computeViewingActivity();
  if (active === currentViewingActive) return;
  currentViewingActive = active;
  if (currentViewingSpaceId) sendViewingMessage(currentViewingSpaceId, currentViewingActive);
}

if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", handleViewingActivityChange);
  window.addEventListener("focus", handleViewingActivityChange);
  window.addEventListener("blur", handleViewingActivityChange);
}

function clearRealtimeOpenTimer() {
  if (realtimeOpenTimer != null) window.clearTimeout(realtimeOpenTimer);
  realtimeOpenTimer = null;
}

function accountRealtimeCursorKey(accountId: string): string {
  return `${realtimeCursorKey}:${accountId}`;
}

function readRealtimeCursor(accountId: string): number {
  try {
    return Number(window.localStorage.getItem(accountRealtimeCursorKey(accountId))) || 0;
  } catch {
    return 0;
  }
}

function writeRealtimeCursor(accountId: string, cursor: number) {
  try {
    window.localStorage.setItem(accountRealtimeCursorKey(accountId), String(cursor));
  } catch {
    /* cursor replay falls back to a snapshot */
  }
}
