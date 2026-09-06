import type { MistyAppSDK } from "@misty/sdk";
import type { mailApi } from "@/api/mail";

/** Matches the shared Inbox store API; only the supplied scoped SDK carries requests. */
export function createSdkInboxServices(misty: MistyAppSDK, signal: AbortSignal): typeof mailApi {
  const assert = () => {
    if (signal.aborted) throw new Error("This Inbox view is closed.");
  };
  const whileOpen = async <T>(operation: () => Promise<T>): Promise<T> => {
    assert();
    const result = await operation();
    assert();
    return result;
  };
  return {
    accounts: () => whileOpen(() => misty.server.call("mail.accounts.list")),
    folders: (connectionId) =>
      whileOpen(() =>
        misty.server.call("mail.folders.list", {
          query: { connection_id: connectionId },
        }),
      ),
    threads: (input) =>
      whileOpen(() =>
        misty.server.call("mail.threads.list", {
          query: {
            connection_id: input.connectionId,
            folder_id: input.folderId,
            query: input.query,
            page_token: input.pageToken,
            page_size: input.pageSize ?? 40,
          },
        }),
      ),
    thread: (connectionId, threadId) =>
      whileOpen(() =>
        misty.server.call("mail.threads.get", {
          path: { threadID: threadId },
          query: { connection_id: connectionId },
        }),
      ),
    actOnThread: (threadId, body) =>
      whileOpen(() =>
        misty.server.call("mail.threads.action", {
          path: { threadID: threadId },
          body,
        }),
      ),
    createDraft: (body) => whileOpen(() => misty.server.call("mail.drafts.create", { body })),
    updateDraft: (draftId, body) =>
      whileOpen(() =>
        misty.server.call("mail.drafts.update", {
          path: { draftID: draftId },
          body,
        }),
      ),
    sendDraft: (draftId, connectionId, authoringSource = "user") =>
      whileOpen(() =>
        misty.server.call("mail.drafts.send", {
          path: { draftID: draftId },
          body: { connection_id: connectionId, authoring_source: authoringSource, confirmed: true },
        }),
      ),
  };
}
