import { create } from "zustand";
import { openExternalLink } from "../shared/openExternalLink";
import { errorText } from "../shared/format";
import { resolveSpacesApiBase, spacesApi, type RealtimeEnvelope } from "../spaces/api";
import type {
  MessageSpan,
  Space,
  SpaceEvent,
  SpaceInboxItem,
  SpaceInvitation,
  SpaceMember,
  SpaceMessage,
  SpaceNode,
  SpaceStudioResource,
  SpaceRun,
  SpacesSnapshot,
} from "../spaces/types";

type ActivityTab = "unreads" | "mentions";

interface SpacesStore {
  spaces: Space[];
  invitations: SpaceInvitation[];
  limits: SpacesSnapshot["limits"] | null;
  membersBySpace: Record<string, SpaceMember[]>;
  messagesBySpace: Record<string, SpaceMessage[]>;
  nodesBySpace: Record<string, SpaceNode[]>;
  agentsBySpace: Record<string, SpaceStudioResource[]>;
  workflowsBySpace: Record<string, SpaceStudioResource[]>;
  inbox: Record<ActivityTab, SpaceInboxItem[]>;
  loading: boolean;
  sending: boolean;
  realtimeConnected: boolean;
  error: string | null;
  load: () => Promise<void>;
  loadSpace: (spaceId: string) => Promise<void>;
  loadMessages: (spaceId: string) => Promise<void>;
  loadNodes: (spaceId: string) => Promise<void>;
  loadMembers: (spaceId: string) => Promise<void>;
  loadStudio: (spaceId: string, kind: "agents" | "workflows") => Promise<void>;
  loadInbox: () => Promise<void>;
  createSpace: (name: string) => Promise<Space>;
  renameSpace: (spaceId: string, name: string) => Promise<Space>;
  invite: (spaceId: string, email: string) => Promise<void>;
  respondInvite: (inviteId: string, accept: boolean) => Promise<void>;
  removeMember: (spaceId: string, userId: string) => Promise<void>;
  leaveSpace: (spaceId: string) => Promise<void>;
  transferOwner: (spaceId: string, userId: string) => Promise<void>;
  deleteSpace: (spaceId: string, confirmation: string) => Promise<void>;
  sendMessage: (spaceId: string, text: string, fileNodeIds?: string[], attachmentIds?: string[], libraryItemIds?: string[], replyToMessageId?: string) => Promise<void>;
  updateMessage: (spaceId: string, messageId: string, text: string, fileNodeIds?: string[]) => Promise<void>;
  deleteMessage: (spaceId: string, messageId: string) => Promise<void>;
  markRead: (spaceId: string, seq: number) => Promise<void>;
  createFolder: (spaceId: string, displayName: string, parentId?: string) => Promise<void>;
  addDriveLink: (spaceId: string, input: { displayName: string; driveUrl: string; parentId?: string }) => Promise<void>;
  updateNode: (spaceId: string, node: SpaceNode, patch: Partial<SpaceNode>) => Promise<void>;
  removeNode: (spaceId: string, nodeId: string) => Promise<void>;
  openNode: (spaceId: string, nodeId: string, disposition?: "open" | "download") => Promise<void>;
  saveStudio: (spaceId: string, kind: "agents" | "workflows", item: Partial<SpaceStudioResource>) => Promise<SpaceStudioResource>;
  deleteStudio: (spaceId: string, kind: "agents" | "workflows", id: string) => Promise<void>;
  runStudio: (spaceId: string, kind: "agents" | "workflows", id: string, prompt?: string) => Promise<SpaceRun>;
  markInboxSeen: () => Promise<void>;
  clearInbox: (tab: ActivityTab) => Promise<void>;
  connectRealtime: (accountId: string) => Promise<void>;
  disconnectRealtime: () => void;
  clearError: () => void;
}

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
      set({ spaces: snapshot.spaces, invitations: snapshot.invitations, limits: snapshot.limits, loading: false });
    } catch (error) {
      set({ loading: false, error: errorText(error) });
    }
  },

  loadSpace: async (spaceId) => {
    set({ loading: true, error: null });
    const results = await Promise.allSettled([
      get().loadMembers(spaceId),
      get().loadMessages(spaceId),
      get().loadNodes(spaceId),
    ]);
    const rejected = results.find((result) => result.status === "rejected");
    set({ loading: false, error: rejected?.status === "rejected" ? errorText(rejected.reason) : null });
  },

  loadMessages: async (spaceId) => {
    const { messages } = await spacesApi.messages(spaceId);
    set((state) => ({ messagesBySpace: { ...state.messagesBySpace, [spaceId]: [...messages].reverse() } }));
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
      set((state) => kind === "agents"
        ? { agentsBySpace: { ...state.agentsBySpace, [spaceId]: resources }, error: null }
        : { workflowsBySpace: { ...state.workflowsBySpace, [spaceId]: resources }, error: null });
    } catch (error) {
      set({ error: errorText(error) });
    }
  },

  loadInbox: async () => {
    try {
      const [unreads, mentions] = await Promise.all([spacesApi.inbox("unreads"), spacesApi.inbox("mentions")]);
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
        spaces: state.spaces.map((item) => item.id === spaceId ? space : item),
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
      const messagesBySpace = { ...state.messagesBySpace }; delete messagesBySpace[spaceId];
      const nodesBySpace = { ...state.nodesBySpace }; delete nodesBySpace[spaceId];
      const membersBySpace = { ...state.membersBySpace }; delete membersBySpace[spaceId];
      return { messagesBySpace, nodesBySpace, membersBySpace };
    });
    await get().load();
  },

  sendMessage: async (spaceId, text, fileNodeIds = [], attachmentIds = [], libraryItemIds = [], replyToMessageId = "") => {
    const trimmed = text.trim();
    if (!trimmed && attachmentIds.length === 0 && libraryItemIds.length === 0 && fileNodeIds.length === 0) return;
    set({ sending: true, error: null });
    try {
      const spans = trimmed ? buildMessageSpans(trimmed, get().membersBySpace[spaceId] ?? [], get().agentsBySpace[spaceId] ?? []) : [];
      const response = await spacesApi.sendMessage(spaceId, spans, fileNodeIds, attachmentIds, libraryItemIds, replyToMessageId);
      set((state) => ({
        sending: false,
        messagesBySpace: {
          ...state.messagesBySpace,
          [spaceId]: mergeMessages(state.messagesBySpace[spaceId] ?? [], [response.message, ...response.agent_replies]),
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
      const spans = buildMessageSpans(text.trim(), get().membersBySpace[spaceId] ?? [], get().agentsBySpace[spaceId] ?? []);
      const saved = await spacesApi.updateMessage(spaceId, messageId, spans, fileNodeIds);
      set((state) => ({ messagesBySpace: { ...state.messagesBySpace, [spaceId]: mergeMessages(state.messagesBySpace[spaceId] ?? [], [saved]) } }));
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  deleteMessage: async (spaceId, messageId) => {
    await spacesApi.deleteMessage(spaceId, messageId);
    set((state) => ({ messagesBySpace: { ...state.messagesBySpace, [spaceId]: (state.messagesBySpace[spaceId] ?? []).filter((item) => item.id !== messageId) } }));
  },

  markRead: async (spaceId, seq) => {
    await spacesApi.markRead(spaceId, seq);
    await get().loadInbox();
  },

  createFolder: async (spaceId, displayName, parentId = "") => {
    await spacesApi.createNode(spaceId, { kind: "folder", display_name: displayName, parent_id: parentId });
    await get().loadNodes(spaceId);
  },

  addDriveLink: async (spaceId, input) => {
    await spacesApi.createNode(spaceId, { kind: "link", display_name: input.displayName, drive_url: input.driveUrl, parent_id: input.parentId ?? "" });
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
    const [ticket, base] = await Promise.all([spacesApi.resolve(spaceId, nodeId, disposition), resolveSpacesApiBase()]);
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

  runStudio: async (spaceId, kind, id, prompt = "") => {
    return spacesApi.runStudio(spaceId, kind, id, prompt);
  },

  markInboxSeen: async () => {
    await spacesApi.seen();
    set((state) => ({ inbox: {
      unreads: state.inbox.unreads.map((item) => ({ ...item, seen_at: item.seen_at ?? new Date().toISOString() })),
      mentions: state.inbox.mentions.map((item) => ({ ...item, seen_at: item.seen_at ?? new Date().toISOString() })),
    } }));
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
    if (realtimeConnecting || realtimeSocket?.readyState === WebSocket.OPEN || realtimeSocket?.readyState === WebSocket.CONNECTING) return;
    realtimeConnecting = true;
    const generation = realtimeGeneration;
    try {
      const after = readRealtimeCursor(accountId);
      const [{ ticket }, base] = await Promise.all([spacesApi.realtimeTicket(after), resolveSpacesApiBase()]);
      if (!realtimeWanted || generation !== realtimeGeneration || realtimeAccountId !== accountId) return;
      const url = new URL(base);
      url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
      url.pathname = `${url.pathname.replace(/\/$/, "")}/realtime`;
      url.search = new URLSearchParams({ ticket }).toString();
      const socket = new WebSocket(url);
      realtimeSocket = socket;
      realtimeOpenTimer = window.setTimeout(() => {
        realtimeOpenTimer = null;
        if (realtimeSocket === socket && socket.readyState === WebSocket.CONNECTING) socket.close();
      }, realtimeConnectTimeoutMs);
      socket.onopen = () => {
        if (realtimeSocket !== socket || generation !== realtimeGeneration || realtimeAccountId !== accountId) {
          socket.close();
          return;
        }
        clearRealtimeOpenTimer();
        reconnectAttempt = 0;
        set({ realtimeConnected: true });
      };
      socket.onmessage = (message) => {
        if (realtimeSocket !== socket || generation !== realtimeGeneration || realtimeAccountId !== accountId) return;
        try {
          const envelope = JSON.parse(String(message.data)) as RealtimeEnvelope;
          if (envelope.type === "replay") {
            for (const event of envelope.events) void applyRealtimeEvent(event, accountId, get, set);
            if (envelope.resync_required) void Promise.all([get().load(), get().loadInbox()]);
          } else if (envelope.type === "event") {
            void applyRealtimeEvent(envelope.event, accountId, get, set);
          } else {
            void Promise.all([get().load(), get().loadInbox()]);
            if (window.location.pathname.startsWith(`/spaces/${envelope.space_id}/`)) window.location.assign("/spaces/personal");
          }
        } catch { /* malformed server frames are ignored and recovered on reconnect */ }
      };
      socket.onclose = () => {
        if (realtimeSocket !== socket || generation !== realtimeGeneration || realtimeAccountId !== accountId) return;
        clearRealtimeOpenTimer();
        realtimeSocket = null;
        set({ realtimeConnected: false });
        scheduleReconnect(get, accountId, generation);
      };
      socket.onerror = () => socket.close();
    } catch (error) {
      if (generation !== realtimeGeneration || realtimeAccountId !== accountId) return;
      set({ realtimeConnected: false, error: errorText(error) });
      scheduleReconnect(get, accountId, generation);
    } finally {
      if (generation === realtimeGeneration && realtimeAccountId === accountId) realtimeConnecting = false;
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

function mergeMessages(current: SpaceMessage[], incoming: SpaceMessage[]): SpaceMessage[] {
  const byId = new Map(current.map((item) => [item.id, item]));
  for (const item of incoming) byId.set(item.id, item);
  return [...byId.values()].sort((left, right) => left.seq - right.seq);
}

export function buildMessageSpans(text: string, members: SpaceMember[], agents: SpaceStudioResource[]): MessageSpan[] {
  const candidates = [
    ...members.map((member) => ({ label: member.name, userId: member.user_id, agentId: "" })),
    ...agents.map((agent) => ({ label: agent.name, userId: "", agentId: agent.id })),
  ].filter((item) => item.label.trim()).sort((left, right) => right.label.length - left.label.length);
  if (candidates.length === 0) return [{ type: "text", text }];
  const pattern = new RegExp(`@(${candidates.map((item) => escapeRegExp(item.label)).join("|")})(?=\\s|$|[.,!?])`, "gi");
  const spans: MessageSpan[] = [];
  let offset = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > offset) spans.push({ type: "text", text: text.slice(offset, index) });
    const label = match[1];
    const candidate = candidates.find((item) => item.label.toLocaleLowerCase() === label.toLocaleLowerCase());
    if (candidate?.userId) spans.push({ type: "mention", user_id: candidate.userId, label: candidate.label });
    else if (candidate?.agentId) spans.push({ type: "mention", agent_id: candidate.agentId, label: candidate.label });
    else spans.push({ type: "text", text: match[0] });
    offset = index + match[0].length;
  }
  if (offset < text.length) spans.push({ type: "text", text: text.slice(offset) });
  return spans.length ? spans : [{ type: "text", text }];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function applyRealtimeEvent(
  event: SpaceEvent,
  accountId: string,
  get: () => SpacesStore,
  set: (partial: Partial<SpacesStore> | ((state: SpacesStore) => Partial<SpacesStore>)) => void,
) {
  if (accountId !== realtimeAccountId) return;
  writeRealtimeCursor(accountId, event.id);
  if (event.type.startsWith("message.")) await Promise.all([get().loadMessages(event.space_id), get().loadInbox()]);
  else if (event.type.startsWith("node.")) await get().loadNodes(event.space_id);
  else if (event.type.startsWith("member.") || event.type.startsWith("owner.") || event.type.startsWith("space.")) await Promise.all([get().load(), get().loadMembers(event.space_id)]);
  else if (event.type.startsWith("agent.")) await get().loadStudio(event.space_id, "agents");
  else if (event.type.startsWith("workflow.")) await get().loadStudio(event.space_id, "workflows");
  set({ realtimeConnected: true });
}

function scheduleReconnect(get: () => SpacesStore, accountId: string, generation: number) {
  if (!realtimeWanted || realtimeAccountId !== accountId || realtimeGeneration !== generation || reconnectTimer != null) return;
  const delay = Math.min(30_000, 750 * 2 ** reconnectAttempt) + Math.floor(Math.random() * 500);
  reconnectAttempt += 1;
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = null;
    if (!realtimeWanted || realtimeAccountId !== accountId || realtimeGeneration !== generation) return;
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
  try { return Number(window.localStorage.getItem(accountRealtimeCursorKey(accountId))) || 0; } catch { return 0; }
}

function writeRealtimeCursor(accountId: string, cursor: number) {
  try { window.localStorage.setItem(accountRealtimeCursorKey(accountId), String(cursor)); } catch { /* cursor replay falls back to a snapshot */ }
}
