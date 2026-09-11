import { useSpacesStore } from "@/features/spaces";
import { readDeploymentScope } from "@/api/deployment/api";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { publishNativeActivity, syncNativeBadge } from "./nativeNotifications";
import {
  activityTransition,
  isActivityMuted,
  isDiagnosticActivity,
  isPendingRequest,
  shouldNotifyActivity,
} from "./activityPolicy";
import {
  activityAccountKey,
  activityReadKey,
  belongsToActivityAccount,
  boundedActivityItems,
  deriveActivityState,
  type ActivityData,
} from "./activityState";
import type { ActivityItem, ActivityTarget, LocalActivityInput, ActivityCategory } from "./types";

type Source = ActivityItem["source"];
interface ActivityStore extends ActivityData {
  allItems: ActivityItem[];
  attentionItems: ActivityItem[];
  attentionCount: number;
  hasUnseenHistory: boolean;
  loading: boolean;
  offline: boolean;
  error: string | null;
  setAccount(accountId: string): void;
  syncSources(
    accountId: string,
    items: ActivityItem[],
    completeSources?: Source[],
    observedSources?: Source[],
  ): void;
  resolveSourceRequest(accountId: string, source: Source, sourceId: string): void;
  load(): Promise<void>;
  refresh(): Promise<void>;
  ingestLocal(input: LocalActivityInput): string | null;
  markRead(id: string): void;
  markAllRead(ids?: string[]): Promise<void>;
  markHistoryChecked(): void;
  dismissItem(id: string): void;
  setSourceMuted(key: string, muted: boolean): void;
  setCategoryEnabled(category: ActivityCategory, enabled: boolean): void;
  openItem(id: string): ActivityTarget | null;
  clearHistory(ids?: string[]): void;
  clearDeviceHistory(): void;
  setOffline(offline: boolean): void;
  clearError(): void;
}

