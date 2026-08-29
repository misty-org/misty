import type { MailAccount, MailThreadAction } from "@/api/mail";
import { ApiRequestError } from "@/api/client";
import type { InboxThread } from "../model";
import { persistInboxCache } from "./inboxCache";
import type { InboxStore, InboxSet } from "./useInboxStore";

export function mergeSummariesWithCached(
  current: InboxThread[],
  incoming: InboxThread[],
): InboxThread[] {
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

export function threadHasDetail(thread: InboxThread): boolean {
  return thread.messages.some(
    (message) =>
      Boolean(message.body.html) ||
      (Boolean(message.body.text) && !message.body.had_html) ||
      message.body.truncated ||
      message.attachments.length > 0,
  );
}

export function persistCurrentInbox(state: InboxStore): void {
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

export function retainConnectionRecords<T>(
  records: Record<string, T>,
  connectedIds: Set<string>,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(records).filter(([connectionId]) => connectedIds.has(connectionId)),
  );
}

export function scopedAccounts(state: InboxStore): MailAccount[] {
  return state.selectedConnectionId
    ? state.accounts.filter((account) => account.connection_id === state.selectedConnectionId)
    : state.selectedProvider
      ? state.accounts.filter((account) => account.provider === state.selectedProvider)
      : state.accounts;
}

export function folderIdForAccount(
  state: InboxStore,
  connectionId: string,
): string | undefined | null {
  if (state.selectedFolderId) return state.selectedFolderId;
  if (!state.selectedFolderKind) return undefined;
  return (
    (state.foldersByConnection[connectionId] ?? []).find(
      (folder) => folder.kind === state.selectedFolderKind,
    )?.provider_id ?? null
  );
}

export function reportAccountError(set: InboxSet, connectionId: string, error: unknown): void {
  set((state) => ({
    accountErrors: { ...state.accountErrors, [connectionId]: errorText(error) },
    accountErrorCodes: {
      ...state.accountErrorCodes,
      ...(error instanceof ApiRequestError && error.code ? { [connectionId]: error.code } : {}),
    },
  }));
}

export function patchThreadState(
  state: InboxStore,
  key: string,
  action: Omit<MailThreadAction, "connection_id">,
): Partial<InboxStore> {
  const patch = (thread: InboxThread): InboxThread => {
    let nextLabels = thread.labels;
    if (action.archived !== undefined) {
      nextLabels = action.archived
        ? nextLabels.filter((l) => l.toLowerCase() !== "inbox")
        : [...new Set([...nextLabels, "INBOX"])];
    }
    if (action.deleted || action.trashed) {
      nextLabels = [
        ...new Set([...nextLabels.filter((l) => l.toLowerCase() !== "inbox"), "TRASH"]),
      ];
    }
    if (action.spam) {
      nextLabels = [...new Set([...nextLabels.filter((l) => l.toLowerCase() !== "inbox"), "SPAM"])];
    }
    return {
      ...thread,
      unread: action.read === undefined ? thread.unread : !action.read,
      starred: action.starred ?? thread.starred,
      labels: nextLabels,
    };
  };
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

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Misty could not load mail from this account.";
}
