import { notifyAccountScopeReset } from "@/features/account";
import {
  historyAfterNewestPage,
  mergeNewestSpaceMessagePage,
  mergeSpaceMessages,
  oldestServerMessage,
} from "../chat/use_space_message_spans_store";
import * as referenceMode from "./reference_mode";
import * as accessErrors from "../api/access_errors";
import { SpaceRequestError, spacesApi } from "../api/api";
import { spaceMessagePageSize } from "../api/chat";
import { errorText } from "@/shared/lib/format";
import { create } from "zustand";
import type { SpacesStore } from "./spaces_store_types";
import { createSpaceContentActions } from "./create_space_content_actions";
import { createSpaceLifecycleActions } from "./create_space_lifecycle_actions";
import {
  noteSpacesSnapshotLoaded,
  resetSpacesSnapshotFreshness,
  setSpacesSnapshotQueuedCheck,
} from "./spaces_snapshot_freshness";
import {
  createSpacesRealtimeActions,
  resetSpacesRealtimeRuntime,
} from "./create_spaces_realtime_actions";
export { buildMessageSpans } from "../chat/use_space_message_spans_store";

const snapshotAutoMinIntervalMs = 1_500;
const snapshotRateLimitCooldownMs = 10_000;
const snapshotServerErrorCooldownMs = 5_000;
let snapshotLoadPromise: Promise<void> | null = null;
let forcedSnapshotFollowUp: Promise<void> | null = null;
let snapshotLastRequestedAt = 0;
let snapshotCooldownUntil = 0;
let snapshotRetryTimer: ReturnType<typeof setTimeout> | null = null;
let snapshotRetryAttempt = 0;
const snapshotRetryMaxMs = 30_000;

function clearSnapshotRetry(resetAttempts: boolean) {
  if (snapshotRetryTimer) clearTimeout(snapshotRetryTimer);
  snapshotRetryTimer = null;
  if (resetAttempts) snapshotRetryAttempt = 0;
}

function retrySnapshotLater(generation: number) {
  clearSnapshotRetry(false);
  const backoff = Math.min(snapshotRetryMaxMs, 1_000 * 2 ** snapshotRetryAttempt);
  snapshotRetryAttempt += 1;
  const delay = Math.max(backoff, snapshotCooldownUntil - Date.now());
  snapshotRetryTimer = setTimeout(() => {
    snapshotRetryTimer = null;
    const state = useSpacesStore.getState();
    if (generation !== spacesAccountGeneration || (state.snapshotReady && !state.referenceOnly))
      return;
    void useSpacesStore.getState().load({ force: true });
  }, delay);
}

let spacesAccountGeneration = 0;

setSpacesSnapshotQueuedCheck(() => forcedSnapshotFollowUp !== null || snapshotRetryTimer !== null);

function waitMs(ms: number): Promise<void> {
  return ms > 0 ? new Promise((done) => setTimeout(done, ms)) : Promise.resolve();
}

