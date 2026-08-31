import { useSpacesStore } from "@/features/spaces";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { compareActivityNewestFirst } from "./activityModel";
import { publishNativeActivity, syncNativeBadge } from "./nativeNotifications";
import type { ActivityItem, ActivityTarget, LocalActivityInput } from "./types";

const maximumDeviceItems = 200;
const maximumKnownSourceIdsPerAccount = 500;
const maximumReadKeysPerAccount = 500;
let localActivitySequence = 0;

interface ActivityStore {
  accountId: string;
  sourceItems: ActivityItem[];
  localItems: ActivityItem[];
  readAtByKey: Record<string, string>;
  knownSourceIdsByAccount: Record<string, string[]>;
  baselinedAccounts: string[];
  allItems: ActivityItem[];
  attentionItems: ActivityItem[];
  attentionCount: number;
  loading: boolean;
  offline: boolean;
  error: string | null;
  setAccount: (accountId: string) => void;
  syncSources: (accountId: string, items: ActivityItem[]) => void;
  load: () => Promise<void>;
  refresh: () => Promise<void>;
  ingestLocal: (input: LocalActivityInput) => string | null;
  markRead: (id: string) => void;
  markAllRead: () => Promise<void>;
  openItem: (id: string) => ActivityTarget | null;
  clearDeviceHistory: () => void;
  setOffline: (offline: boolean) => void;
  clearError: () => void;
}

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set, get) => ({
      accountId: "",
      sourceItems: [],
      localItems: [],
      readAtByKey: {},
      knownSourceIdsByAccount: {},
      baselinedAccounts: [],
      allItems: [],
      attentionItems: [],
      attentionCount: 0,
      loading: false,
      offline: typeof navigator !== "undefined" ? !navigator.onLine : false,
      error: null,

      setAccount: (accountId) => {
        const normalized = accountId.trim();
        if (get().accountId === normalized) return;
        const next = deriveActivityState({ ...get(), accountId: normalized, sourceItems: [] });
        set({ accountId: normalized, sourceItems: [], error: null, ...next });
        void syncNativeBadge(next.attentionCount);
      },

      syncSources: (accountId, items) => {
        const normalized = accountId.trim();
        if (!normalized || normalized !== get().accountId) return;
        const state = get();
        const known = new Set(state.knownSourceIdsByAccount[normalized] ?? []);
        const baselined = state.baselinedAccounts.includes(normalized);
        const normalizedItems = items
          .filter((item) => item.accountId === normalized)
          .map((item) => applyDeviceReadState(item, state.readAtByKey))
          .sort(compareActivityNewestFirst)
          .slice(0, maximumKnownSourceIdsPerAccount);
        const newItems = baselined ? normalizedItems.filter((item) => !known.has(item.id)) : [];
        const knownIds = [
          ...normalizedItems.map((item) => item.id),
          ...(state.knownSourceIdsByAccount[normalized] ?? []),
        ]
          .filter(uniqueString)
          .slice(0, maximumKnownSourceIdsPerAccount);
        const knownSourceIdsByAccount = {
          ...state.knownSourceIdsByAccount,
          [normalized]: knownIds,
        };
        const baselinedAccounts = baselined
          ? state.baselinedAccounts
          : [...state.baselinedAccounts, normalized];
        const next = deriveActivityState({
          ...state,
          sourceItems: normalizedItems,
        });
        set({
          sourceItems: normalizedItems,
          knownSourceIdsByAccount,
          baselinedAccounts,
          error: null,
          ...next,
        });
        void syncNativeBadge(next.attentionCount);
        for (const item of newItems.filter(
          (candidate) => candidate.attention && !candidate.readAt,
        )) {
          void publishNativeActivity(item);
        }
      },

      load: async () => runRefresh(set, get),
      refresh: async () => runRefresh(set, get),

      ingestLocal: (input) => {
        const accountId = (input.accountId ?? get().accountId).trim();
        if (!accountId) return null;
        const createdAt = validIsoDate(input.createdAt);
        const sourceId = input.id?.trim() || nextLocalActivityId();
        const item: ActivityItem = {
          id: `device:${accountId}:${sourceId}`,
          accountId,
          source: "device",
          sourceId,
          kind: input.kind,
          title: input.title.trim() || "Misty activity",
          body: input.body?.trim() ?? "",
          createdAt,
          attention: input.attention ?? (input.kind === "failure" || input.kind === "reminder"),
          target: input.target ?? { kind: "none" },
        };
        const state = get();
        if (state.localItems.some((candidate) => candidate.id === item.id)) return item.id;
        const localItems = [item, ...state.localItems]
          .sort(compareActivityNewestFirst)
          .slice(0, maximumDeviceItems);
        const next = deriveActivityState({ ...state, localItems });
        set({ localItems, ...next });
        void syncNativeBadge(next.attentionCount);
        if (input.notify !== false) void publishNativeActivity(item);
        return item.id;
      },

      markRead: (id) => {
        const item = get().allItems.find((candidate) => candidate.id === id);
        if (!item || item.readAt) return;
        const readAtByKey = boundedReadKeys(
          { ...get().readAtByKey, [readKey(item.accountId, item.id)]: new Date().toISOString() },
          item.accountId,
        );
        const next = deriveActivityState({ ...get(), readAtByKey });
        set({ readAtByKey, ...next });
        void syncNativeBadge(next.attentionCount);
      },

      markAllRead: async () => {
        const state = get();
        if (!state.accountId) return;
        const readAt = new Date().toISOString();
        let readAtByKey = { ...state.readAtByKey };
        for (const item of state.allItems) readAtByKey[readKey(state.accountId, item.id)] = readAt;
        readAtByKey = boundedReadKeys(readAtByKey, state.accountId);
        const next = deriveActivityState({ ...state, readAtByKey });
        set({ readAtByKey, error: null, ...next });
        void syncNativeBadge(0);
        try {
          await useSpacesStore.getState().markInboxSeen();
        } catch (error) {
          set({ error: errorMessage(error) });
        }
      },

      openItem: (id) => {
        const item = get().allItems.find((candidate) => candidate.id === id);
        if (!item) return null;
        get().markRead(id);
        return item.target;
      },

      clearDeviceHistory: () => {
        const state = get();
        if (!state.accountId) return;
        const removedIds = new Set(
          state.localItems
            .filter((item) => item.accountId === state.accountId)
            .map((item) => readKey(state.accountId, item.id)),
        );
        const localItems = state.localItems.filter((item) => item.accountId !== state.accountId);
        const readAtByKey = Object.fromEntries(
          Object.entries(state.readAtByKey).filter(([key]) => !removedIds.has(key)),
        );
        const next = deriveActivityState({ ...state, localItems, readAtByKey });
        set({ localItems, readAtByKey, ...next });
        void syncNativeBadge(next.attentionCount);
      },

      setOffline: (offline) => set({ offline }),
      clearError: () => set({ error: null }),
    }),
    {
      name: "misty:activity:v1",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        localItems: state.localItems.slice(0, maximumDeviceItems),
        readAtByKey: state.readAtByKey,
        knownSourceIdsByAccount: state.knownSourceIdsByAccount,
        baselinedAccounts: state.baselinedAccounts,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState ?? {}) as Partial<ActivityStore>;
        return {
          ...currentState,
          localItems: Array.isArray(persisted.localItems)
            ? persisted.localItems.slice(0, maximumDeviceItems)
            : [],
          readAtByKey: persisted.readAtByKey ?? {},
          knownSourceIdsByAccount: persisted.knownSourceIdsByAccount ?? {},
          baselinedAccounts: Array.isArray(persisted.baselinedAccounts)
            ? persisted.baselinedAccounts
            : [],
        };
      },
    },
  ),
);

