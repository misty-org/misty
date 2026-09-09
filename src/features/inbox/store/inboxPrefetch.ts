import type { mailApi } from "@/api/mail";
import { normalizeThread, type InboxThread } from "../model";
import { withExponentialBackoff } from "./exponentialBackoff";
import type { InboxSet } from "./inboxStore";

export const prefetchAttempts = 1;
export const retryBaseDelayMs = 200;
export const retryMaxDelayMs = 1500;
export const detailFreshMs = 5 * 60 * 1000;

export function createInboxPrefetch(
  api: typeof mailApi,
  prefetchThreadHtml: (thread: InboxThread) => void,
) {
  const detailRequests = new Map<string, Promise<InboxThread>>();

  function fetchThreadDetail(thread: InboxThread, attempts: number): Promise<InboxThread> {
    const existing = detailRequests.get(thread.key);
    if (existing) return existing;
    const request = withExponentialBackoff(
      async () => {
        const result = await api.thread(thread.connectionId, thread.provider_id);
        return normalizeThread(result.thread, thread.connectionId);
      },
      {
        attempts,
        baseDelayMs: retryBaseDelayMs,
        maxDelayMs: retryMaxDelayMs,
      },
    ).finally(() => {
      if (detailRequests.get(thread.key) === request) detailRequests.delete(thread.key);
    });
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

  return { fetchThreadDetail, applyDetailedThread, clear: () => detailRequests.clear() };
}
