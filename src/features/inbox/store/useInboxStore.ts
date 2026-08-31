import {
  mailApi,
  type MailAccount,
  type MailDraft,
  type MailDraftInput,
  type MailFolder,
  type MailThreadAction,
} from "@/api/mail";
import { apiErrorMessage } from "@/api/client";
import { create, type StoreApi, type UseBoundStore } from "zustand";
import { mergeThreads, normalizeThread, unifiedThreads, type InboxThread } from "../model";
import { readInboxCache } from "./inboxCache";

import {
  applyDetailedThread,
  detailFreshMs,
  detailRequests,
  fetchThreadDetail,
  prefetchAttempts,
} from "./inboxPrefetch";
import {
  errorText,
  folderIdForAccount,
  mergeSummariesWithCached,
  patchThreadState,
  persistCurrentInbox,
  reportAccountError,
  retainConnectionRecords,
  scopedAccounts,
  threadHasDetail,
} from "./inboxStoreHelpers";

export interface InboxStore {
  accountId: string;
  accounts: MailAccount[];
  foldersByConnection: Record<string, MailFolder[]>;
  threadsByConnection: Record<string, InboxThread[]>;
  nextPageByConnection: Record<string, string | undefined>;
  estimatedTotalByConnection: Record<string, number>;
  detailFetchedAtByThread: Record<string, number>;
  accountErrors: Record<string, string>;
  accountErrorCodes: Record<string, string>;
  selectedProvider: string;
  selectedConnectionId: string;
  selectedFolderId: string;
  selectedFolderKind: string;
  query: string;
  selectedThreadKey: string;
  selectedThread: InboxThread | null;
  loading: boolean;
  loaded: boolean;
  loadingMore: boolean;
  detailLoading: boolean;
  actioning: boolean;
  error: string | null;
  setAccount: (accountId: string) => void;
  load: (force?: boolean) => Promise<void>;
  selectProvider: (provider: string) => Promise<void>;
  selectScope: (connectionId: string, folderId?: string) => Promise<void>;
  selectFolderKind: (kind: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  loadMore: () => Promise<void>;
  openThread: (thread: InboxThread) => Promise<void>;
  actOnThread: (
    thread: InboxThread,
    action: Omit<MailThreadAction, "connection_id">,
  ) => Promise<void>;
  saveDraft: (draft: MailDraftInput, draftId?: string) => Promise<MailDraft>;
  sendDraft: (draftId: string, connectionId: string) => Promise<void>;
}

export type InboxSet = (
  value: Partial<InboxStore> | ((state: InboxStore) => Partial<InboxStore>),
) => void;
export type InboxStoreHook = UseBoundStore<StoreApi<InboxStore>>;

const initial = {
  accountId: "",
  accounts: [] as MailAccount[],
  foldersByConnection: {} as Record<string, MailFolder[]>,
  threadsByConnection: {} as Record<string, InboxThread[]>,
  nextPageByConnection: {} as Record<string, string | undefined>,
  estimatedTotalByConnection: {} as Record<string, number>,
  detailFetchedAtByThread: {} as Record<string, number>,
  accountErrors: {} as Record<string, string>,
  accountErrorCodes: {} as Record<string, string>,
  selectedProvider: "",
  selectedConnectionId: "",
  selectedFolderId: "",
  selectedFolderKind: "",
  query: "",
  selectedThreadKey: "",
  selectedThread: null as InboxThread | null,
  loading: false,
  loaded: false,
  loadingMore: false,
  detailLoading: false,
  actioning: false,
  error: null as string | null,
};

const inboxStoreControls = new WeakMap<InboxStoreHook, { reset: () => void }>();

export function createInboxStore(): InboxStoreHook {
  let accountGeneration = 0;
  let contentGeneration = 0;
  const store = create<InboxStore>((set, get) => ({
    ...initial,
    setAccount: (accountId) => {
      if (get().accountId === accountId) return;
      const selectedProvider = get().selectedProvider;
      accountGeneration += 1;
      contentGeneration += 1;
      set({ ...initial, accountId, selectedProvider });
    },
    load: async (force = false) => {
      const state = get();
      if (!state.accountId || state.loading || (state.loaded && !force)) return;
      const generation = accountGeneration;
      const accountId = state.accountId;
      set({
        loading: true,
        error: null,
        accountErrors: {},
        accountErrorCodes: {},
        selectedThread: null,
        selectedThreadKey: "",
      });
      const cached = await readInboxCache(accountId);
      if (generation !== accountGeneration) return;
      if (cached) {
        set({
          accounts: cached.accounts,
          foldersByConnection: cached.foldersByConnection,
          threadsByConnection: cached.threadsByConnection,
          nextPageByConnection: cached.nextPageByConnection,
          estimatedTotalByConnection: cached.estimatedTotalByConnection,
          detailFetchedAtByThread: cached.detailFetchedAtByThread,
        });
      }
      try {
        const { accounts } = await mailApi.accounts();
        if (generation !== accountGeneration) return;
        const readyAccounts = accounts.filter((account) => account.status !== "needs_attention");
        const accountErrors = Object.fromEntries(
          accounts.flatMap((account) => {
            if (!account.error_code) return [];
            return [
              [
                account.connection_id,
                apiErrorMessage(account.error_code, "Reconnect this email account."),
              ],
            ];
          }),
        );
        const accountErrorCodes = Object.fromEntries(
          accounts.flatMap((account) =>
            account.error_code ? [[account.connection_id, account.error_code]] : [],
          ),
        );
        const connectedIds = new Set(accounts.map((account) => account.connection_id));
        set((current) => {
          const threadsByConnection = retainConnectionRecords(
            current.threadsByConnection,
            connectedIds,
          );
          const retainedThreadKeys = new Set(
            Object.values(threadsByConnection)
              .flat()
              .map((thread) => thread.key),
          );
          return {
            accounts,
            accountErrors,
            accountErrorCodes,
            foldersByConnection: retainConnectionRecords(current.foldersByConnection, connectedIds),
            threadsByConnection,
            nextPageByConnection: retainConnectionRecords(
              current.nextPageByConnection,
              connectedIds,
            ),
            estimatedTotalByConnection: retainConnectionRecords(
              current.estimatedTotalByConnection,
              connectedIds,
            ),
            detailFetchedAtByThread: Object.fromEntries(
              Object.entries(current.detailFetchedAtByThread).filter(([key]) =>
                retainedThreadKeys.has(key),
              ),
            ),
          };
        });
        await loadAccountContent(
          readyAccounts,
          generation,
          set,
          () => generation === accountGeneration,
        );
        if (generation === accountGeneration) {
          set({ loading: false, loaded: true });
          persistCurrentInbox(get());
        }
      } catch (error) {
        if (generation !== accountGeneration) return;
        set({ loading: false, loaded: true, error: errorText(error) });
      }
    },
    selectProvider: async (provider) => {
      const normalizedProvider = provider === "microsoft" ? "microsoft" : "google";
      if (
        get().selectedProvider === normalizedProvider &&
        !get().selectedConnectionId &&
        !get().selectedFolderKind
      ) {
        return;
      }
      set({
        selectedProvider: normalizedProvider,
        selectedConnectionId: "",
        selectedFolderId: "",
        selectedFolderKind: "",
        selectedThread: null,
        selectedThreadKey: "",
      });
      if (!get().loaded) return;
      await reloadThreads(set, get, {
        accountGeneration: () => accountGeneration,
        contentGeneration: () => contentGeneration,
        nextContentGeneration: () => ++contentGeneration,
      });
    },
    selectScope: async (connectionId, folderId = "") => {
      set({
        selectedConnectionId: connectionId,
        selectedFolderId: folderId,
        selectedFolderKind: "",
        selectedThread: null,
        selectedThreadKey: "",
      });
      await reloadThreads(set, get, {
        accountGeneration: () => accountGeneration,
        contentGeneration: () => contentGeneration,
        nextContentGeneration: () => ++contentGeneration,
      });
    },
    selectFolderKind: async (kind) => {
      set({
        selectedConnectionId: "",
        selectedFolderId: "",
        selectedFolderKind: kind,
        selectedThread: null,
        selectedThreadKey: "",
      });
      await reloadThreads(set, get, {
        accountGeneration: () => accountGeneration,
        contentGeneration: () => contentGeneration,
        nextContentGeneration: () => ++contentGeneration,
      });
    },
    search: async (query) => {
      set({ query: query.trim(), selectedThread: null, selectedThreadKey: "" });
      await reloadThreads(set, get, {
        accountGeneration: () => accountGeneration,
        contentGeneration: () => contentGeneration,
        nextContentGeneration: () => ++contentGeneration,
      });
    },
    loadMore: async () => {
      if (get().loadingMore) return;
      const generation = accountGeneration;
      const targets = scopedAccounts(get()).filter((account) => {
        const folderId = folderIdForAccount(get(), account.connection_id);
        return folderId !== null && get().nextPageByConnection[account.connection_id];
      });
      if (!targets.length) return;
      set({ loadingMore: true });
      await Promise.all(
        targets.map(async (account) => {
          try {
            const result = await mailApi.threads({
              connectionId: account.connection_id,
              folderId: folderIdForAccount(get(), account.connection_id) || undefined,
              query: get().query || undefined,
              pageToken: get().nextPageByConnection[account.connection_id],
            });
            if (generation !== accountGeneration) return;
            const normalized = result.threads.map((thread) =>
              normalizeThread(thread, account.connection_id),
            );
            set((state) => {
              const incoming = mergeSummariesWithCached(
                state.threadsByConnection[account.connection_id] ?? [],
                normalized,
              );
              return {
                threadsByConnection: {
                  ...state.threadsByConnection,
                  [account.connection_id]: mergeThreads(
                    state.threadsByConnection[account.connection_id] ?? [],
                    incoming,
                  ),
                },
                nextPageByConnection: {
                  ...state.nextPageByConnection,
                  [account.connection_id]: result.next_page_token,
                },
                estimatedTotalByConnection: {
                  ...state.estimatedTotalByConnection,
                  [account.connection_id]:
                    result.estimated_total ??
                    state.estimatedTotalByConnection[account.connection_id] ??
                    (state.threadsByConnection[account.connection_id]?.length ?? 0) +
                      result.threads.length,
                },
              };
            });
          } catch (error) {
            reportAccountError(set, account.connection_id, error);
          }
        }),
      );
      if (generation === accountGeneration) {
        set({ loadingMore: false });
        persistCurrentInbox(get());
      }
    },
    openThread: async (thread) => {
      const generation = accountGeneration;
      const hasCachedDetail = threadHasDetail(thread);
      const detailIsFresh =
        Date.now() - (get().detailFetchedAtByThread[thread.key] ?? 0) <= detailFreshMs;
      set({
        selectedThreadKey: thread.key,
        selectedThread: thread,
        detailLoading: !hasCachedDetail,
        error: null,
      });
      if (thread.unread)
        void get()
          .actOnThread(thread, { read: true })
          .catch(() => undefined);
      if (hasCachedDetail && detailIsFresh) return;
      try {
        const detailed = await fetchThreadDetail(thread, prefetchAttempts);
        if (generation !== accountGeneration || get().selectedThreadKey !== thread.key) return;
        applyDetailedThread(set, detailed);
        persistCurrentInbox(get());
      } catch (error) {
        if (generation === accountGeneration) {
          set({ detailLoading: false, error: errorText(error) });
        }
      }
    },
    actOnThread: async (thread, action) => {
      const generation = accountGeneration;
      set({ actioning: true, error: null });
      try {
        await mailApi.actOnThread(thread.provider_id, {
          connection_id: thread.connectionId,
          ...action,
        });
        if (generation !== accountGeneration) return;
        set((state) => patchThreadState(state, thread.key, action));
        persistCurrentInbox(get());
      } catch (error) {
        if (generation === accountGeneration) set({ error: errorText(error) });
        throw error;
      } finally {
        if (generation === accountGeneration) set({ actioning: false });
      }
    },
    saveDraft: async (draft, draftId) => {
      const result = draftId
        ? await mailApi.updateDraft(draftId, draft)
        : await mailApi.createDraft(draft);
      return result.draft;
    },
    sendDraft: async (draftId, connectionId) => {
      await mailApi.sendDraft(draftId, connectionId);
      await reloadThreads(set, get, {
        accountGeneration: () => accountGeneration,
        contentGeneration: () => contentGeneration,
        nextContentGeneration: () => ++contentGeneration,
      });
    },
  }));
  inboxStoreControls.set(store, {
    reset: () => {
      accountGeneration += 1;
      contentGeneration += 1;
      store.setState(initial);
    },
  });
  return store;
}

export const useInboxStore = createInboxStore();

async function loadAccountContent(
  accounts: MailAccount[],
  generation: number,
  set: InboxSet,
  isCurrent: () => boolean,
) {
  await Promise.all(
    accounts.map(async (account) => {
      const [folders, threads] = await Promise.allSettled([
        mailApi.folders(account.connection_id),
        mailApi.threads({ connectionId: account.connection_id }),
      ]);
      if (!isCurrent()) return;
      if (folders.status === "fulfilled") {
        set((state) => ({
          foldersByConnection: {
            ...state.foldersByConnection,
            [account.connection_id]: folders.value.folders,
          },
        }));
      }
      if (threads.status === "fulfilled") {
        const normalized = threads.value.threads.map((thread) =>
          normalizeThread(thread, account.connection_id),
        );
        set((state) => ({
          threadsByConnection: {
            ...state.threadsByConnection,
            [account.connection_id]: mergeSummariesWithCached(
              state.threadsByConnection[account.connection_id] ?? [],
              normalized,
            ),
          },
          nextPageByConnection: {
            ...state.nextPageByConnection,
            [account.connection_id]: threads.value.next_page_token,
          },
          estimatedTotalByConnection: {
            ...state.estimatedTotalByConnection,
            [account.connection_id]: threads.value.estimated_total ?? threads.value.threads.length,
          },
        }));
      }
      const failure =
        threads.status === "rejected"
          ? threads.reason
          : folders.status === "rejected"
            ? folders.reason
            : null;
      if (failure) reportAccountError(set, account.connection_id, failure);
    }),
  );
}

async function reloadThreads(
  set: InboxSet,
  get: () => InboxStore,
  generations: {
    accountGeneration: () => number;
    contentGeneration: () => number;
    nextContentGeneration: () => number;
  },
) {
  const request = generations.nextContentGeneration();
  const generation = generations.accountGeneration();
  const targets = scopedAccounts(get());
  set({
    loading: true,
    accountErrors: {},
    accountErrorCodes: {},
  });
  await Promise.all(
    targets.map(async (account) => {
      const folderId = folderIdForAccount(get(), account.connection_id);
      if (folderId === null) return;
      try {
        const result = await mailApi.threads({
          connectionId: account.connection_id,
          folderId: folderId || undefined,
          query: get().query || undefined,
        });
        if (
          generation !== generations.accountGeneration() ||
          request !== generations.contentGeneration()
        )
          return;
        const normalized = result.threads.map((thread) =>
          normalizeThread(thread, account.connection_id),
        );
        set((state) => ({
          threadsByConnection: {
            ...state.threadsByConnection,
            [account.connection_id]: get().query
              ? normalized
              : mergeSummariesWithCached(
                  state.threadsByConnection[account.connection_id] ?? [],
                  normalized,
                ),
          },
          nextPageByConnection: {
            ...state.nextPageByConnection,
            [account.connection_id]: result.next_page_token,
          },
          estimatedTotalByConnection: {
            ...state.estimatedTotalByConnection,
            [account.connection_id]: result.estimated_total ?? result.threads.length,
          },
        }));
      } catch (error) {
        if (
          generation === generations.accountGeneration() &&
          request === generations.contentGeneration()
        )
          reportAccountError(set, account.connection_id, error);
      }
    }),
  );
  if (
    generation === generations.accountGeneration() &&
    request === generations.contentGeneration()
  ) {
    set({ loading: false, loaded: true });
    persistCurrentInbox(get());
  }
}

export function selectUnifiedThreads(
  state: Pick<InboxStore, "threadsByConnection">,
): InboxThread[] {
  return unifiedThreads(state.threadsByConnection);
}

export function selectVisibleInboxThreads(
  state: Pick<
    InboxStore,
    "accounts" | "selectedConnectionId" | "selectedProvider" | "threadsByConnection"
  >,
): InboxThread[] {
  if (!state.selectedProvider && !state.selectedConnectionId) {
    return unifiedThreads(state.threadsByConnection);
  }
  const allowedConnections = new Set(
    state.accounts
      .filter(
        (account) =>
          (!state.selectedProvider || account.provider === state.selectedProvider) &&
          (!state.selectedConnectionId || account.connection_id === state.selectedConnectionId),
      )
      .map((account) => account.connection_id),
  );
  return unifiedThreads(
    Object.fromEntries(
      Object.entries(state.threadsByConnection).filter(([connectionId]) =>
        allowedConnections.has(connectionId),
      ),
    ),
  );
}

export function resetInboxAccountState(): void {
  detailRequests.clear();
  inboxStoreControls.get(useInboxStore)?.reset();
}
