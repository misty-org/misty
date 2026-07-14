import { apiErrorMessage } from "@/api/client";
import { mailApi } from "@/api/mail";
import { prefetchThreadHtml } from "../components/EmailBody";
import { persistInboxCache, readInboxCache } from "./inboxCache";
import { createInboxStoreWithRuntime, resetInboxStore, type InboxStoreHook } from "./inboxStore";
export * from "./inboxStore";

/** Existing host entry; downloaded components supply their own runtime. */
export function createInboxStore(): InboxStoreHook {
  return createInboxStoreWithRuntime({
    api: mailApi,
    readCache: readInboxCache,
    persist(state) {
      if (!state.accountId) return;
      persistInboxCache(state.accountId, {
        accounts: state.accounts,
        foldersByConnection: state.foldersByConnection,
        threadsByConnection: state.threadsByConnection,
        nextPageByConnection: state.nextPageByConnection,
        estimatedTotalByConnection: state.estimatedTotalByConnection,
        detailFetchedAtByThread: state.detailFetchedAtByThread,
      });
    },
    prefetchHtml: prefetchThreadHtml,
    errorMessage: apiErrorMessage,
  });
}
export const useInboxStore = createInboxStore();
export function resetInboxAccountState(): void {
  resetInboxStore(useInboxStore);
}
