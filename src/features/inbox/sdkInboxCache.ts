import type { MistyAppSDK } from "@misty/sdk";
import type { InboxCacheSnapshot } from "./store/inboxCache";
import type { InboxStore } from "./store/inboxStore";

/** Components see mailbox data only. The host owns encryption, namespace and account credentials. */
export function createSdkInboxCache(
  misty: MistyAppSDK,
  signal: AbortSignal,
  report: (error: unknown) => void,
) {
  let pending = Promise.resolve();
  return {
    async readCache(accountId: string): Promise<InboxCacheSnapshot | null> {
      if (signal.aborted) return null;
      try {
        const cached = await misty.mail.cache.read();
        if (signal.aborted || !cached || cached.accountId !== accountId) return null;
        return { version: 2, accountId: cached.accountId, savedAt: cached.savedAt, ...cached.data };
      } catch (error) {
        if (!signal.aborted) report(error);
        return null;
      }
    },
    persist(state: InboxStore) {
      if (signal.aborted || !state.accountId) return;
      const data = {
        accounts: state.accounts,
        foldersByConnection: state.foldersByConnection,
        threadsByConnection: Object.fromEntries(
          Object.entries(state.threadsByConnection).map(([id, threads]) => [
            id,
            threads.slice(0, 200),
          ]),
        ),
        nextPageByConnection: state.nextPageByConnection,
        estimatedTotalByConnection: state.estimatedTotalByConnection,
        detailFetchedAtByThread: state.detailFetchedAtByThread,
      };
      pending = pending
        .catch(() => undefined)
        .then(async () => {
          if (!signal.aborted) await misty.mail.cache.write(data);
        })
        .catch((error) => {
          if (!signal.aborted) report(error);
        });
    },
  };
}