async function runRefresh(
  set: (partial: Partial<ActivityStore>) => void,
  get: () => ActivityStore,
): Promise<void> {
  if (!get().accountId) return;
  if (typeof navigator !== "undefined" && !navigator.onLine) {
    set({ loading: false, offline: true });
    return;
  }
  set({ loading: true, offline: false, error: null });
  try {
    await useSpacesStore.getState().loadInbox();
    set({ loading: false });
  } catch (error) {
    set({ loading: false, error: errorMessage(error) });
  }
}

function deriveActivityState(
  state: Pick<ActivityStore, "accountId" | "sourceItems" | "localItems" | "readAtByKey">,
) {
  const allItems = [...state.sourceItems, ...state.localItems]
    .filter((item) => item.accountId === state.accountId)
    .map((item) => applyDeviceReadState(item, state.readAtByKey))
    .filter(
      (item, index, items) => items.findIndex((candidate) => candidate.id === item.id) === index,
    )
    .sort(compareActivityNewestFirst);
  const attentionItems = allItems.filter((item) => item.attention && !item.readAt);
  return { allItems, attentionItems, attentionCount: attentionItems.length };
}

function applyDeviceReadState(
  item: ActivityItem,
  readAtByKey: Record<string, string>,
): ActivityItem {
  const deviceReadAt = readAtByKey[readKey(item.accountId, item.id)];
  if (!deviceReadAt || item.readAt) return item;
  return { ...item, readAt: deviceReadAt };
}

function boundedReadKeys(keys: Record<string, string>, accountId: string): Record<string, string> {
  const prefix = `${accountId}:`;
  const accountEntries = Object.entries(keys)
    .filter(([key]) => key.startsWith(prefix))
    .sort((left, right) => right[1].localeCompare(left[1]));
  const retained = new Set(accountEntries.slice(0, maximumReadKeysPerAccount).map(([key]) => key));
  return Object.fromEntries(
    Object.entries(keys).filter(([key]) => !key.startsWith(prefix) || retained.has(key)),
  );
}

function readKey(accountId: string, id: string): string {
  return `${accountId}:${id}`;
}

function uniqueString(value: string, index: number, items: string[]): boolean {
  return items.indexOf(value) === index;
}

function nextLocalActivityId(): string {
  localActivitySequence += 1;
  return `${Date.now()}-${localActivitySequence}`;
}

function validIsoDate(value: string | undefined): string {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : new Date().toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : "Activity could not be refreshed.";
}
