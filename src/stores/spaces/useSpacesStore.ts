import type { ActivityTab } from "@/models/types/stores/spaces/useSpacesStore";
export type { ActivityTab } from "@/models/types/stores/spaces/useSpacesStore";
import type { SpacesStore } from "@/models/interfaces/stores/spaces/useSpacesStore";
export type { SpacesStore } from "@/models/interfaces/stores/spaces/useSpacesStore";
import { create } from "zustand";
import { openExternalLink } from "@/platform/openExternalLink";
import { errorText } from "@/lib/format";
import { resolveSpacesApiBase, spacesApi } from "@/stores/spaces/useSpacesBackendStore";
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
let realtimeSocket: WebSocket | null = null;
let realtimeConnecting = false;
let reconnectTimer: number | null = null;
let realtimeOpenTimer: number | null = null;
let reconnectAttempt = 0;
let realtimeWanted = false;
let realtimeAccountId = "";
let realtimeGeneration = 0;

export const useSpacesStore = create<SpacesStore>((set, get) => ({
  spaces: [],
  invitations: [],
  limits: null,
  membersBySpace: {},
  messagesBySpace: {},
  nodesBySpace: {},
  agentsBySpace: {},
  workflowsBySpace: {},
  inbox: { unreads: [], mentions: [] },
  loading: false,
  sending: false,
  realtimeConnected: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    try {
      const snapshot = await spacesApi.snapshot();
      set({
        spaces: snapshot.spaces,
        invitations: snapshot.invitations,
        limits: snapshot.limits,
        loading: false,
      });
    } catch (error) {
      set({ loading: false, error: errorText(error) });
    }
  },

  loadSpace: async (spaceId) => {
    set({ loading: true, error: null });
    if (!get().spaces.some((space) => space.id === spaceId)) await get().load();
    const space = get().spaces.find((item) => item.id === spaceId);
    const canReadMessages = space?.permissions?.["messages.read"] !== false;
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
    const rejected = results.find((result) => result.status === "rejected");
    set({
      loading: false,
      error: rejected?.status === "rejected" ? errorText(rejected.reason) : null,
    });
  },

  loadMessages: async (spaceId) => {
    const { messages } = await spacesApi.messages(spaceId);
    set((state) => ({
      messagesBySpace: { ...state.messagesBySpace, [spaceId]: [...messages].reverse() },
    }));
  },

  loadNodes: async (spaceId) => {
    const { nodes } = await spacesApi.nodes(spaceId);
    set((state) => ({ nodesBySpace: { ...state.nodesBySpace, [spaceId]: nodes } }));
  },

  loadMembers: async (spaceId) => {
    const { members } = await spacesApi.members(spaceId);
    set((state) => ({ membersBySpace: { ...state.membersBySpace, [spaceId]: members } }));
  },

  loadStudio: async (spaceId, kind) => {
    try {
      const { resources } = await spacesApi.studio(spaceId, kind);
      set((state) =>
        kind === "agents"
          ? { agentsBySpace: { ...state.agentsBySpace, [spaceId]: resources }, error: null }
          : { workflowsBySpace: { ...state.workflowsBySpace, [spaceId]: resources }, error: null },
      );
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  loadChatAgents: async (spaceId) => {
    try {
      const { agents } = await spacesApi.chatAgents(spaceId);
      set((state) => ({
        agentsBySpace: { ...state.agentsBySpace, [spaceId]: agents },
        error: null,
      }));
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  loadInbox: async () => {
    try {
      const [unreads, mentions] = await Promise.all([
        spacesApi.inbox("unreads"),
        spacesApi.inbox("mentions"),
      ]);
      set({ inbox: { unreads: unreads.items, mentions: mentions.items } });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  createSpace: async (name) => {
    set({ error: null });
    try {
      const space = await spacesApi.create(name);
      await get().load();
      return space;
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
      await Promise.all([get().loadMembers(spaceId), get().load()]);
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  respondInvite: async (inviteId, accept) => {
    await spacesApi.respondInvite(inviteId, accept);
    await get().load();
  },

  removeMember: async (spaceId, userId) => {
    await spacesApi.removeMember(spaceId, userId);
    await Promise.all([get().loadMembers(spaceId), get().load()]);
  },

  leaveSpace: async (spaceId) => {
    await spacesApi.leave(spaceId);
    await get().load();
  },

  transferOwner: async (spaceId, userId) => {
    await spacesApi.transfer(spaceId, userId);
    await Promise.all([get().loadMembers(spaceId), get().load()]);
  },

  deleteSpace: async (spaceId, confirmation) => {
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
    await get().load();
  },

  sendMessage: async (
    spaceId,
    text,
    fileNodeIds = [],
    attachmentIds = [],
    libraryItemIds = [],
    replyToMessageId = "",
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
      const agentFailureMessage =
        response.agent_failures
          ?.map((failure) => {
            const name =
              get().agentsBySpace[spaceId]?.find((agent) => agent.id === failure.agent_id)?.name ??
              "Agent";
            return `${name}: ${failure.message}`;
          })
          .join("\n") || null;
      set((state) => ({
        sending: false,
        error: agentFailureMessage,
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
    await spacesApi.deleteMessage(spaceId, messageId);
    set((state) => ({
      messagesBySpace: {
        ...state.messagesBySpace,
        [spaceId]: (state.messagesBySpace[spaceId] ?? []).filter((item) => item.id !== messageId),
      },
    }));
  },

  markRead: async (spaceId, seq) => {
    await spacesApi.markRead(spaceId, seq);
    await get().loadInbox();
  },

  createFolder: async (spaceId, displayName, parentId = "") => {
    await spacesApi.createNode(spaceId, {
      kind: "folder",
      display_name: displayName,
      parent_id: parentId,
    });
    await get().loadNodes(spaceId);
  },

  addDriveLink: async (spaceId, input) => {
    await spacesApi.createNode(spaceId, {
      kind: "link",
      display_name: input.displayName,
      drive_url: input.driveUrl,
      parent_id: input.parentId ?? "",
    });
    await get().loadNodes(spaceId);
  },

  updateNode: async (spaceId, node, patch) => {
    await spacesApi.updateNode(spaceId, node.id, {
      parent_id: patch.parent_id ?? node.parent_id ?? "",
      display_name: patch.display_name ?? node.display_name,
      stale: patch.stale ?? node.stale,
      mime_type: patch.mime_type ?? node.mime_type,
      size_bytes: patch.size_bytes ?? node.size_bytes,
      metadata: patch.metadata ?? node.metadata,
    });
    await get().loadNodes(spaceId);
  },

  removeNode: async (spaceId, nodeId) => {
    await spacesApi.deleteNode(spaceId, nodeId);
    await get().loadNodes(spaceId);
  },

  openNode: async (spaceId, nodeId, disposition = "open") => {
    const [ticket, base] = await Promise.all([
      spacesApi.resolve(spaceId, nodeId, disposition),
      resolveSpacesApiBase(),
    ]);
    await openExternalLink(`${base}${ticket.url}`);
  },

  saveStudio: async (spaceId, kind, item) => {
    const saved = await spacesApi.saveStudio(spaceId, kind, item);
    await get().loadStudio(spaceId, kind);
    return saved;
  },

  deleteStudio: async (spaceId, kind, id) => {
    await spacesApi.deleteStudio(spaceId, kind, id);
    await get().loadStudio(spaceId, kind);
  },

  runStudio: async (spaceId, kind, id, prompt = "", capabilityId = "") => {
    return spacesApi.runStudio(spaceId, kind, id, prompt, capabilityId);
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
    if (
      realtimeConnecting ||
      realtimeSocket?.readyState === WebSocket.OPEN ||
      realtimeSocket?.readyState === WebSocket.CONNECTING
    )
      return;
    realtimeConnecting = true;
    const generation = realtimeGeneration;
    try {
      const after = readRealtimeCursor(accountId);
      const [{ ticket }, base] = await Promise.all([
        spacesApi.realtimeTicket(after),
        resolveSpacesApiBase(),
      ]);
      if (!realtimeWanted || generation !== realtimeGeneration || realtimeAccountId !== accountId)
        return;
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
        if (realtimeSocket === socket && socket.readyState === WebSocket.CONNECTING) socket.close();
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
        set({ realtimeConnected: true });
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
              void applyRealtimeEvent(event, accountId, get, set);
            if (envelope.resync_required) void Promise.all([get().load(), get().loadInbox()]);
          } else if (envelope.type === "event") {
            void applyRealtimeEvent(envelope.event, accountId, get, set);
          } else {
            void Promise.all([get().load(), get().loadInbox()]);
            if (window.location.pathname.startsWith(`/spaces/${envelope.space_id}/`))
              window.location.assign("/spaces/personal");
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
      set({ realtimeConnected: false, error: errorText(error) });
      scheduleReconnect(get, accountId, generation);
    } finally {
      if (generation === realtimeGeneration && realtimeAccountId === accountId)
        realtimeConnecting = false;
    }
  },

  disconnectRealtime: () => {
    stopRealtimeConnection();
    set({ realtimeConnected: false });
  },

  clearError: () => set({ error: null }),
}));

export function resetSpacesAccountState(): void {
  stopRealtimeConnection();
  reconnectAttempt = 0;
  useSpacesStore.setState({
    spaces: [],
    invitations: [],
    limits: null,
    membersBySpace: {},
    messagesBySpace: {},
    nodesBySpace: {},
    agentsBySpace: {},
    workflowsBySpace: {},
    inbox: { unreads: [], mentions: [] },
    loading: false,
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
  )
    await Promise.all([get().load(), get().loadMembers(event.space_id)]);
  else if (event.type.startsWith("library.") && permissions?.["library.view"] !== false)
    window.dispatchEvent(new CustomEvent("misty:space-library-event", { detail: event }));
  else if (
    (event.type.startsWith("task.") || event.type.startsWith("calendar.")) &&
    permissions?.["tasks.view"] !== false
  )
    window.dispatchEvent(new CustomEvent("misty:space-coordination-event", { detail: event }));
  else if (event.type.startsWith("agent.") && permissions?.["studio.view"] !== false)
    await get().loadStudio(event.space_id, "agents");
  else if (event.type.startsWith("workflow.") && permissions?.["studio.view"] !== false)
    await get().loadStudio(event.space_id, "workflows");
  set({ realtimeConnected: true });
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
  realtimeAccountId = "";
  realtimeGeneration += 1;
  if (reconnectTimer != null) window.clearTimeout(reconnectTimer);
  reconnectTimer = null;
  clearRealtimeOpenTimer();
  const socket = realtimeSocket;
  realtimeSocket = null;
  socket?.close();
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
