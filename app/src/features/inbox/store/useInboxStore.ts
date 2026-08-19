import {
  mailApi,
  type MailAccount,
  type MailDraft,
  type MailDraftInput,
  type MailFolder,
  type MailThreadAction,
} from "@/api/mail";
import { apiErrorMessage } from "@/api/client";
import { create } from "zustand";
import { mergeThreads, normalizeThread, unifiedThreads, type InboxThread } from "../model";
import { prefetchThreadHtml } from "../components/EmailBody";
import { withExponentialBackoff } from "./exponentialBackoff";
import { persistInboxCache, readInboxCache } from "./inboxCache";

interface InboxStore {
  accountId: string;
  accounts: MailAccount[];
  foldersByConnection: Record<string, MailFolder[]>;
  threadsByConnection: Record<string, InboxThread[]>;
  nextPageByConnection: Record<string, string | undefined>;
  estimatedTotalByConnection: Record<string, number>;
  detailFetchedAtByThread: Record<string, number>;
  accountErrors: Record<string, string>;
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
  selectScope: (connectionId: string, folderId?: string) => Promise<void>;
  selectFolderKind: (kind: string) => Promise<void>;
  search: (query: string) => Promise<void>;
  loadMore: () => Promise<void>;
  openThread: (thread: InboxThread) => Promise<void>;
  prefetchThread: (thread: InboxThread) => Promise<void>;
  actOnThread: (
    thread: InboxThread,
    action: Omit<MailThreadAction, "connection_id">,
  ) => Promise<void>;
  saveDraft: (draft: MailDraftInput, draftId?: string) => Promise<MailDraft>;
  sendDraft: (draftId: string, connectionId: string) => Promise<void>;
}

type InboxSet = (value: Partial<InboxStore> | ((state: InboxStore) => Partial<InboxStore>)) => void;

let accountGeneration = 0;
let contentGeneration = 0;
const detailRequests = new Map<string, Promise<InboxThread>>();

const detailFreshMs = 5 * 60 * 1000;
const prefetchConcurrency = 4;
const prefetchAttempts = 5;
const retryBaseDelayMs = 750;
const retryMaxDelayMs = 12_000;