export const useSpacesStore = create<SpacesStore>((set, get) => ({
  spaces: [],
  invitations: [],
  membersBySpace: {},
  integrationsBySpace: {},
  messagesBySpace: {},
  messageLoadingBySpace: {},
  messageErrorsBySpace: {},
  messageHistoryBySpace: {},
  nodesBySpace: {},
  presenceBySpace: {},
  typingByConversation: {},
  snapshotReady: false,
  referenceOnly: false,
  loading: false,
  sending: false,
  error: null,

  load: async (options) => {
    const force = options?.force === true;
    const now = Date.now();
    if (force && (snapshotLoadPromise || now < snapshotCooldownUntil)) {
      const waiting = snapshotLoadPromise !== null;
      if (!waiting && snapshotRetryTimer) return;
      if (forcedSnapshotFollowUp) return waiting ? forcedSnapshotFollowUp : undefined;
      const generation = spacesAccountGeneration;
      const before = snapshotLoadPromise?.catch(() => undefined) ?? Promise.resolve();
      const followUp = before
        .then(() => waitMs(snapshotCooldownUntil - Date.now()))
        .then(() => {
          if (forcedSnapshotFollowUp === followUp) forcedSnapshotFollowUp = null;
          if (generation !== spacesAccountGeneration) return;
          return get().load(options);
        });
      forcedSnapshotFollowUp = followUp;
      return waiting ? followUp : undefined;
    }
    if (snapshotLoadPromise) return snapshotLoadPromise;
    if (now < snapshotCooldownUntil) return;
    if (
      !force &&
      snapshotLastRequestedAt &&
      now - snapshotLastRequestedAt < snapshotAutoMinIntervalMs
    )
      return;

    const request = (async () => {
      const generation = spacesAccountGeneration;
      const requestedAt = Date.now();
      snapshotLastRequestedAt = requestedAt;
      set({ loading: true, error: null });
      try {
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
        clearSnapshotRetry(true);
        set(referenceMode.liveSpaceSnapshotState(snapshot));
        noteSpacesSnapshotLoaded(requestedAt);
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
        const signedOut = error instanceof SpaceRequestError && error.status === 401;
        if (!signedOut && (!get().snapshotReady || get().referenceOnly))
          retrySnapshotLater(generation);
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
        const integrationsBySpace = { ...state.integrationsBySpace };
        const messagesBySpace = { ...state.messagesBySpace };
        const messageLoadingBySpace = { ...state.messageLoadingBySpace };
        const messageErrorsBySpace = { ...state.messageErrorsBySpace };
        const nodesBySpace = { ...state.nodesBySpace };
        delete membersBySpace[spaceId];
        delete integrationsBySpace[spaceId];
        delete messagesBySpace[spaceId];
        delete messageLoadingBySpace[spaceId];
        delete messageErrorsBySpace[spaceId];
        delete nodesBySpace[spaceId];
        return {
          membersBySpace,
          integrationsBySpace,
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
      const { messages } = await spacesApi.messages(spaceId, 0, (saved) => {
        if (generation !== spacesAccountGeneration || get().messagesBySpace[spaceId]?.length) {
          return;
        }
        set((state) => ({
          messagesBySpace: { ...state.messagesBySpace, [spaceId]: [...saved.messages].reverse() },
          messageLoadingBySpace: { ...state.messageLoadingBySpace, [spaceId]: false },
        }));
      });
      if (generation !== spacesAccountGeneration) return;
      const ordered = [...messages].reverse();
      set((state) => {
        const merged = mergeNewestSpaceMessagePage(state.messagesBySpace[spaceId] ?? [], ordered);
        return {
          messagesBySpace: { ...state.messagesBySpace, [spaceId]: merged.messages },
          messageHistoryBySpace: {
            ...state.messageHistoryBySpace,
            [spaceId]: historyAfterNewestPage(
              state.messageHistoryBySpace[spaceId],
              messages.length,
              merged.keptEarlier,
              spaceMessagePageSize,
            ),
          },
          messageLoadingBySpace: { ...state.messageLoadingBySpace, [spaceId]: false },
          messageErrorsBySpace: { ...state.messageErrorsBySpace, [spaceId]: "" },
        };
      });
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

  loadOlderMessages: async (spaceId) => {
    const history = get().messageHistoryBySpace[spaceId];
    if (history !== "more") return;
    const oldest = oldestServerMessage(get().messagesBySpace[spaceId] ?? []);
    if (!oldest) return;
    const generation = spacesAccountGeneration;
    const setHistory = (next: "more" | "complete") =>
      set((state) => ({
        messageHistoryBySpace: { ...state.messageHistoryBySpace, [spaceId]: next },
      }));
    set((state) => ({
      messageHistoryBySpace: { ...state.messageHistoryBySpace, [spaceId]: "loading" },
    }));
    try {
      const { messages } = await spacesApi.messages(spaceId, oldest.seq);
      if (generation !== spacesAccountGeneration) return;
      if (!(get().messagesBySpace[spaceId] ?? []).some((message) => message.id === oldest.id)) {
        if (get().messageHistoryBySpace[spaceId] === "loading") setHistory("more");
        return;
      }
      set((state) => ({
        messagesBySpace: {
          ...state.messagesBySpace,
          [spaceId]: mergeSpaceMessages(
            state.messagesBySpace[spaceId] ?? [],
            [...messages].reverse(),
          ),
        },
        messageHistoryBySpace: {
          ...state.messageHistoryBySpace,
          [spaceId]: messages.length < spaceMessagePageSize ? "complete" : "more",
        },
      }));
    } catch {
      if (generation === spacesAccountGeneration) setHistory("more");
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
      const { members, integrations } = await spacesApi.members(spaceId, (saved) => {
        if (generation !== spacesAccountGeneration || get().membersBySpace[spaceId]) return;
        set((state) => ({
          membersBySpace: { ...state.membersBySpace, [spaceId]: saved.members },
          integrationsBySpace: {
            ...state.integrationsBySpace,
            [spaceId]: saved.integrations ?? [],
          },
        }));
      });
      if (generation !== spacesAccountGeneration) return;
      set((state) => ({
        membersBySpace: { ...state.membersBySpace, [spaceId]: members },
        integrationsBySpace: { ...state.integrationsBySpace, [spaceId]: integrations ?? [] },
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
  forcedSnapshotFollowUp = null;
  resetSpacesSnapshotFreshness();
  snapshotLastRequestedAt = 0;
  snapshotCooldownUntil = 0;
  clearSnapshotRetry(true);
  spacesAccountGeneration += 1;
  referenceMode.resetSpaceReferenceMode();
  useSpacesStore.setState({
    spaces: [],
    invitations: [],
    membersBySpace: {},
    integrationsBySpace: {},
    messagesBySpace: {},
    messageLoadingBySpace: {},
    messageErrorsBySpace: {},
    messageHistoryBySpace: {},
    nodesBySpace: {},
    presenceBySpace: {},
    typingByConversation: {},
    snapshotReady: false,
    referenceOnly: false,
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
    const integrationsBySpace = { ...state.integrationsBySpace };
    const messagesBySpace = { ...state.messagesBySpace };
    const messageLoadingBySpace = { ...state.messageLoadingBySpace };
    const messageErrorsBySpace = { ...state.messageErrorsBySpace };
    const nodesBySpace = { ...state.nodesBySpace };
    delete membersBySpace[spaceId];
    delete integrationsBySpace[spaceId];
    delete messagesBySpace[spaceId];
    delete messageLoadingBySpace[spaceId];
    delete messageErrorsBySpace[spaceId];
    delete nodesBySpace[spaceId];
    return {
      membersBySpace,
      integrationsBySpace,
      messagesBySpace,
      messageLoadingBySpace,
      messageErrorsBySpace,
      nodesBySpace,
    };
  });
  await get().load({ force: true });
  return true;
}
