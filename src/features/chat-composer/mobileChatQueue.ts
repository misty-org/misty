import { spacesApi } from "@/api/spaces/api";
import type { SpaceMessage } from "@/api/spaces/dto/interfaces/types";
import { readActiveSavedAccountSession } from "@/features/auth";
import type { MobileQueuedChatSubmissionRecord } from "@/native/contracts";
import { mobileCacheRead, mobileCacheRemove, mobileCacheWrite } from "@/native/mobile-cache";

const queueIndexKey = "chat-queue-index";
let queueOperation = Promise.resolve();

export function queueMobileChatSubmission(
  record: Omit<
    MobileQueuedChatSubmissionRecord,
    "schemaVersion" | "kind" | "accountId" | "updatedAt"
  >,
): Promise<void> {
  const accountId = readActiveSavedAccountSession()?.id ?? "";
  if (!accountId) return Promise.reject(new Error("Sign in before queueing a message."));
  const saved: MobileQueuedChatSubmissionRecord = {
    ...record,
    schemaVersion: 1,
    kind: "queued-chat-submission",
    accountId,
    updatedAt: new Date().toISOString(),
  };
  queueOperation = queueOperation
    .catch(() => undefined)
    .then(async () => {
      const index = (await mobileCacheRead<string[]>(accountId, queueIndexKey)) ?? [];
      await mobileCacheWrite(accountId, queueRecordKey(saved.clientNonce), saved);
      if (!index.includes(saved.clientNonce)) {
        await mobileCacheWrite(accountId, queueIndexKey, [...index, saved.clientNonce]);
      }
    });
  return queueOperation;
}

export async function drainMobileChatQueue(): Promise<
  Array<{ spaceId: string; message: SpaceMessage }>
> {
  const accountId = readActiveSavedAccountSession()?.id ?? "";
  if (!accountId || !navigator.onLine) return [];
  const delivered: Array<{ spaceId: string; message: SpaceMessage }> = [];
  queueOperation = queueOperation
    .catch(() => undefined)
    .then(async () => {
      const index = (await mobileCacheRead<string[]>(accountId, queueIndexKey)) ?? [];
      const remaining: string[] = [];
      for (const nonce of index) {
        const key = queueRecordKey(nonce);
        const record = await mobileCacheRead<MobileQueuedChatSubmissionRecord>(accountId, key);
        if (!record || record.accountId !== accountId || record.schemaVersion !== 1) {
          await mobileCacheRemove(accountId, key);
          continue;
        }
        try {
          const response = record.conversationId
            ? await spacesApi.sendConversationMessage(
                record.spaceId,
                record.conversationId,
                record.content,
                record.fileNodeIds,
                record.attachmentIds,
                record.libraryItemIds,
                record.replyToMessageId,
                record.clientNonce,
              )
            : await spacesApi.sendMessage(
                record.spaceId,
                record.content,
                record.fileNodeIds,
                record.attachmentIds,
                record.libraryItemIds,
                record.replyToMessageId,
                record.clientNonce,
              );
          response.message.client_nonce ||= record.clientNonce;
          delivered.push({ spaceId: record.spaceId, message: response.message });
          await mobileCacheRemove(accountId, key);
        } catch {
          remaining.push(nonce);
        }
      }
      if (remaining.length) await mobileCacheWrite(accountId, queueIndexKey, remaining);
      else await mobileCacheRemove(accountId, queueIndexKey);
    });
  await queueOperation;
  return delivered;
}

function queueRecordKey(clientNonce: string): string {
  return `chat-queue:${clientNonce}`;
}
