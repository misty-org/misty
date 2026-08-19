import { activityApi } from "@/api/activity/api";
import { notifyAccountScopeReset } from "@/features/auth";
import { mergeSpaceMessages } from "@/features/spaces/chat";
import * as referenceMode from "./reference-mode";
import * as accessErrors from "@/api/spaces/access-errors";
import { SpaceRequestError, spacesApi } from "@/api/spaces/api";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import type { SpacesStore } from "../model/stores/spaces/interfaces/useSpacesStore";
import { createSpaceContentActions } from "./createSpaceContentActions";
import {
  createSpacesRealtimeActions,
  resetSpacesRealtimeRuntime,
} from "./createSpacesRealtimeActions";
export { buildMessageSpans } from "@/features/spaces/chat";

const snapshotAutoMinIntervalMs = 1_500;
const snapshotRateLimitCooldownMs = 10_000;
const snapshotServerErrorCooldownMs = 5_000;
let snapshotLoadPromise: Promise<void> | null = null;
let snapshotLastRequestedAt = 0;
let snapshotCooldownUntil = 0;
// The Space we last told the server we're viewing. Re-sent on every reconnect
// since the server only knows about it for the lifetime of a WebSocket.
// Whether Misty is currently in focus (vs. tabbed/alt-tabbed away — "idle").
// Tracked globally so presence stays correct across every Space section.

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
  agentMembershipsBySpace: {},
  messagesBySpace: {},
  nodesBySpace: {},
  agentsBySpace: {},
  workflowsBySpace: {},
  inbox: { unreads: [], mentions: [] },
  presenceBySpace: {},
  snapshotReady: false,
  referenceOnly: false,
  lastSyncedAt: null,
  loading: false,
  sending: false,
  realtimeConnected: false,
  error: null,

  load: async (options) => {
    if (options?.accountId) referenceMode.setSpaceReferenceModeAccount(options.accountId);
    const force = options?.force === true;
    const now = Date.now();
    if (snapshotLoadPromise) return snapshotLoadPromise;
    // Automated reconnect and realtime paths also use `force`; keep them from
    // hammering a server that has already returned a retryable failure.
    if (now < snapshotCooldownUntil) return;
    if (
      !force &&
      snapshotLastRequestedAt &&
      now - snapshotLastRequestedAt < snapshotAutoMinIntervalMs
    )
      return;

    const request = (async () => {
      const generation = spacesAccountGeneration;
      snapshotLastRequestedAt = Date.now();
      set({ loading: true, error: null });
      try {
        const snapshot = await spacesApi.snapshot();
        if (generation !== spacesAccountGeneration) return;
        snapshotCooldownUntil = 0;
        set(referenceMode.liveSpaceSnapshotState(snapshot));
      } catch (error) {
        if (generation !== spacesAccountGeneration) return;
        if (error instanceof SpaceRequestError && error.status === 401) {
          accessErrors.notifyAccountSessionInvalid();
        }
        if (error instanceof SpaceRequestError && error.status === 429) {
          snapshotCooldownUntil = Date.now() + snapshotRateLimitCooldownMs;
        }
        if (error instanceof SpaceRequestError && error.status >= 500) {
          snapshotCooldownUntil = Date.now() + snapshotServerErrorCooldownMs;
        }
        const fallback = await referenceMode.referenceSpaceSnapshotState(error, get());
        if (generation !== spacesAccountGeneration) return;
        if (fallback) {
          set(fallback);
          return;
        }
        set({ loading: false, error: errorText(error) });
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
        const agentMembershipsBySpace = { ...state.agentMembershipsBySpace };
        const messagesBySpace = { ...state.messagesBySpace };
        const nodesBySpace = { ...state.nodesBySpace };
        delete membersBySpace[spaceId];
        delete agentMembershipsBySpace[spaceId];
        delete messagesBySpace[spaceId];
        delete nodesBySpace[spaceId];
        return {
          membersBySpace,
          agentMembershipsBySpace,
          messagesBySpace,
          nodesBySpace,
          loading: false,
        };
      });
      return;
    }
    if (get().referenceOnly) return void set({ loading: false });
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
    if (canReadMessages && space.kind !== "misty") {
      tasks.push(get().loadMessages(spaceId), get().loadNodes(spaceId));
    }
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
    try {
      const { messages } = await spacesApi.messages(spaceId);
      if (generation !== spacesAccountGeneration) return;
      const ordered = [...messages].reverse();
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [spaceId]: mergeSpaceMessages(
            (state.messagesBySpace[spaceId] ?? []).filter(
              (message) => message.local_delivery_state === "sending",
            ),
            ordered,
          ),
        },
      }));
    } catch (error) {
      if (generation !== spacesAccountGeneration) return;
      if (await recoverInaccessibleSpace(error, spaceId, get)) return;
      throw error;
    }
  },

  loadNodes: async (spaceId) => {
    const generation = spacesAccountGeneration;
    try {
      const { nodes } = await spacesApi.nodes(spaceId);
      if (generation !== spacesAccountGeneration) return;
      set((state) => ({ nodesBySpace: { ...state.nodesBySpace, [spaceId]: nodes } }));
    } catch (error) {
      if (generation !== spacesAccountGeneration) return;
      if (await recoverInaccessibleSpace(error, spaceId, get)) return;
      throw error;
    }
  },

  loadMembers: async (spaceId) => {
    const generation = spacesAccountGeneration;
    try {
      const { members, agents } = await spacesApi.members(spaceId);
      if (generation !== spacesAccountGeneration) return;
      set((state) => ({
        membersBySpace: { ...state.membersBySpace, [spaceId]: members },
        agentMembershipsBySpace: { ...state.agentMembershipsBySpace, [spaceId]: agents ?? [] },
      }));
    } catch (error) {
      if (generation !== spacesAccountGeneration) return;
      if (await recoverInaccessibleSpace(error, spaceId, get)) return;
      throw error;
    }
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
        activityApi.inbox("unreads"),
        activityApi.inbox("mentions"),
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
        const agentMembershipsBySpace = { ...state.agentMembershipsBySpace };
        delete agentMembershipsBySpace[spaceId];
        return { messagesBySpace, nodesBySpace, membersBySpace, agentMembershipsBySpace };
      });
      await get().load({ force: true });
    } catch (error) {
      set({ error: errorText(error) });
      throw error;
    }
  },

  ...createSpaceContentActions(set, get),
  ...createSpacesRealtimeActions(set, get, () => spacesAccountGeneration),
  clearError: () => set({ error: null }),
}));