export const useActivityStore = create<ActivityStore>()(
  persist(
    (set, get) => {
      const update = (partial: Partial<ActivityData>) => {
        const state = { ...get(), ...partial };
        const derived = deriveActivityState(state);
        set({ ...partial, ...derived });
        void syncNativeBadge(derived.attentionCount);
      };
      const deliver = (items: ActivityItem[]) => {
        const state = get();
        const muted = state.mutedSourcesByAccount[activityAccountKey(state)] ?? [];
        for (const item of items) {
          if (
            belongsToActivityAccount(item, state) &&
            shouldNotifyActivity(item) &&
            !state.clearedHistoryByKey[activityReadKey(state, item)] &&
            !isActivityMuted(item, muted)
          )
            void publishNativeActivity(item);
        }
      };
      const refresh = async () => {
        const account = activityAccountKey(get());
        if (!get().accountId) return;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          set({ loading: false, offline: true });
          return;
        }
        set({ loading: true, offline: false, error: null });
        try {
          await useSpacesStore.getState().loadInbox();
          if (account === activityAccountKey(get()))
            set({ loading: false, error: useSpacesStore.getState().inboxError ?? null });
        } catch (error) {
          if (account === activityAccountKey(get()))
            set({ loading: false, error: errorMessage(error) });
        }
      };
      return {
        accountId: "",
        deploymentScope: readDeploymentScope(),
        sourceItems: [],
        localItems: [],
        readAtByKey: {},
        clearedHistoryByKey: {},
        knownSourceIdsByAccount: {},
        baselinedAccounts: [],
        historySequence: 0,
        historyCheckedByAccount: {},
        mutedSourcesByAccount: {},
        categoriesByAccount: {},
        allItems: [],
        attentionItems: [],
        attentionCount: 0,
        hasUnseenHistory: false,
        loading: false,
        offline: typeof navigator !== "undefined" && !navigator.onLine,
        error: null,
        setAccount(accountId) {
          update({ accountId: accountId.trim(), deploymentScope: readDeploymentScope() });
          set({ error: null, loading: false });
        },
        syncSources(accountId, items, completeSources = [], observedSources = ["spaces"]) {
          if (!accountId || accountId !== get().accountId) return;
          const state = get();
          const key = activityAccountKey(state);
          const known = new Set(state.knownSourceIdsByAccount[key] ?? []);
          const baseline = new Set(state.baselinedAccounts);
          const previous = state.sourceItems.filter((item) =>
            belongsToActivityAccount(item, state),
          );
          const incoming = items.filter((item) => item.accountId === accountId);
          const sourceGroups = new Set<Source>([
            ...observedSources,
            ...incoming.map((item) => item.source),
            ...completeSources,
          ]);
          let sequence = state.historySequence;
          const notifications: ActivityItem[] = [];
          const merged = incoming.map((item) => {
            const old = previous.find((candidate) => candidate.id === item.id);
            // A confirmed terminal request cannot be reopened by an older list response.
            if (old?.resolvedAt && isPendingRequest(item)) return old;
            const changed = !old || activityTransition(old) !== activityTransition(item);
            const sourceBaseline = `${key}:${item.source}`;
            const next: ActivityItem = {
              ...item,
              deploymentScope: state.deploymentScope,
              historySequence: changed
                ? baseline.has(sourceBaseline)
                  ? ++sequence
                  : 0
                : old.historySequence,
              updatedAt: changed ? (item.updatedAt ?? item.createdAt) : old.updatedAt,
            };
            const transition = activityTransition(next);
            if (changed && baseline.has(sourceBaseline) && !known.has(transition))
              notifications.push(next);
            known.add(transition);
            return next;
          });
          for (const old of previous) {
            if (merged.some((item) => item.id === old.id)) continue;
            if (isPendingRequest(old) && completeSources.includes(old.source)) {
              merged.push({
                ...old,
                resolvedAt: new Date().toISOString(),
                status: "resolved",
                updatedAt: new Date().toISOString(),
                historySequence: ++sequence,
              });
            } else merged.push(old);
          }
          sourceGroups.forEach((source) => baseline.add(`${key}:${source}`));
          update({
            sourceItems: boundedActivityItems([
              ...state.sourceItems.filter((item) => !belongsToActivityAccount(item, state)),
              ...merged,
            ]),
            historySequence: sequence,
            knownSourceIdsByAccount: {
              ...state.knownSourceIdsByAccount,
              [key]: [...known].slice(-2000),
            },
            baselinedAccounts: [...baseline],
          });
          deliver(
            notifications.map(
              (item) => get().allItems.find((entry) => entry.id === item.id) ?? item,
            ),
          );
        },
        resolveSourceRequest(accountId, source, sourceId) {
          const state = get();
          if (accountId !== state.accountId) return;
          const item = state.sourceItems.find(
            (entry) =>
              belongsToActivityAccount(entry, state) &&
              entry.source === source &&
              entry.sourceId === sourceId &&
              isPendingRequest(entry),
          );
          if (!item) return;
          const now = new Date().toISOString();
          update({
            sourceItems: state.sourceItems.map((entry) =>
              entry === item
                ? {
                    ...entry,
                    status: "resolved",
                    resolvedAt: now,
                    updatedAt: now,
                    historySequence: state.historySequence + 1,
                  }
                : entry,
            ),
            historySequence: state.historySequence + 1,
          });
        },
        load: refresh,
        refresh,
        ingestLocal(input) {
          const state = get();
          const accountId = (input.accountId ?? state.accountId).trim();
          if (!accountId) return null;
          const sourceId = input.id?.trim() || crypto.randomUUID();
          const id = `device:${accountId}:${sourceId}`;
          const previous = state.localItems.find(
            (item) =>
              item.id === id && (item.deploymentScope ?? "hosted") === state.deploymentScope,
          );
          if (
            input.revision !== undefined &&
            previous?.revision !== undefined &&
            input.revision <= previous.revision
          )
            return id;
          const now = new Date().toISOString();
          const item: ActivityItem = {
            id,
            accountId,
            source: "device",
            sourceId,
            deploymentScope: state.deploymentScope,
            kind: input.kind,
            visibility: input.visibility,
            appId: input.appId,
            spaceId: input.spaceId,
            sourceLabel: input.sourceLabel,
            lifecycle: input.lifecycle,
            status: input.status,
            revision: input.revision,
            dismissible: input.dismissible,
            title: input.title.trim() || "Misty activity",
            body: input.body?.trim() ?? "",
            createdAt: previous?.createdAt ?? validDate(input.createdAt),
            updatedAt: now,
            attention: false,
            target: input.target ?? { kind: "none" },
            ...(input.status === "resolved" ? { resolvedAt: now } : {}),
          };
          item.attention = shouldNotifyActivity(item);
          const changed = !previous || activityTransition(previous) !== activityTransition(item);
          if (!changed && previous.title === item.title && previous.body === item.body) return id;
          const key = activityAccountKey({ ...state, accountId });
          const known = new Set(state.knownSourceIdsByAccount[key] ?? []);
          const transition = activityTransition(item);
          const alreadyKnown = known.has(transition);
          known.add(transition);
          item.historySequence = changed ? state.historySequence + 1 : previous.historySequence;
          if (!changed) {
            item.updatedAt = previous.updatedAt;
            item.resolvedAt = previous.resolvedAt;
          }
          update({
            localItems: boundedActivityItems([
              item,
              ...state.localItems.filter((candidate) => candidate !== previous),
            ]),
            knownSourceIdsByAccount: {
              ...state.knownSourceIdsByAccount,
              [key]: [...known].slice(-2000),
            },
            historySequence: changed ? state.historySequence + 1 : state.historySequence,
          });
          if (changed && !alreadyKnown && input.notify !== false) deliver([item]);
          return id;
        },
        markRead(id) {
          const state = get();
          const item = state.allItems.find((candidate) => candidate.id === id);
          if (!item || item.readAt) return;
          update({
            readAtByKey: {
              ...state.readAtByKey,
              [activityReadKey(state, item)]: new Date().toISOString(),
            },
          });
        },
        async markAllRead(ids) {
          const state = get();
          const readAtByKey = { ...state.readAtByKey };
          for (const item of state.allItems.filter(
            (entry) => !isPendingRequest(entry) && (!ids || ids.includes(entry.id)),
          )) {
            readAtByKey[activityReadKey(state, item)] = new Date().toISOString();
          }
          update({ readAtByKey });
          // Server inbox read semantics do not resolve approvals or invitations.
          try {
            if (!ids && state.accountId) await useSpacesStore.getState().markInboxSeen();
          } catch (error) {
            if (activityAccountKey(state) === activityAccountKey(get()))
              set({ error: errorMessage(error) });
          }
        },
        markHistoryChecked() {
          const state = get();
          update({
            historyCheckedByAccount: {
              ...state.historyCheckedByAccount,
              [activityAccountKey(state)]: state.historySequence,
            },
          });
        },
        dismissItem(id) {
          const state = get();
          const item = state.localItems.find(
            (entry) => entry.id === id && belongsToActivityAccount(entry, state),
          );
          if (!item?.dismissible || !isPendingRequest(item)) return;
          update({
            localItems: state.localItems.map((entry) =>
              entry === item
                ? {
                    ...item,
                    resolvedAt: new Date().toISOString(),
                    status: "resolved",
                    historySequence: state.historySequence + 1,
                  }
                : entry,
            ),
            historySequence: state.historySequence + 1,
          });
        },
        setSourceMuted(source, muted) {
          const state = get();
          const key = activityAccountKey(state);
          const sources = new Set(state.mutedSourcesByAccount[key] ?? []);
          if (muted) sources.add(source);
          else sources.delete(source);
          update({
            mutedSourcesByAccount: { ...state.mutedSourcesByAccount, [key]: [...sources] },
          });
        },
        setCategoryEnabled(category, enabled) {
          const state = get();
          const key = activityAccountKey(state);
          update({
            categoriesByAccount: {
              ...state.categoriesByAccount,
              [key]: { ...state.categoriesByAccount[key], [category]: enabled },
            },
          });
        },
        openItem(id) {
          const item = get().allItems.find((candidate) => candidate.id === id);
          if (!item) return null;
          get().markRead(id);
          return item.target;
        },
        clearHistory(ids) {
          const state = get();
          const clearedHistoryByKey = { ...state.clearedHistoryByKey };
          for (const item of state.allItems) {
            if (!isPendingRequest(item) && (!ids || ids.includes(item.id)))
              clearedHistoryByKey[activityReadKey(state, item)] = true;
          }
          // Keep transition receipts so refresh/restart cannot resurrect cleared history.
          // Required requests and separately bounded diagnostics are unaffected.
          update({ clearedHistoryByKey });
        },
        clearDeviceHistory() {
          const state = get();
          update({
            localItems: state.localItems.filter(
              (item) =>
                !belongsToActivityAccount(item, state) ||
                (!isDiagnosticActivity(item) && isPendingRequest(item)),
            ),
          });
        },
        setOffline: (offline) => set({ offline }),
        clearError: () => set({ error: null }),
      };
    },
    {
      name: "misty:activity:v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        localItems: boundedActivityItems(state.localItems),
        sourceItems: boundedActivityItems(state.sourceItems),
        readAtByKey: state.readAtByKey,
        clearedHistoryByKey: state.clearedHistoryByKey,
        knownSourceIdsByAccount: state.knownSourceIdsByAccount,
        baselinedAccounts: state.baselinedAccounts,
        historySequence: state.historySequence,
        historyCheckedByAccount: state.historyCheckedByAccount,
        mutedSourcesByAccount: state.mutedSourcesByAccount,
        categoriesByAccount: state.categoriesByAccount,
      }),
      migrate(persisted) {
        const old = persisted as Partial<ActivityData>;
        const localItems = (old.localItems ?? []).map((item) => ({
          ...item,
          deploymentScope: "hosted",
          historySequence: 0,
          ...(old.readAtByKey?.[`${item.accountId}:${item.id}`]
            ? { readAt: old.readAtByKey[`${item.accountId}:${item.id}`] }
            : {}),
        }));
        return {
          ...old,
          localItems,
          historySequence: 0,
          baselinedAccounts: [],
          knownSourceIdsByAccount: {},
          historyCheckedByAccount: {},
          mutedSourcesByAccount: {},
          categoriesByAccount: {},
        };
      },
      merge(persisted, current) {
        const data = { ...current, ...((persisted as Partial<ActivityData>) ?? {}) };
        return { ...data, ...deriveActivityState(data) };
      },
    },
  ),
);

function validDate(value?: string): string {
  return value && Number.isFinite(Date.parse(value))
    ? new Date(value).toISOString()
    : new Date().toISOString();
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Activity could not be refreshed.";
}