const initial = {
  accountId: "",
  accounts: [] as MailAccount[],
  foldersByConnection: {} as Record<string, MailFolder[]>,
  threadsByConnection: {} as Record<string, InboxThread[]>,
  nextPageByConnection: {} as Record<string, string | undefined>,
  estimatedTotalByConnection: {} as Record<string, number>,
  detailFetchedAtByThread: {} as Record<string, number>,
  accountErrors: {} as Record<string, string>,
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

export const useInboxStore = create<InboxStore>((set, get) => ({
  ...initial,
  setAccount: (accountId) => {
    if (get().accountId === accountId) return;
    accountGeneration += 1;
    contentGeneration += 1;
    set({ ...initial, accountId });
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
          foldersByConnection: retainConnectionRecords(current.foldersByConnection, connectedIds),
          threadsByConnection,
          nextPageByConnection: retainConnectionRecords(current.nextPageByConnection, connectedIds),
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
      await loadAccountContent(readyAccounts, generation, set);
      if (generation === accountGeneration) {
        set({ loading: false, loaded: true });
        persistCurrentInbox(get());
        void prefetchVisibleThreads(set, get, generation);
      }
    } catch (error) {
      if (generation !== accountGeneration) return;
      set({ loading: false, loaded: true, error: errorText(error) });
    }
  },
  selectScope: async (connectionId, folderId = "") => {
    set({
      selectedConnectionId: connectionId,
      selectedFolderId: folderId,
      selectedFolderKind: "",
      selectedThread: null,
      selectedThreadKey: "",
    });
    await reloadThreads(set, get);
  },
  selectFolderKind: async (kind) => {
    set({
      selectedConnectionId: "",
      selectedFolderId: "",
      selectedFolderKind: kind,
      selectedThread: null,
      selectedThreadKey: "",
    });
    await reloadThreads(set, get);
  },
  search: async (query) => {
    set({ query: query.trim(), selectedThread: null, selectedThreadKey: "" });
    await reloadThreads(set, get);
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
      void prefetchVisibleThreads(set, get, generation);
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
  prefetchThread: async (thread) => {
    if (threadHasDetail(thread)) {
      prefetchThreadHtml(thread);
      return;
    }
    try {
      const detailed = await fetchThreadDetail(thread, prefetchAttempts);
      if (accountGeneration === accountGeneration) {
        applyDetailedThread(set, detailed);
      }
    } catch {
      // Best effort prefetch
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
    await reloadThreads(set, get);
  },
}));

async function loadAccountContent(accounts: MailAccount[], generation: number, set: InboxSet) {
  await Promise.all(
    accounts.map(async (account) => {
      const [folders, threads] = await Promise.allSettled([
        mailApi.folders(account.connection_id),
        mailApi.threads({ connectionId: account.connection_id }),
      ]);
      if (generation !== accountGeneration) return;
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

async function reloadThreads(set: InboxSet, get: () => InboxStore) {
  const request = ++contentGeneration;
  const generation = accountGeneration;
  const targets = scopedAccounts(get());
  set({
    loading: true,
    accountErrors: {},
    threadsByConnection: {},
    nextPageByConnection: {},
    estimatedTotalByConnection: {},
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
        if (generation !== accountGeneration || request !== contentGeneration) return;
        const normalized = result.threads.map((thread) =>
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
            [account.connection_id]: result.next_page_token,
          },
          estimatedTotalByConnection: {
            ...state.estimatedTotalByConnection,
            [account.connection_id]: result.estimated_total ?? result.threads.length,
          },
        }));
      } catch (error) {
        if (generation === accountGeneration && request === contentGeneration)
          reportAccountError(set, account.connection_id, error);
      }
    }),
  );
  if (generation === accountGeneration && request === contentGeneration) {
    set({ loading: false, loaded: true });
    persistCurrentInbox(get());
    void prefetchVisibleThreads(set, get, generation);
  }
}

async function prefetchVisibleThreads(
  set: InboxSet,
  get: () => InboxStore,
  generation: number,
): Promise<void> {
  const now = Date.now();
  const allThreads = unifiedThreads(get().threadsByConnection);
  for (const thread of allThreads.slice(0, 20)) {
    if (threadHasDetail(thread)) prefetchThreadHtml(thread);
  }
  const queue = allThreads
    .filter(
      (thread) =>
        !threadHasDetail(thread) ||
        now - (get().detailFetchedAtByThread[thread.key] ?? 0) > detailFreshMs,
    )
    .slice(0, 80);
  let cursor = 0;
  const worker = async () => {
    while (cursor < queue.length && generation === accountGeneration) {
      const thread = queue[cursor];
      cursor += 1;
      try {
        const detailed = await fetchThreadDetail(thread, prefetchAttempts);
        if (generation !== accountGeneration) return;
        applyDetailedThread(set, detailed);
      } catch {
        // Prefetching is best-effort.
      }
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(prefetchConcurrency, queue.length) }, () => worker()),
  );
  if (generation === accountGeneration && queue.length) persistCurrentInbox(get());
}

function fetchThreadDetail(thread: InboxThread, attempts: number): Promise<InboxThread> {
  const existing = detailRequests.get(thread.key);
  if (existing) return existing;
  const request = withExponentialBackoff(
    async () => {
      const result = await mailApi.thread(thread.connectionId, thread.provider_id);
      return normalizeThread(result.thread, thread.connectionId);
    },
    {
      attempts,
      baseDelayMs: retryBaseDelayMs,
      maxDelayMs: retryMaxDelayMs,
    },
  ).finally(() => detailRequests.delete(thread.key));
  detailRequests.set(thread.key, request);
  return request;
}