referenceMode.bindSpaceReferenceMode((state) => useSpacesStore.setState(state));

export function resetSpacesAccountState(): void {
  notifyAccountScopeReset();
  resetSpacesRealtimeRuntime();
  snapshotLoadPromise = null;
  snapshotLastRequestedAt = 0;
  snapshotCooldownUntil = 0;
  // Bump the generation first so any request already in flight for the
  // account we're leaving can no longer write into the state we're about to
  // clear for the new one, no matter when it resolves.
  spacesAccountGeneration += 1;
  referenceMode.resetSpaceReferenceMode();
  useSpacesStore.setState({
    spaces: [],
    invitations: [],
    limits: null,
    ownerStorage: null,
    membersBySpace: {},
    agentMembershipsBySpace: {},
    messagesBySpace: {},
    nodesBySpace: {},
    agentsBySpace: {},
    workflowsBySpace: {},
    inbox: { unreads: [], mentions: [] },
    presenceBySpace: {},
    snapshotReady: false,
    referenceOnly: false,
    lastSyncedAt: null,
    // Stay in a loading state rather than flashing an empty "no Spaces yet"
    // view — the caller is expected to re-trigger a load for the new
    // account, and until that resolves there's nothing confirmed to show.
    loading: true,
    sending: false,
    realtimeConnected: false,
    error: null,
  });
}

async function recoverInaccessibleSpace(
  error: unknown,
  spaceId: string,
  get: () => SpacesStore,
): Promise<boolean> {
  if (!accessErrors.isInaccessibleSpaceError(error)) return false;
  useSpacesStore.setState((state) => {
    const membersBySpace = { ...state.membersBySpace };
    const agentMembershipsBySpace = { ...state.agentMembershipsBySpace };
    const messagesBySpace = { ...state.messagesBySpace };
    const nodesBySpace = { ...state.nodesBySpace };
    delete membersBySpace[spaceId];
    delete agentMembershipsBySpace[spaceId];
    delete messagesBySpace[spaceId];
    delete nodesBySpace[spaceId];
    return { membersBySpace, agentMembershipsBySpace, messagesBySpace, nodesBySpace };
  });
  await get().load({ force: true });
  return true;
}

export type ActivityTab = "unreads" | "mentions";
