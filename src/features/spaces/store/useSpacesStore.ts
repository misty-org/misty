import { notifyAccountScopeReset } from "@/features/auth/accountStore";
import { mergeSpaceMessages } from "../chat/store/useSpaceMessageSpansStore";
import * as referenceMode from "./reference-mode";
import * as accessErrors from "@/api/spaces/access-errors";
import { SpaceRequestError, spacesApi } from "@/api/spaces/api";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import type { SpacesStore } from "./spacesStoreTypes";
import { createSpaceContentActions } from "./createSpaceContentActions";
import { createSpaceLifecycleActions } from "./createSpaceLifecycleActions";
import {
  createSpacesRealtimeActions,
  resetSpacesRealtimeRuntime,
} from "./createSpacesRealtimeActions";
export { buildMessageSpans } from "../chat/store/useSpaceMessageSpansStore";

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
  membersBySpace: {},
  messagesBySpace: {},
  messageLoadingBySpace: {},
  messageErrorsBySpace: {},
  nodesBySpace: {},
  presenceBySpace: {},
  snapshotReady: false,
  referenceOnly: false,
  loading: false,
  sending: false,
  error: null,

  load: async (options) => {
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
        // The saved list paints first on a first visit; the fresh one replaces it.
        const snapshot = await spacesApi.snapshot((saved) => {
          if (generation !== spacesAccountGeneration || get().snapshotReady) return;
          set({
            spaces: saved.spaces,
            invitations: saved.invitations,
            snapshotReady: true,
          });
        });
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
        const fallback = await referenceMode.referenceSpaceSnapshotState(error);
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
        const messagesBySpace = { ...state.messagesBySpace };
        const messageLoadingBySpace = { ...state.messageLoadingBySpace };
        const messageErrorsBySpace = { ...state.messageErrorsBySpace };
        const nodesBySpace = { ...state.nodesBySpace };
        delete membersBySpace[spaceId];
        delete messagesBySpace[spaceId];
        delete messageLoadingBySpace[spaceId];
        delete messageErrorsBySpace[spaceId];
        delete nodesBySpace[spaceId];
        return {
          membersBySpace,
          messagesBySpace,
          messageLoadingBySpace,
          messageErrorsBySpace,
          nodesBySpace,
          loading: false,
        };
      });
      return;
    }
    if (get().referenceOnly) return void set({ loading: false });
    const tasks = [get().loadMembers(spaceId)];
    // Space home/settings only need membership. App runtimes load their own
    // content after checking installation and session permissions; prefetching
    // it here fails for Spaces that do not have Chat installed.
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
    set((state) => ({
      messageLoadingBySpace: { ...state.messageLoadingBySpace, [spaceId]: true },
      messageErrorsBySpace: { ...state.messageErrorsBySpace, [spaceId]: "" },
    }));
    try {
      const { messages } = await spacesApi.messages(spaceId);
      if (generation !== spacesAccountGeneration) return;
      const ordered = [...messages].reverse();
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [spaceId]: mergeSpaceMessages(
            (state.messagesBySpace[spaceId] ?? []).filter((message) =>
              Boolean(message.local_delivery_state),
            ),
            ordered,
          ),
        },
        messageLoadingBySpace: { ...state.messageLoadingBySpace, [spaceId]: false },
        messageErrorsBySpace: { ...state.messageErrorsBySpace, [spaceId]: "" },
      }));
    } catch (error) {
      if (generation !== spacesAccountGeneration) return;
      if (await recoverInaccessibleSpace(error, spaceId, get)) return;
      set((state) => ({
        messageLoadingBySpace: { ...state.messageLoadingBySpace, [spaceId]: false },
        messageErrorsBySpace: {
          ...state.messageErrorsBySpace,
          [spaceId]: errorText(error),
        },
      }));
      throw error;
    }
  },

  loadNodes: async (spaceId) => {
    const generation = spacesAccountGeneration;
    try {
      const { nodes } = await spacesApi.nodes(spaceId, (saved) => {
        if (generation !== spacesAccountGeneration || get().nodesBySpace[spaceId]) return;
        set((state) => ({ nodesBySpace: { ...state.nodesBySpace, [spaceId]: saved.nodes } }));
      });
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
      const { members } = await spacesApi.members(spaceId, (saved) => {
        if (generation !== spacesAccountGeneration || get().membersBySpace[spaceId]) return;
        set((state) => ({ membersBySpace: { ...state.membersBySpace, [spaceId]: saved.members } }));
      });
      if (generation !== spacesAccountGeneration) return;
      set((state) => ({
        membersBySpace: { ...state.membersBySpace, [spaceId]: members },
      }));
    } catch (error) {
      if (generation !== spacesAccountGeneration) return;
      if (await recoverInaccessibleSpace(error, spaceId, get)) return;
      throw error;
    }
  },

  ...createSpaceLifecycleActions(set, get),
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
    membersBySpace: {},
    messagesBySpace: {},
    messageLoadingBySpace: {},
    messageErrorsBySpace: {},
    nodesBySpace: {},
    presenceBySpace: {},
    snapshotReady: false,
    referenceOnly: false,
    // Stay in a loading state rather than flashing an empty "no Spaces yet"
    // view — the caller is expected to re-trigger a load for the new
    // account, and until that resolves there's nothing confirmed to show.
    loading: true,
    sending: false,
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
    const messagesBySpace = { ...state.messagesBySpace };
    const messageLoadingBySpace = { ...state.messageLoadingBySpace };
    const messageErrorsBySpace = { ...state.messageErrorsBySpace };
    const nodesBySpace = { ...state.nodesBySpace };
    delete membersBySpace[spaceId];
    delete messagesBySpace[spaceId];
    delete messageLoadingBySpace[spaceId];
    delete messageErrorsBySpace[spaceId];
    delete nodesBySpace[spaceId];
    return {
      membersBySpace,
      messagesBySpace,
      messageLoadingBySpace,
      messageErrorsBySpace,
      nodesBySpace,
    };
  });
  await get().load({ force: true });
  return true;
}