function applyDetailedThread(set: InboxSet, detailed: InboxThread): void {
  prefetchThreadHtml(detailed);
  set((state) => {
    const current = state.threadsByConnection[detailed.connectionId] ?? [];
    const existing = current.find((thread) => thread.key === detailed.key);
    const merged = existing
      ? {
          ...detailed,
          unread: existing.unread,
          starred: existing.starred,
          labels: existing.labels,
        }
      : detailed;
    return {
      threadsByConnection: {
        ...state.threadsByConnection,
        [detailed.connectionId]: current.some((thread) => thread.key === detailed.key)
          ? current.map((thread) => (thread.key === detailed.key ? merged : thread))
          : current,
      },
      detailFetchedAtByThread: {
        ...state.detailFetchedAtByThread,
        [detailed.key]: Date.now(),
      },
      selectedThread: state.selectedThreadKey === detailed.key ? merged : state.selectedThread,
      detailLoading: state.selectedThreadKey === detailed.key ? false : state.detailLoading,
    };
  });
}

function mergeSummariesWithCached(current: InboxThread[], incoming: InboxThread[]): InboxThread[] {
  const cached = new Map(current.map((thread) => [thread.key, thread]));
  return incoming.map((thread) => {
    const existing = cached.get(thread.key);
    if (!existing || threadHasDetail(thread) || !threadHasDetail(existing)) return thread;
    return {
      ...existing,
      snippet: thread.snippet || existing.snippet,
    };
  });
}

function threadHasDetail(thread: InboxThread): boolean {
  return thread.messages.some(
    (message) =>
      Boolean(message.body.html) ||
      (Boolean(message.body.text) && !message.body.had_html) ||
      message.body.truncated ||
      message.attachments.length > 0,
  );
}

function persistCurrentInbox(state: InboxStore): void {
  if (!state.accountId) return;
  persistInboxCache(state.accountId, {
    accounts: state.accounts,
    foldersByConnection: state.foldersByConnection,
    threadsByConnection: state.threadsByConnection,
    nextPageByConnection: state.nextPageByConnection,
    estimatedTotalByConnection: state.estimatedTotalByConnection,
    detailFetchedAtByThread: state.detailFetchedAtByThread,
  });
}

function retainConnectionRecords<T>(
  records: Record<string, T>,
  connectedIds: Set<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(records).filter(([connectionId]) => connectedIds.has(connectionId)),
  );
}

function scopedAccounts(state: InboxStore): MailAccount[] {
  return state.selectedConnectionId
    ? state.accounts.filter((account) => account.connection_id === state.selectedConnectionId)
    : state.accounts;
}

function folderIdForAccount(state: InboxStore, connectionId: string): string | undefined | null {
  if (state.selectedFolderId) return state.selectedFolderId;
  if (!state.selectedFolderKind) return undefined;
  return (
    (state.foldersByConnection[connectionId] ?? []).find(
      (folder) => folder.kind === state.selectedFolderKind,
    )?.provider_id ?? null
  );
}

function reportAccountError(set: InboxSet, connectionId: string, error: unknown) {
  set((state) => ({ accountErrors: { ...state.accountErrors, [connectionId]: errorText(error) } }));
}

function patchThreadState(
  state: InboxStore,
  key: string,
  action: Omit<MailThreadAction, "connection_id">,
): Partial<InboxStore> {
  const patch = (thread: InboxThread): InboxThread => ({
    ...thread,
    unread: action.read === undefined ? thread.unread : !action.read,
    starred: action.starred ?? thread.starred,
    labels:
      action.archived === undefined
        ? thread.labels
        : action.archived
          ? thread.labels.filter((label) => label.toLowerCase() !== "inbox")
          : [...new Set([...thread.labels, "INBOX"])],
  });
  return {
    threadsByConnection: Object.fromEntries(
      Object.entries(state.threadsByConnection).map(([connectionId, threads]) => [
        connectionId,
        threads.map((thread) => (thread.key === key ? patch(thread) : thread)),
      ]),
    ),
    selectedThread:
      state.selectedThread?.key === key ? patch(state.selectedThread) : state.selectedThread,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Misty could not load mail from this account.";
}

export function selectUnifiedThreads(
  state: Pick<InboxStore, "threadsByConnection">,
): InboxThread[] {
  return unifiedThreads(state.threadsByConnection);
}

export function resetInboxAccountState(): void {
  accountGeneration += 1;
  contentGeneration += 1;
  detailRequests.clear();
  useInboxStore.setState(initial);
}
